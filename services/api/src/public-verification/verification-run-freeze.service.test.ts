/**
 * Congelamiento del VerificationRun publico.
 *
 * Lo que estos tests defienden, en orden de gravedad:
 *
 *   1. Un run NUNCA mezcla un `policyVersion` de un estado del holder con el
 *      conjunto autorizado de otro, ni sobrevive a una revocacion concurrente.
 *   2. El universo de evidencia es el que el holder AUTORIZO, no su Wallet.
 *   3. La clasificacion es la MISMA que la del holder, disposicion por
 *      disposicion — se ejercita con artifacts de extraccion reales.
 *   4. Nada de esto sale del servidor: ni tokens crudos, ni ids, ni SHAs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import {
  type FakeAnalysisRunSource,
  type FakeCredential,
  presentSlot,
  sha,
  validExtractionArtifact
} from '../reasoning-run/__fixtures__/reasoning-run-freeze.fixture';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import { hashOpaqueToken } from './opaque-token';
import { PublicVerificationError, RETRYABLE_PUBLIC_VERIFICATION_CODES } from './public-verification.errors';
import { VerificationRunFreezeService } from './verification-run-freeze.service';
import {
  HOLDER_ID,
  NOW,
  REQUEST_TOKEN,
  SHARE_TOKEN,
  confirmedRequest,
  fakePublicPrisma,
  grant
} from './__fixtures__/public-verification.fixture';

const PDF_SHA = sha('pdf-content');
const TEXT_SHA = sha('text-content');

function service(prisma: unknown): VerificationRunFreezeService {
  // Slot service REAL: la verificacion de integridad es lo que hay que ejercitar.
  return new VerificationRunFreezeService(prisma as never, new SourceExtractionSlotService({} as never));
}

function credential(id: string, overrides: Partial<FakeCredential> = {}): FakeCredential {
  return {
    id,
    subjectUserId: HOLDER_ID,
    status: 'issued',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    documentEvidences: [],
    textEvidences: [],
    ...overrides
  };
}

function pdf(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    kind: 'pdf' as const,
    mimeType: 'application/pdf',
    sha256: PDF_SHA,
    status: 'current' as const,
    uploadedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides
  };
}

function text(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    sha256: TEXT_SHA,
    status: 'current' as const,
    submittedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides
  };
}

function slotFor(
  id: string,
  credentialId: string,
  evidence: { documentEvidenceId?: string; textEvidenceId?: string; sha: string },
  overrides: Partial<FakeAnalysisRunSource> = {}
): FakeAnalysisRunSource {
  return {
    id,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    sourceSha256: evidence.sha,
    documentEvidenceId: evidence.documentEvidenceId ?? null,
    textEvidenceId: evidence.textEvidenceId ?? null,
    analysisRun: { credentialId },
    ...presentSlot(validExtractionArtifact()),
    ...overrides
  };
}

/** Una credencial con PDF y extraccion valida: evidencia utilizable. */
function usable(id: string, createdAt = '2026-01-01T00:00:00Z') {
  return {
    credential: credential(id, {
      createdAt: new Date(createdAt),
      documentEvidences: [pdf(`doc-${id}`)]
    }),
    source: slotFor(`ars-${id}`, id, { documentEvidenceId: `doc-${id}`, sha: PDF_SHA })
  };
}

function authorized(...ids: string[]) {
  return ids.map((credentialId) => ({ credentialId }));
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

function world(options: {
  grantOverrides?: Parameters<typeof grant>[0];
  requestOverrides?: Parameters<typeof confirmedRequest>[0];
  credentials?: FakeCredential[];
  sources?: FakeAnalysisRunSource[];
  onTransactionStart?: () => void;
} = {}) {
  const one = usable('cred-1');
  return fakePublicPrisma({
    grants: [grant(options.grantOverrides)],
    requests: [confirmedRequest(options.requestOverrides)],
    credentials: options.credentials ?? [one.credential],
    analysisRunSources: options.sources ?? [one.source],
    onTransactionStart: options.onTransactionStart
  });
}

// ===========================================================================
// AUTORIDAD
// ===========================================================================

test('enlace activo + politica habilitada + solicitud confirmada congela un run', async () => {
  const { prisma, runs, requests } = world();
  const result = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.equal(result.outcome, 'CREATED');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'pending');
  assert.equal(runs[0].policyVersionSnapshot, 7);
  assert.equal(requests[0].status, 'consumed');
  assert.deepEqual(requests[0].consumedAt, NOW);
});

