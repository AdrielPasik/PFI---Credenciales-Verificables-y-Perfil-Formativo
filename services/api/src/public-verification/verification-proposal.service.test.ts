/**
 * Propuesta de requisitos desde una sesion anonima.
 *
 * PROVEEDOR FALSO Y DETERMINISTA: ningun test llama al proveedor real. El doble
 * cuenta sus invocaciones, que es exactamente lo que estos tests defienden:
 *
 *   A. una propuesta autoritativa por solicitud
 *   B. a lo sumo un claim activo por solicitud
 *   - costo acotado por cuota y cooldown del ENLACE
 *   - un resultado tardio o sin autoridad nunca se acepta
 *
 * Lo que NO se puede probar aca, y no se afirma: que Postgres SERIALIZABLE detecte
 * el conflicto de dos claims concurrentes sobre el mismo enlace. Se prueba que el
 * claim corre en SERIALIZABLE y que un P2034 no arranca proveedor.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { ObjectiveRequirementProposalError } from '../objective-requirement-proposal/objective-requirement-proposal.errors';
import {
  MAX_VERIFIER_REQUIREMENTS,
  PROPOSAL_COOLDOWN_MS,
  PROPOSAL_LEASE_MS,
  PROPOSAL_STARTS_PER_SHARE_WINDOW
} from './public-verification.limits';
import { PublicVerificationError } from './public-verification.errors';
import { VerificationProposalService } from './verification-proposal.service';
import { VerificationRequestService } from './verification-request.service';
import {
  type FakeAttempt,
  HOLDER_ID,
  NOW,
  REQUEST_TOKEN,
  SHARE_TOKEN,
  confirmedRequest,
  fakePublicPrisma,
  grant
} from './__fixtures__/public-verification.fixture';

const RAW = 'Buscamos una persona para desarrollo backend con APIs REST.';

const PROPOSAL = {
  schemaVersion: 'objective_requirement_proposal_v1',
  authority: 'PROPOSAL_ONLY',
  humanConfirmationRequired: true,
  candidates: [
    {
      candidateId: 'cand_01',
      order: 1,
      proposedRequirementText: 'Desarrollo de APIs REST',
      primarySourceReference: { exactExcerpt: 'APIs REST', charStart: 49, charEnd: 58, offsetUnit: 'UNICODE_CODE_POINT' },
      primarySourceGrounding: 'UNIQUE',
      auxiliarySourceReferences: [],
      ambiguousReferences: [],
      unmatchedReferences: [],
      sourceSectionLabel: '',
      exactDuplicateOfEarlier: false,
      confirmableAsSourceDerived: true
    }
  ],
  unresolvedPassages: []
};

const ISSUED = [
  { id: 'cred-1', subjectUserId: HOLDER_ID, status: 'issued' as const, createdAt: NOW, documentEvidences: [], textEvidences: [] }
];

function draft(overrides: Parameters<typeof confirmedRequest>[0] = {}) {
  return confirmedRequest({
    status: 'draft',
    rawObjectiveText: RAW,
    confirmedObjectiveDefinition: null,
    confirmedAt: null,
    ...overrides
  });
}

function world(overrides: Parameters<typeof fakePublicPrisma>[0] = {}) {
  return fakePublicPrisma({ grants: [grant()], credentials: ISSUED, requests: [draft()], ...overrides });
}

/** Proveedor falso: cuenta llamadas y resuelve como se le indique. */
function provider(behavior: () => Promise<unknown> = async () => structuredClone(PROPOSAL)) {
  const calls: unknown[] = [];
  return {
    calls,
    service: {
      propose: async (input: unknown) => {
        calls.push(input);
        return behavior();
      }
    } as never
  };
}

function clockAt(date: Date) {
  let current = date;
  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    }
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof PublicVerificationError, `error inesperado: ${String(error)}`);
    return error.code;
  }
  throw new Error('se esperaba un rechazo');
}

function openAttempt(overrides: Partial<FakeAttempt> = {}): FakeAttempt {
  return {
    id: 'attempt-old',
    verificationRequestId: 'req-row-1',
    sharingGrantId: 'grant-1',
    startedAt: new Date(NOW.getTime() - 30_000),
    leaseExpiresAt: new Date(NOW.getTime() - 30_000 + PROPOSAL_LEASE_MS),
    outcome: null,
    finishedAt: null,
    ...overrides
  };
}

// ===========================================================================
// FLUJO FELIZ Y REPLAY
// ===========================================================================

test('draft -> propuesta -> requirements_proposed, con UNA llamada al proveedor', async () => {
  const state = world();
  const fake = provider();
  const session = await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);

  assert.equal(fake.calls.length, 1);
  assert.equal(session.status, 'requirements_proposed');
  assert.deepEqual(session.proposal, PROPOSAL);
  assert.equal(state.requests[0].status, 'requirements_proposed');
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].outcome, 'SUCCEEDED');
});

test('al proveedor le llega el texto VERBATIM y el tipo de la solicitud, nada del holder', async () => {
  const text = '  Requisitos:\n\t- APIs REST  ';
  const state = world({ requests: [draft({ rawObjectiveText: text, objectiveType: 'SCHOLARSHIP', objectiveTitle: null })] });
  const fake = provider();
  await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);

  assert.deepEqual(fake.calls[0], { objectiveType: 'SCHOLARSHIP', title: '', rawObjectiveText: text });
  const sent = JSON.stringify(fake.calls[0]);
  for (const forbidden of ['cred-1', HOLDER_ID, 'grant-1', 'req-row-1']) {
    assert.equal(sent.includes(forbidden), false, forbidden);
  }
});

test('respuesta HTTP perdida: el reintento devuelve LA MISMA propuesta sin proveedor ni cuota', async () => {
  const state = world();
  const fake = provider();
  const service = new VerificationProposalService(state.prisma, fake.service);
  const clock = clockAt(NOW);

  const first = await service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);
  // Se reintenta DENTRO del cooldown: si consumiera trabajo, fallaria por eso.
  clock.advance(1_000);
  const retried = await service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);

  assert.deepEqual(retried.proposal, first.proposal);
  assert.equal(fake.calls.length, 1, 'ninguna llamada adicional');
  assert.equal(state.attempts.length, 1, 'ninguna cuota adicional');
});

test('una sesion ya confirmada tampoco abre trabajo de proveedor', async () => {
  const state = world({ requests: [confirmedRequest({ rawObjectiveText: RAW })] });
  const fake = provider();
  const session = await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);

  assert.equal(session.status, 'requirements_confirmed');
  assert.equal(fake.calls.length, 0);
});

// ===========================================================================
// CLAIM: UNO ACTIVO POR SOLICITUD
// ===========================================================================

test('dos pedidos concurrentes sobre la misma sesion: UNA sola ejecucion de proveedor', async () => {
  const state = world();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fake = provider(async () => {
    await gate;
    return structuredClone(PROPOSAL);
  });
  const service = new VerificationProposalService(state.prisma, fake.service);

  const first = service.propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);
  // Esperar a que el primero haya reclamado y este dentro del proveedor.
  while (fake.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    await codeOf(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_IN_PROGRESS'
  );
  release();
  await first;

  assert.equal(fake.calls.length, 1);
  assert.equal(state.attempts.length, 1);
});

test('la sesion informa que hay una propuesta en curso', async () => {
  const state = world({ attempts: [openAttempt()] });
  const session = await new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(session.proposalInProgress, true);
});

test('un claim VENCIDO se recupera: el viejo queda DISCARDED y arranca uno nuevo', async () => {
  const stale = openAttempt({
    startedAt: new Date(NOW.getTime() - PROPOSAL_LEASE_MS - 60_000),
    leaseExpiresAt: new Date(NOW.getTime() - 60_000)
  });
  const state = world({ attempts: [stale] });
  const fake = provider();
  await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);

  assert.equal(fake.calls.length, 1);
  assert.equal(state.attempts.find((attempt) => attempt.id === 'attempt-old')!.outcome, 'DISCARDED');
  assert.equal(state.attempts.filter((attempt) => attempt.outcome === 'SUCCEEDED').length, 1);
});