test('enlace revocado se rechaza', async () => {
  const { prisma, runs } = world({ grantOverrides: { revokedAt: new Date('2026-09-01T00:00:00Z') } });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
});

test('enlace vencido se rechaza', async () => {
  const { prisma, runs } = world({ grantOverrides: { expiresAt: new Date('2026-09-01T00:00:00Z') } });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
});

test('politica deshabilitada se rechaza', async () => {
  const { prisma, runs } = world({
    grantOverrides: {
      verificationPolicy: { enabled: false, policyVersion: 7, authorizedCredentials: authorized('cred-1') }
    }
  });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
});

test('politica inexistente se rechaza', async () => {
  const { prisma, runs } = world({ grantOverrides: { verificationPolicy: null } });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
});

for (const scope of ['credential', 'credential_and_profile'] as const) {
  test(`alcance no soportado "${scope}" falla cerrado aunque la politica este habilitada`, async () => {
    // No se confia en que la UI hoy solo cree enlaces de perfil.
    const { prisma, runs } = world({ grantOverrides: { scope } });
    assert.equal(
      await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
      'SHARE_NOT_AVAILABLE'
    );
    assert.equal(runs.length, 0);
  });
}

test('una solicitud de OTRO enlace responde como inexistente', async () => {
  const { prisma, runs } = world({ requestOverrides: { sharingGrantId: 'otro-grant' } });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
});

test('solicitud vencida se rechaza y no se consume', async () => {
  const { prisma, runs, requests } = world({
    requestOverrides: { expiresAt: new Date(NOW.getTime() - 1) }
  });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(runs.length, 0);
  assert.equal(requests[0].status, 'requirements_confirmed');
});

for (const status of ['draft', 'requirements_proposed'] as const) {
  test(`solicitud en "${status}" no se congela: los requisitos no estan confirmados`, async () => {
    const { prisma, runs } = world({
      requestOverrides: { status, confirmedObjectiveDefinition: null, confirmedAt: null }
    });
    assert.equal(
      await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
      'REQUEST_NOT_CONFIRMED'
    );
    assert.equal(runs.length, 0);
  });
}

test('una definicion confirmada que no verifica contra objective_definition_v1 se rechaza', async () => {
  const { prisma, runs } = world({
    requestOverrides: { confirmedObjectiveDefinition: { schemaVersion: 'otra' } }
  });
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'OBJECTIVE_DEFINITION_INVALID'
  );
  assert.equal(runs.length, 0);
});

test('una solicitud ya consumida devuelve el run existente y no crea otro', async () => {
  const { prisma, runs } = world();
  const first = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const second = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.equal(first.outcome, 'CREATED');
  assert.deepEqual(second, { outcome: 'ALREADY_FROZEN', status: 'pending' });
  assert.equal(runs.length, 1);
});

test('deshabilitar la politica despues NO vuelve inexistente un run ya congelado', async () => {
  const state = world();
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  state.grants[0].verificationPolicy!.enabled = false;

  const again = await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(again.outcome, 'ALREADY_FROZEN');
  assert.equal(state.runs.length, 1);
});

test('revocar el enlace despues SI corta incluso la consulta idempotente', async () => {
  // La revocacion es la autoridad de orden superior: ni "ya existe" se responde.
  const state = world();
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  state.grants[0].revokedAt = NOW;

  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
});