test('FENCING: un resultado tardio del intento supersedido NO se acepta ni pisa al nuevo', async () => {
  const state = world();
  const clock = clockAt(NOW);

  // Intento A arranca y queda colgado en el proveedor.
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const lateProposal = { ...structuredClone(PROPOSAL), candidates: [] };
  const fakeA = provider(async () => {
    await gateA;
    return lateProposal;
  });
  const runA = new VerificationProposalService(state.prisma, fakeA.service).propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);
  while (fakeA.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  // El lease de A vence; B reclama y termina con exito.
  clock.advance(PROPOSAL_LEASE_MS + 1_000);
  const fakeB = provider();
  const sessionB = await new VerificationProposalService(state.prisma, fakeB.service).propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);
  assert.deepEqual(sessionB.proposal, PROPOSAL);

  // Ahora vuelve A.
  releaseA();
  assert.equal(await codeOf(() => runA), 'SESSION_CONFLICT');

  assert.deepEqual(state.requests[0].proposedRequirements, PROPOSAL, 'la propuesta de B sigue intacta');
  assert.equal(state.attempts[0].outcome, 'DISCARDED');
  assert.equal(state.attempts[1].outcome, 'SUCCEEDED');
});

test('lease vencido SIN reclamo: el resultado tardio (ya pagado) SI se acepta', async () => {
  // Vencer solo habilita a OTRO a reclamar. Si nadie reclamo, sigue siendo el
  // unico dueño.
  const state = world();
  const clock = clockAt(NOW);
  const fake = provider(async () => {
    clock.advance(PROPOSAL_LEASE_MS + 60_000);
    return structuredClone(PROPOSAL);
  });
  const session = await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);
  assert.equal(session.status, 'requirements_proposed');
});

// ===========================================================================
// FALLOS DEL PROVEEDOR
// ===========================================================================

test('salida invalida del proveedor: no se persiste nada, el intento cierra FAILED', async () => {
  const state = world();
  const fake = provider(async () => {
    throw new ObjectiveRequirementProposalError('UNABLE_TO_PRODUCE_PROPOSAL', 'artifact_invalid');
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_UNAVAILABLE'
  );
  assert.equal(state.requests[0].proposedRequirements, null);
  assert.equal(state.requests[0].status, 'draft');
  assert.equal(state.attempts[0].outcome, 'FAILED');
});

test('tras un fallo definitivo la solicitud puede reintentarse (sujeta a cooldown y cuota)', async () => {
  const state = world();
  let fail = true;
  const fake = provider(async () => {
    if (fail) throw new ObjectiveRequirementProposalError('UNABLE_TO_PRODUCE_PROPOSAL', 'x');
    return structuredClone(PROPOSAL);
  });
  const service = new VerificationProposalService(state.prisma, fake.service);
  const clock = clockAt(NOW);

  await assert.rejects(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now));
  fail = false;
  assert.equal(await codeOf(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now)), 'PROPOSAL_COOLDOWN_ACTIVE');

  clock.advance(PROPOSAL_COOLDOWN_MS + 1);
  const session = await service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);
  assert.equal(session.status, 'requirements_proposed');
  assert.equal(fake.calls.length, 2);
});

test('fallo de transporte: el intento queda ABIERTO; no se reintenta dentro del lease', async () => {
  // No se sabe si el proveedor sigue corriendo en el ai-service (hasta 300 s).
  const state = world();
  const fake = provider(async () => {
    throw new ObjectiveRequirementProposalError('TEMPORARILY_UNAVAILABLE', 'ai_service_provider_transport_failure');
  });
  const service = new VerificationProposalService(state.prisma, fake.service);
  const clock = clockAt(NOW);

  assert.equal(await codeOf(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now)), 'PROPOSAL_TEMPORARILY_UNAVAILABLE');
  assert.equal(state.attempts[0].outcome, null, 'abierto');

  clock.advance(PROPOSAL_COOLDOWN_MS + 1);
  assert.equal(await codeOf(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now)), 'PROPOSAL_IN_PROGRESS');
  assert.equal(fake.calls.length, 1, 'ningun paralelismo con una llamada que puede seguir viva');
});

test('fallo de transporte: vencido el lease, la solicitud vuelve a poder proponerse', async () => {
  const state = world();
  let fail = true;
  const fake = provider(async () => {
    if (fail) throw new ObjectiveRequirementProposalError('TEMPORARILY_UNAVAILABLE', 'x');
    return structuredClone(PROPOSAL);
  });
  const service = new VerificationProposalService(state.prisma, fake.service);
  const clock = clockAt(NOW);

  await assert.rejects(() => service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now));
  fail = false;
  clock.advance(PROPOSAL_LEASE_MS + 1);
  const session = await service.propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now);

  assert.equal(session.status, 'requirements_proposed');
  assert.equal(state.attempts[0].outcome, 'DISCARDED');
});