test('tokens mal formados no llegan a la base', async () => {
  const { prisma } = world();
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun('corto', REQUEST_TOKEN, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(
    await codeOf(() => service(prisma).createFrozenRun(SHARE_TOKEN, 42, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
});

// ===========================================================================
// CARRERAS DE CONSENTIMIENTO
// ===========================================================================

test('policy v7 leida, el holder la cambia a v8: el commit NO crea run', async () => {
  const state = world();
  const freezer = service(state.prisma);

  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(prepared.kind, 'READY');
  if (prepared.kind !== 'READY') return;
  assert.equal(prepared.snapshot.policyVersion, 7);

  // Entre fases: el holder agrega una credencial. El unico escritor incrementa la
  // version en la misma transaccion en que cambia el conjunto.
  const extra = usable('cred-2', '2026-01-05T00:00:00Z');
  state.grants[0].verificationPolicy = {
    enabled: true,
    policyVersion: 8,
    authorizedCredentials: authorized('cred-1', 'cred-2')
  };

  assert.equal(
    await codeOf(() => freezer.commit(prepared.snapshot, NOW)),
    'AUTHORIZATION_CHANGED'
  );
  assert.equal(state.runs.length, 0, 'ningun run');
  assert.equal(state.requests[0].status, 'requirements_confirmed', 'la solicitud sigue disponible');
  void extra;
});

test('el reintento despues de AUTHORIZATION_CHANGED congela con la politica NUEVA', async () => {
  // No se reconstruye en silencio dentro del mismo intento, pero un intento
  // nuevo si lee el consentimiento vigente.
  const one = usable('cred-1');
  const two = usable('cred-2', '2026-01-05T00:00:00Z');
  const state = fakePublicPrisma({
    grants: [grant()],
    requests: [confirmedRequest()],
    credentials: [one.credential, two.credential],
    analysisRunSources: [one.source, two.source]
  });
  const freezer = service(state.prisma);

  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');
  state.grants[0].verificationPolicy = {
    enabled: true,
    policyVersion: 8,
    authorizedCredentials: authorized('cred-1', 'cred-2')
  };
  await assert.rejects(() => freezer.commit(prepared.snapshot, NOW));

  const retried = await freezer.createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(retried.outcome, 'CREATED');
  assert.equal(state.runs[0].policyVersionSnapshot, 8);
  assert.deepEqual(
    state.runs[0].inventory.map((row) => row.credentialId),
    ['cred-1', 'cred-2']
  );
});

test('version igual con conjunto distinto falla cerrado: nunca se mezclan', async () => {
  // No deberia existir: el escritor incrementa la version. Si aparece, no se
  // congela la mezcla.
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');

  state.grants[0].verificationPolicy!.authorizedCredentials = authorized('cred-1', 'cred-otra');

  assert.equal(
    await codeOf(() => freezer.commit(prepared.snapshot, NOW)),
    'AUTHORIZATION_CHANGED'
  );
  assert.equal(state.runs.length, 0);
});

test('el enlace se revoca entre preparacion y persistencia: NO se crea run', async () => {
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');

  // Una lectura anterior del token no es autoridad permanente.
  state.grants[0].revokedAt = NOW;

  assert.equal(
    await codeOf(() => freezer.commit(prepared.snapshot, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].status, 'requirements_confirmed');
});

test('la politica se deshabilita entre fases: NO se crea run', async () => {
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');

  state.grants[0].verificationPolicy!.enabled = false;

  assert.equal(
    await codeOf(() => freezer.commit(prepared.snapshot, NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(state.runs.length, 0);
});

test('un PUT identico que no mueve la version NO invalida un congelamiento legitimo', async () => {
  // Reenviar la misma politica es idempotente del lado del holder: no escribe ni
  // versiona. Este run tiene que seguir adelante.
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');

  // Mismo estado, reescrito por referencia (y en otro orden: es un conjunto).
  state.grants[0].verificationPolicy = {
    enabled: true,
    policyVersion: 7,
    authorizedCredentials: authorized('cred-1')
  };

  const result = await freezer.commit(prepared.snapshot, NOW);
  assert.equal(result.outcome, 'CREATED');
  assert.equal(state.runs.length, 1);
});

test('la persistencia corre en UNA transaccion SERIALIZABLE', async () => {
  const state = world();
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.deepEqual(state.isolationLevels, [Prisma.TransactionIsolationLevel.Serializable]);
});

test('un conflicto de serializacion se traduce en FREEZE_CONFLICT, reintentable', async () => {
  const state = world({
    onTransactionStart: () => {
      throw new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: 'test'
      });
    }
  });
  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'FREEZE_CONFLICT'
  );
  assert.equal(state.runs.length, 0);
});

test('si otro intento consumio la solicitud dentro de la ventana, no se crea un segundo run', async () => {
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');

  // El otro intento ya congelo.
  await freezer.createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(state.runs.length, 1);

  const late = await freezer.commit(prepared.snapshot, NOW);
  assert.equal(late.outcome, 'ALREADY_FROZEN');
  assert.equal(state.runs.length, 1, 'una solicitud, a lo sumo un run');
});

// ===========================================================================
// INVENTARIO
// ===========================================================================

test('una credencial autorizada utilizable queda INCLUDED con src_01', async () => {
  const { prisma, runs } = world();
  const result = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.equal(result.outcome, 'CREATED');
  const [row] = runs[0].inventory;
  assert.equal(row.credentialId, 'cred-1');
  assert.equal(row.disposition, 'INCLUDED');
  assert.equal(row.runLocalSourceId, 'src_01');
  assert.equal(row.selectedAnalysisRunSourceId, 'ars-cred-1');
  assert.match(row.artifactBlobSha256, /^[a-f0-9]{64}$/);
});

test('varias credenciales autorizadas: src_NN en el orden estable (createdAt, id)', async () => {
  // Autorizadas en orden inverso al de creacion: la numeracion NO sigue el orden
  // del consentimiento, sigue el orden estable de credenciales.
  const late = usable('cred-b', '2026-03-01T00:00:00Z');
  const early = usable('cred-a', '2026-01-01T00:00:00Z');
  const state = fakePublicPrisma({
    grants: [
      grant({
        verificationPolicy: {
          enabled: true,
          policyVersion: 7,
          authorizedCredentials: authorized('cred-b', 'cred-a')
        }
      })
    ],
    requests: [confirmedRequest()],
    credentials: [late.credential, early.credential],
    analysisRunSources: [late.source, early.source]
  });

  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.deepEqual(
    state.runs[0].inventory.map((row) => [row.credentialId, row.runLocalSourceId]),
    [
      ['cred-a', 'src_01'],
      ['cred-b', 'src_02']
    ]
  );
});

test('el universo es el conjunto AUTORIZADO, no el Wallet del holder', async () => {
  const yes = usable('cred-autorizada');
  const no = usable('cred-no-autorizada', '2026-01-02T00:00:00Z');
  const state = fakePublicPrisma({
    grants: [
      grant({
        verificationPolicy: {
          enabled: true,
          policyVersion: 7,
          authorizedCredentials: authorized('cred-autorizada')
        }
      })
    ],
    requests: [confirmedRequest()],
    credentials: [yes.credential, no.credential],
    analysisRunSources: [yes.source, no.source]
  });

  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.deepEqual(
    state.runs[0].inventory.map((row) => row.credentialId),
    ['cred-autorizada'],
    'una credencial emitida pero NO autorizada no entra ni como fila excluida'
  );
});

test('autorizada y revocada ANTES del run: queda registrada, excluida, fuera del grounding', async () => {
  // Distingue "el holder la autorizo" de "fue evidencia utilizable".
  const good = usable('cred-a');
  const state = fakePublicPrisma({
    grants: [
      grant({
        verificationPolicy: {
          enabled: true,
          policyVersion: 7,
          authorizedCredentials: authorized('cred-a', 'cred-b')
        }
      })
    ],
    requests: [confirmedRequest()],
    credentials: [
      good.credential,
      credential('cred-b', {
        status: 'revoked',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        documentEvidences: [pdf('doc-cred-b')]
      })
    ],
    analysisRunSources: [good.source]
  });

  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const revoked = state.runs[0].inventory.find((row) => row.credentialId === 'cred-b')!;

  assert.equal(revoked.disposition, 'EXCLUDED_CREDENTIAL_STATE_REVOKED');
  assert.equal(revoked.runLocalSourceId, null);
  assert.equal(revoked.selectedAnalysisRunSourceId, null);
  assert.equal(revoked.documentEvidenceId, null, 'fila credential-level: sus fuentes no se enumeran');
});

test('autorizada sin ninguna fuente: EXCLUDED_NO_GROUNDING_SOURCE', async () => {
  const good = usable('cred-a');
  const state = fakePublicPrisma({
    grants: [
      grant({
        verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-a', 'cred-vacia') }
      })
    ],
    requests: [confirmedRequest()],
    credentials: [good.credential, credential('cred-vacia', { createdAt: new Date('2026-02-01T00:00:00Z') })],
    analysisRunSources: [good.source]
  });

  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const empty = state.runs[0].inventory.find((row) => row.credentialId === 'cred-vacia')!;
  assert.equal(empty.disposition, 'EXCLUDED_NO_GROUNDING_SOURCE');
});

test('documento no soportado, fuente reemplazada y representacion alterna usan las disposiciones del holder', async () => {
  const state = fakePublicPrisma({
    grants: [grant({ verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-1') } })],
    requests: [confirmedRequest()],
    credentials: [
      credential('cred-1', {
        documentEvidences: [
          pdf('doc-actual'),
          pdf('doc-viejo', { status: 'replaced', sha256: sha('viejo'), uploadedAt: new Date('2025-12-01T00:00:00Z') }),
          { id: 'img-1', kind: 'image' as const, mimeType: 'image/png', sha256: sha('img'), status: 'current' as const, uploadedAt: new Date('2026-01-03T00:00:00Z') }
        ],
        textEvidences: [text('text-alterno')]
      })
    ],
    analysisRunSources: [slotFor('ars-1', 'cred-1', { documentEvidenceId: 'doc-actual', sha: PDF_SHA })]
  });

  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const byEvidence = Object.fromEntries(
    state.runs[0].inventory.map((row) => [row.documentEvidenceId ?? row.textEvidenceId, row.disposition])
  );

  assert.deepEqual(byEvidence, {
    'doc-viejo': 'EXCLUDED_SOURCE_SUPERSEDED',
    'img-1': 'EXCLUDED_UNSUPPORTED_TYPE',
    'text-alterno': 'EXCLUDED_ALTERNATE_REPRESENTATION',
    'doc-actual': 'INCLUDED'
  });
});

test('extraccion ausente: BLOCKED_EXTRACTION_UNAVAILABLE NO crea run, NO consume, y es reintentable', async () => {
  const good = usable('cred-a');
  const state = fakePublicPrisma({
    grants: [grant({ verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-a', 'cred-sin-slot') } })],
    requests: [confirmedRequest()],
    credentials: [
      good.credential,
      credential('cred-sin-slot', { createdAt: new Date('2026-02-01T00:00:00Z'), documentEvidences: [pdf('doc-sin-slot')] })
    ],
    analysisRunSources: [good.source]
  });

  // Politica publica: aunque haya un INCLUDED, un solo bloqueo impide el run.
  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE'
  );
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].status, 'requirements_confirmed');
  assert.equal(state.requests[0].consumedAt, null);
  assert.ok(RETRYABLE_PUBLIC_VERIFICATION_CODES.has('AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE'));

  // Cuando la extraccion aparece, el MISMO token congela normalmente.
  state.prisma.analysisRunSource = fakePublicPrisma({
    credentials: [
      good.credential,
      credential('cred-sin-slot', { createdAt: new Date('2026-02-01T00:00:00Z'), documentEvidences: [pdf('doc-sin-slot')] })
    ],
    analysisRunSources: [good.source, slotFor('ars-nuevo', 'cred-sin-slot', { documentEvidenceId: 'doc-sin-slot', sha: PDF_SHA })]
  }).prisma.analysisRunSource;
  const retried = await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(retried.outcome, 'CREATED');
  assert.equal(state.runs[0].status, 'pending');
  assert.equal(state.runs[0].failureCode, null);
});

test('fallo de integridad: bloquea el run publico y NO cae a un candidato anterior valido', async () => {
  // LATEST_STRUCTURALLY_PRESENT_CANDIDATE_THEN_VERIFY_FAIL_CLOSED.
  const good = usable('cred-a');
  const corrupt = slotFor(
    'ars-corrupto',
    'cred-b',
    { documentEvidenceId: 'doc-b', sha: PDF_SHA },
    { createdAt: new Date('2026-03-01T00:00:00Z'), artifactBlobSha256: 'f'.repeat(64) }
  );
  const olderValid = slotFor('ars-viejo-valido', 'cred-b', { documentEvidenceId: 'doc-b', sha: PDF_SHA });

  const state = fakePublicPrisma({
    grants: [grant({ verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-a', 'cred-b') } })],
    requests: [confirmedRequest()],
    credentials: [good.credential, credential('cred-b', { createdAt: new Date('2026-02-01T00:00:00Z'), documentEvidences: [pdf('doc-b')] })],
    analysisRunSources: [good.source, corrupt, olderValid]
  });

  // Si hubiera caido al candidato anterior valido, cred-b seria INCLUDED y se
  // congelaria un run. El bloqueo prueba el fail-closed del clasificador.
  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE'
  );
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].consumedAt, null);
});

test('cero INCLUDED: NO_USABLE_AUTHORIZED_EVIDENCE, sin run y sin consumir la solicitud', async () => {
  const state = fakePublicPrisma({
    grants: [grant({ verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-rev') } })],
    requests: [confirmedRequest()],
    credentials: [credential('cred-rev', { status: 'revoked' })]
  });

  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'NO_USABLE_AUTHORIZED_EVIDENCE'
  );
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].status, 'requirements_confirmed');
  assert.equal(state.requests[0].consumedAt, null);
});

test('cero INCLUDED con todo bloqueado: reintentable, no NO_USABLE (el bloqueo va primero)', async () => {
  const state = fakePublicPrisma({
    grants: [grant()],
    requests: [confirmedRequest()],
    credentials: [credential('cred-1', { documentEvidences: [pdf('doc-1')] })]
  });

  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE'
  );
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].consumedAt, null);
});

test('una autorizacion que ya no apunta a una credencial del holder falla cerrado', async () => {
  const state = fakePublicPrisma({
    grants: [grant({ verificationPolicy: { enabled: true, policyVersion: 7, authorizedCredentials: authorized('cred-1', 'cred-ajena') } })],
    requests: [confirmedRequest()],
    credentials: [usable('cred-1').credential, credential('cred-ajena', { subjectUserId: 'otro-holder' })],
    analysisRunSources: [usable('cred-1').source]
  });

  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'AUTHORIZED_EVIDENCE_INCONSISTENT'
  );
  assert.equal(state.runs.length, 0);
});

test('revocar una credencial DESPUES del congelamiento no reescribe el inventario', async () => {
  const one = usable('cred-1');
  const state = fakePublicPrisma({
    grants: [grant()],
    requests: [confirmedRequest()],
    credentials: [one.credential],
    analysisRunSources: [one.source]
  });
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const before = structuredClone(state.runs[0].inventory);

  one.credential.status = 'revoked';
  // Reintento idempotente: no hay recomputo.
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.deepEqual(state.runs[0].inventory, before);
  assert.equal(state.runs.length, 1);
});

// ===========================================================================
// FUNDACION: nada se ejecuta
// ===========================================================================

test('los cuatro slots de etapa quedan en null', async () => {
  const { prisma, runs } = world();
  await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.equal(runs[0].objectiveAnalysisArtifact, null);
  assert.equal(runs[0].evidenceUnitsArtifact, null);
  assert.equal(runs[0].resultArtifact, null);
  assert.equal(runs[0].executionMetadata, null);
});

test('el snapshot del objetivo se congela EXACTO desde la definicion confirmada', async () => {
  const { prisma, runs, requests } = world();
  const definition = structuredClone(requests[0].confirmedObjectiveDefinition);
  await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.deepEqual(runs[0].objectiveDefinitionSnapshot, definition);
  assert.equal(runs[0].objectiveTitleSnapshot, 'Backend Developer Junior');
});

// ===========================================================================
// PRIVACIDAD
// ===========================================================================

test('no existe un token de resultado: el run no guarda ningun secreto propio', async () => {
  // La autoridad sobre el resultado es el token de la solicitud. Un segundo
  // secreto irrecuperable dejaria al verificador sin acceso si perdiera la
  // respuesta de la ejecucion.
  const { prisma, runs } = world();
  const result = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.equal('resultToken' in result, false);
  assert.equal('resultTokenHash' in runs[0], false);
  assert.equal(JSON.stringify(runs[0]).includes(hashOpaqueToken(REQUEST_TOKEN)), false,
    'el run tampoco copia el hash del token de la solicitud');
});

test('el resultado del congelamiento no transporta ids, SHAs, storage ni src_NN', async () => {
  const { prisma } = world();
  const result = await service(prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const serialized = JSON.stringify(result);

  assert.deepEqual(Object.keys(result).sort(), [
    'blockedSourceCount',
    'includedSourceCount',
    'inventorySize',
    'outcome',
    'status'
  ]);
  for (const forbidden of ['cred-1', 'grant-1', 'req-row-1', 'ars-cred-1', 'doc-cred-1', 'src_01', PDF_SHA, 'storageKey']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('respuesta de ejecucion perdida: el MISMO token de solicitud recupera el MISMO run', async () => {
  const state = world();
  const freezer = service(state.prisma);

  // La primera respuesta se pierde en la red; el verificador no vio nada.
  await freezer.createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  const retried = await freezer.createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const resolved = await freezer.resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.deepEqual(retried, { outcome: 'ALREADY_FROZEN', status: 'pending' });
  assert.deepEqual(resolved, { kind: 'FROZEN', status: 'pending' });
  assert.equal(state.runs.length, 1, 'ningun run adicional');
});

test('los errores publicos no filtran ids ni el conjunto autorizado', async () => {
  const state = world();
  const freezer = service(state.prisma);
  const prepared = await freezer.prepare(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  if (prepared.kind !== 'READY') throw new Error('esperaba READY');
  state.grants[0].verificationPolicy!.policyVersion = 8;

  try {
    await freezer.commit(prepared.snapshot, NOW);
    assert.fail('esperaba rechazo');
  } catch (error) {
    const body = JSON.stringify((error as PublicVerificationError).getResponse());
    for (const forbidden of ['cred-1', 'grant-1', 'req-row-1', '7', '8']) {
      assert.equal(body.includes(forbidden), false, forbidden);
    }
  }
});

// ===========================================================================
// SESION: el token de la solicitud resuelve su run
// ===========================================================================

const PAST = new Date(NOW.getTime() - 60 * 60 * 1000);

test('solicitud vigente sin run: NOT_FROZEN', async () => {
  const { prisma } = world();
  assert.deepEqual(await service(prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, NOW), {
    kind: 'NOT_FROZEN'
  });
});

test('ADDENDUM A.1 — solicitud vencida SIN consumir: la ejecucion se niega', async () => {
  const state = world({ requestOverrides: { expiresAt: PAST } });

  assert.equal(
    await codeOf(() => service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(
    await codeOf(() => service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
  assert.equal(state.runs.length, 0);
});

/** Congela en `NOW` y deja la solicitud con su vencimiento ya en el pasado. */
async function frozenThenRequestExpired() {
  const state = world({ requestOverrides: { expiresAt: new Date(NOW.getTime() + 60_000) } });
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const later = new Date(NOW.getTime() + 48 * 60 * 60 * 1000);
  const expiresAt = state.requests[0].expiresAt;
  assert.ok(expiresAt <= later, 'premisa: la solicitud ya vencio');
  return { state, later, expiresAt };
}

test('ADDENDUM A.2 — consumida + run + solicitud vencida: el mismo token resuelve el run', async () => {
  const { state, later, expiresAt } = await frozenThenRequestExpired();

  assert.deepEqual(await service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, later), {
    kind: 'FROZEN',
    status: 'pending'
  });
  // Y el reintento de ejecucion tambien lo resuelve, sin crear otro.
  assert.deepEqual(await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, later), {
    outcome: 'ALREADY_FROZEN',
    status: 'pending'
  });
  assert.equal(state.runs.length, 1);
  // No se simula reseteando ni extendiendo el vencimiento.
  assert.deepEqual(state.requests[0].expiresAt, expiresAt);
});

test('ADDENDUM A.3 — mismo caso con el enlace REVOCADO: acceso negado', async () => {
  const { state, later } = await frozenThenRequestExpired();
  state.grants[0].revokedAt = later;

  assert.equal(
    await codeOf(() => service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, later)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(state.runs.length, 1, 'el run se conserva: se corta el acceso, no la historia');
});

test('ADDENDUM A.4 — mismo caso con el enlace VENCIDO: acceso negado', async () => {
  const { state, later } = await frozenThenRequestExpired();
  state.grants[0].expiresAt = new Date(later.getTime() - 1);

  assert.equal(
    await codeOf(() => service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, later)),
    'SHARE_NOT_AVAILABLE'
  );
  assert.equal(state.runs.length, 1);
});

test('deshabilitar la politica NO oculta un run ya congelado a su sesion', async () => {
  const { state, later } = await frozenThenRequestExpired();
  state.grants[0].verificationPolicy!.enabled = false;

  assert.deepEqual(await service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, later), {
    kind: 'FROZEN',
    status: 'pending'
  });
});

test('el token de una solicitud NO resuelve el run de otro enlace', async () => {
  const state = world();
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  state.requests[0].sharingGrantId = 'otro-grant';

  assert.equal(
    await codeOf(() => service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
});

test('la resolucion de sesion no expone ids ni SHAs', async () => {
  const state = world();
  await service(state.prisma).createFrozenRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  const resolved = await service(state.prisma).resolveSessionRun(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.deepEqual(Object.keys(resolved).sort(), ['kind', 'status']);
});