test('un error NO tipado del proveedor se trata como desconocido: intento abierto', async () => {
  const state = world();
  const fake = provider(async () => {
    throw new Error('boom');
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_TEMPORARILY_UNAVAILABLE'
  );
  assert.equal(state.attempts[0].outcome, null);
});

// ===========================================================================
// COSTO: CUOTA Y COOLDOWN DEL ENLACE
// ===========================================================================

function priorStarts(count: number, spacingMs: number): FakeAttempt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `prior-${index}`,
    verificationRequestId: `otra-${index}`,
    sharingGrantId: 'grant-1',
    startedAt: new Date(NOW.getTime() - (index + 1) * spacingMs),
    leaseExpiresAt: new Date(NOW.getTime() - (index + 1) * spacingMs + PROPOSAL_LEASE_MS),
    outcome: 'FAILED' as const,
    finishedAt: new Date(NOW.getTime() - (index + 1) * spacingMs + 1_000)
  }));
}

test(`cuota: con ${PROPOSAL_STARTS_PER_SHARE_WINDOW} arranques del enlace en 24 h no hay proveedor`, async () => {
  // Cuentan TODOS los arranques, fallidos incluidos: la cuota es exposicion de costo.
  const state = world({ attempts: priorStarts(PROPOSAL_STARTS_PER_SHARE_WINDOW, 60 * 60 * 1000) });
  const fake = provider();
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_QUOTA_EXCEEDED'
  );
  assert.equal(fake.calls.length, 0);
});

test('cuota: los arranques de hace mas de 24 h no cuentan', async () => {
  const state = world({ attempts: priorStarts(PROPOSAL_STARTS_PER_SHARE_WINDOW, 25 * 60 * 60 * 1000) });
  const fake = provider();
  await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);
  assert.equal(fake.calls.length, 1);
});

test('cooldown: un arranque del MISMO enlace hace menos de 60 s bloquea, aunque sea de otra sesion', async () => {
  const state = world({ attempts: priorStarts(1, 10_000) });
  const fake = provider();
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_COOLDOWN_ACTIVE'
  );
  assert.equal(fake.calls.length, 0);
});

test('un rechazo previo al arranque NO consume cuota', async () => {
  const state = world({ grants: [grant({ verificationPolicy: { enabled: false, policyVersion: 1, authorizedCredentials: [] } })] });
  const fake = provider();
  await assert.rejects(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW));
  assert.equal(state.attempts.length, 0);
});

test('el claim corre en SERIALIZABLE, y un P2034 no arranca proveedor', async () => {
  const serial = world();
  const fakeOk = provider();
  await new VerificationProposalService(serial.prisma, fakeOk.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);
  assert.ok(serial.isolationLevels.every((level) => level === Prisma.TransactionIsolationLevel.Serializable));

  const conflicted = world({
    onTransactionStart: () => {
      throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' });
    }
  });
  const fake = provider();
  assert.equal(
    await codeOf(() => new VerificationProposalService(conflicted.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'SESSION_CONFLICT'
  );
  assert.equal(fake.calls.length, 0);
});

// ===========================================================================
// AUTORIDAD ANTES Y DURANTE LA LLAMADA
// ===========================================================================

test('solicitud vencida: no hay proveedor', async () => {
  const state = world({ requests: [draft({ expiresAt: new Date(NOW.getTime() - 1) })] });
  const fake = provider();
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(fake.calls.length, 0);
});

test('enlace revocado ANTES del proveedor: no hay proveedor', async () => {
  const state = world({ grants: [grant({ revokedAt: NOW })] });
  const fake = provider();
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(fake.calls.length, 0);
});

test('enlace revocado DURANTE el proveedor: la propuesta no se acepta', async () => {
  const state = world();
  const fake = provider(async () => {
    state.grants[0].revokedAt = NOW;
    return structuredClone(PROPOSAL);
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(state.requests[0].proposedRequirements, null);
  assert.equal(state.requests[0].status, 'draft');
  assert.equal(state.attempts[0].outcome, 'DISCARDED', 'la marca SI se commitea');
});

test('politica apagada DURANTE el proveedor: la propuesta no se acepta', async () => {
  const state = world();
  const fake = provider(async () => {
    state.grants[0].verificationPolicy!.enabled = false;
    return structuredClone(PROPOSAL);
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(state.requests[0].proposedRequirements, null);
  assert.equal(state.attempts[0].outcome, 'DISCARDED');
});

test('la sesion se confirmo a mano DURANTE el proveedor: gana la decision humana', async () => {
  const state = world();
  const fake = provider(async () => {
    Object.assign(state.requests[0], { status: 'requirements_confirmed', confirmedObjectiveDefinition: {}, confirmedAt: NOW });
    return structuredClone(PROPOSAL);
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'SESSION_CONFLICT'
  );
  assert.equal(state.requests[0].proposedRequirements, null);
  assert.equal(state.requests[0].status, 'requirements_confirmed');
});

test('la sesion vencio DURANTE el proveedor: la propuesta no se acepta', async () => {
  const state = world({ requests: [draft({ expiresAt: new Date(NOW.getTime() + 5_000) })] });
  const clock = clockAt(NOW);
  const fake = provider(async () => {
    clock.advance(10_000);
    return structuredClone(PROPOSAL);
  });
  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, clock.now)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(state.requests[0].proposedRequirements, null);
});

// ===========================================================================
// PRIVACIDAD
// ===========================================================================

test('la respuesta publica no transporta ids, hash, enlace, politica ni intento', async () => {
  const state = world();
  const session = await new VerificationProposalService(state.prisma, provider().service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);
  const serialized = JSON.stringify(session);
  for (const forbidden of ['req-row-1', 'grant-1', 'attempt-', 'cred-1', 'policyVersion', 'leaseExpiresAt', REQUEST_TOKEN]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('se persiste la propuesta VERIFICADA del nucleo, nunca campos ajenos al DTO', async () => {
  const state = world();
  await new VerificationProposalService(state.prisma, provider().service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);
  const stored = state.requests[0].proposedRequirements as Record<string, unknown>;
  assert.equal(stored.authority, 'PROPOSAL_ONLY');
  assert.equal(stored.humanConfirmationRequired, true);
  for (const forbidden of ['rawProviderResponse', 'prompt', 'model', 'provider']) {
    assert.equal(forbidden in stored, false, forbidden);
  }
});

// ===========================================================================
// TOPE PUBLICO DE REQUISITOS
//
// La confirmacion publica rechaza mas de MAX_VERIFIER_REQUIREMENTS. Exponer una
// propuesta de 34 candidatos no es una propuesta larga: es un estado que el
// verificador no puede confirmar nunca. El tope se pide ANTES, y una propuesta
// excedida cae por el camino de salida inutilizable que ya existia.
// ===========================================================================

/** Proveedor falso que ademas registra el presupuesto de seleccion recibido. */
function budgetAwareProvider(behavior: () => Promise<unknown> = async () => structuredClone(PROPOSAL)) {
  const budgets: (number | undefined)[] = [];
  return {
    budgets,
    service: {
      propose: async (_input: unknown, maxRequirements?: number) => {
        budgets.push(maxRequirements);
        return behavior();
      }
    } as never
  };
}

test(`la propuesta publica se pide acotada a ${MAX_VERIFIER_REQUIREMENTS} requisitos`, async () => {
  const state = world();
  const fake = budgetAwareProvider();
  await new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW);

  assert.deepEqual(fake.budgets, [MAX_VERIFIER_REQUIREMENTS]);
});

test('el tope pedido es el MISMO que exige la confirmacion', () => {
  // Si estos dos numeros se separan, vuelve exactamente el defecto: una propuesta
  // que el producto acepta mostrar y despues rechaza confirmar.
  assert.equal(MAX_VERIFIER_REQUIREMENTS, 12);
});

test('una propuesta excedida no se persiste ni se expone: no hay recorte', async () => {
  const state = world();
  const fake = budgetAwareProvider(async () => {
    // Lo que devuelve el nucleo compartido cuando el artefacto viola el tope.
    throw new ObjectiveRequirementProposalError(
      'UNABLE_TO_PRODUCE_PROPOSAL',
      'candidates_exceed_requested_maximum'
    );
  });

  assert.equal(
    await codeOf(() => new VerificationProposalService(state.prisma, fake.service).propose(SHARE_TOKEN, REQUEST_TOKEN, () => NOW)),
    'PROPOSAL_UNAVAILABLE'
  );
  // Ni propuesta parcial, ni estado avanzado: la sesion sigue siendo un borrador.
  assert.equal(state.requests[0].proposedRequirements, null);
  assert.equal(state.requests[0].status, 'draft');
  // Y la semantica de intentos no cambia: cuota, cooldown y reintento siguen igual.
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].outcome, 'FAILED');
});
