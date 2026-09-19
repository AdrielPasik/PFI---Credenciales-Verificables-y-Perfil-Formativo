/**
 * Borrador y lectura de la sesion anonima del verificador.
 *
 * Sin proveedor: fija el modelo de token, el vencimiento, los limites de entrada
 * y la frontera de ALMACENAMIENTO, que es distinta de la de costo de proveedor.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { hashOpaqueToken } from './opaque-token';
import { MAX_ACTIVE_REQUESTS_PER_SHARE } from './public-verification.limits';
import { PublicVerificationError } from './public-verification.errors';
import {
  MAX_VERIFIER_OBJECTIVE_CODE_POINTS,
  MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH,
  VERIFICATION_REQUEST_TTL_MS,
  VerificationRequestService
} from './verification-request.service';
import {
  HOLDER_ID,
  NOW,
  REQUEST_TOKEN,
  SHARE_TOKEN,
  confirmedRequest,
  fakePublicPrisma,
  grant
} from './__fixtures__/public-verification.fixture';

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof PublicVerificationError, `error inesperado: ${String(error)}`);
    return error.code;
  }
  throw new Error('se esperaba un rechazo');
}

const ISSUED = [
  { id: 'cred-1', subjectUserId: HOLDER_ID, status: 'issued' as const, createdAt: NOW, documentEvidences: [], textEvidences: [] }
];

function world(overrides: Parameters<typeof fakePublicPrisma>[0] = {}) {
  return fakePublicPrisma({ grants: [grant()], credentials: ISSUED, ...overrides });
}

const VALID = {
  rawObjectiveText: 'Buscamos una persona para desarrollo backend.',
  objectiveType: 'EMPLOYMENT',
  objectiveTitle: 'Backend'
};

// ===========================================================================
// BORRADOR
// ===========================================================================

test('enlace activo + politica + evidencia: crea el borrador; token crudo UNA vez, solo su hash persiste', async () => {
  const state = world();
  const created = await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW);

  assert.match(created.requestToken, /^[A-Za-z0-9_-]{43}$/);
  const row = state.createdRequests[0];
  assert.equal(row.requestTokenHash, hashOpaqueToken(created.requestToken));
  assert.equal(JSON.stringify(row).includes(created.requestToken), false, 'el token crudo no toca la base');
  assert.equal(row.status, 'draft');
  assert.equal(row.objectiveType, 'EMPLOYMENT');
  assert.equal(created.session.status, 'draft');
});

test('la creacion corre en UNA transaccion SERIALIZABLE (conteo + insercion)', async () => {
  const state = world();
  await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW);
  assert.deepEqual(state.isolationLevels, [Prisma.TransactionIsolationLevel.Serializable]);
});

test('vence a las 24 h de la creacion', async () => {
  const state = world();
  const created = await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW);

  assert.equal(VERIFICATION_REQUEST_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(created.session.expiresAt, new Date(NOW.getTime() + VERIFICATION_REQUEST_TTL_MS).toISOString());
});

test('el texto se guarda VERBATIM: sin trim, igual que el contrato del holder', async () => {
  // Los offsets de la propuesta se calculan sobre el texto exacto.
  const state = world();
  const text = '  Requisitos:\n\t- APIs REST\r\n  ';
  await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, { ...VALID, rawObjectiveText: text }, NOW);
  assert.equal(state.createdRequests[0].rawObjectiveText, text);
});

test('politica deshabilitada: no se abre borrador', async () => {
  const state = world({
    grants: [grant({ verificationPolicy: { enabled: false, policyVersion: 1, authorizedCredentials: [{ credentialId: 'cred-1' }] } })]
  });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(state.requests.length, 0);
});

test('cero credenciales autorizadas efectivas: no se abre borrador', async () => {
  // La misma regla que `contextualVerificationEnabled` del perfil publico.
  const state = world({
    credentials: [{ ...ISSUED[0], status: 'revoked' as const }]
  });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW)),
    'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  );
  assert.equal(state.requests.length, 0);
});

for (const [label, overrides] of [
  ['revocado', { revokedAt: NOW }],
  ['vencido', { expiresAt: new Date(NOW.getTime() - 1) }],
  ['alcance no soportado', { scope: 'credential' as const }]
] as const) {
  test(`enlace ${label}: no se abre borrador`, async () => {
    const state = world({ grants: [grant(overrides as never)] });
    assert.equal(
      await codeOf(() => new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW)),
      'SHARE_NOT_AVAILABLE'
    );
    assert.equal(state.requests.length, 0);
  });
}

test(`tope de ${MAX_ACTIVE_REQUESTS_PER_SHARE} sesiones ABIERTAS por enlace`, async () => {
  const open = Array.from({ length: MAX_ACTIVE_REQUESTS_PER_SHARE }, (_, index) =>
    confirmedRequest({ id: `open-${index}`, requestTokenHash: `hash-${index}`, status: 'draft', confirmedObjectiveDefinition: null, confirmedAt: null })
  );
  const state = world({ requests: open });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW)),
    'ACTIVE_REQUEST_LIMIT_REACHED'
  );
  assert.equal(state.requests.length, MAX_ACTIVE_REQUESTS_PER_SHARE);
});

test('sesiones vencidas o consumidas NO cuentan para el tope', async () => {
  const past = new Date(NOW.getTime() - 1);
  const closed = Array.from({ length: MAX_ACTIVE_REQUESTS_PER_SHARE }, (_, index) =>
    index % 2 === 0
      ? confirmedRequest({ id: `exp-${index}`, requestTokenHash: `h-${index}`, status: 'draft', expiresAt: past, confirmedObjectiveDefinition: null, confirmedAt: null })
      : confirmedRequest({ id: `con-${index}`, requestTokenHash: `h-${index}`, status: 'consumed', consumedAt: past })
  );
  const state = world({ requests: closed });
  await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW);
  assert.equal(state.createdRequests.length, 1);
});

test('crear un borrador NO consume cuota de proveedor', async () => {
  const state = world();
  await new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, VALID, NOW);
  assert.equal(state.attempts.length, 0);
});

test('el texto se limita en CODE POINTS, no en unidades UTF-16', async () => {
  const state = world();
  const service = new VerificationRequestService(state.prisma);
  const atLimit = String.fromCodePoint(0x1f600).repeat(MAX_VERIFIER_OBJECTIVE_CODE_POINTS);
  await service.createDraft(SHARE_TOKEN, { ...VALID, rawObjectiveText: atLimit }, NOW);
  assert.equal(
    await codeOf(() => service.createDraft(SHARE_TOKEN, { ...VALID, rawObjectiveText: `${atLimit}a` }, NOW)),
    'INVALID_REQUEST_INPUT'
  );
});

test('el techo anonimo es 8.000, no los 60.000 del holder', () => {
  assert.equal(MAX_VERIFIER_OBJECTIVE_CODE_POINTS, 8_000);
  assert.equal(MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH, 200);
});

const NUL = String.fromCharCode(0);

for (const [label, body] of [
  ['body no objeto', 'texto'],
  ['texto en blanco', { ...VALID, rawObjectiveText: '   ' }],
  ['texto no string', { ...VALID, rawObjectiveText: 12 }],
  ['caracter de control', { ...VALID, rawObjectiveText: `hola${NUL}mundo` }],
  ['sin tipo de objetivo', { rawObjectiveText: 'hola' }],
  ['tipo de objetivo desconocido', { ...VALID, objectiveType: 'CANDIDATE_RANKING' }],
  ['credenciales coladas', { ...VALID, credentialIds: ['cred-1'] }],
  ['holder colado', { ...VALID, holderUserId: 'x' }],
  ['titulo demasiado largo', { ...VALID, objectiveTitle: 'x'.repeat(201) }],
  ['titulo multilinea', { ...VALID, objectiveTitle: 'a\nb' }]
] as Array<[string, unknown]>) {
  test(`entrada invalida: ${label}`, async () => {
    const state = world();
    assert.equal(
      await codeOf(() => new VerificationRequestService(state.prisma).createDraft(SHARE_TOKEN, body, NOW)),
      'INVALID_REQUEST_INPUT'
    );
    assert.equal(state.requests.length, 0);
  });
}

// ===========================================================================
// LECTURA DE SESION
// ===========================================================================

test('lee la propia sesion con el token de la solicitud', async () => {
  const state = world({ requests: [confirmedRequest({ status: 'draft', confirmedObjectiveDefinition: null, confirmedAt: null })] });
  const session = await new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(session.status, 'draft');
  assert.equal(session.rawObjectiveText, 'Buscamos una persona para desarrollo backend.');
  assert.equal(session.proposalInProgress, false);
});

test('la proyeccion de sesion es una allowlist: sin ids, hash, enlace ni politica', async () => {
  const state = world({ requests: [confirmedRequest()] });
  const session = await new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW);

  assert.deepEqual(Object.keys(session).sort(), [
    'confirmedAt',
    'confirmedObjectiveDefinition',
    'createdAt',
    'expiresAt',
    'objectiveTitle',
    'objectiveType',
    'proposal',
    'proposalInProgress',
    'rawObjectiveText',
    'status'
  ]);
  const serialized = JSON.stringify(session);
  for (const forbidden of ['req-row-1', 'grant-1', hashOpaqueToken(REQUEST_TOKEN), REQUEST_TOKEN, 'policyVersion', 'cred-1', 'sharingGrantId']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('sesion vencida sin consumir: ya no se lee', async () => {
  const state = world({ requests: [confirmedRequest({ expiresAt: new Date(NOW.getTime() - 1) })] });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
});

test('la lectura NO exige politica: apagarla no oculta la sesion propia', async () => {
  const state = world({
    grants: [grant({ verificationPolicy: { enabled: false, policyVersion: 1, authorizedCredentials: [] } })],
    requests: [confirmedRequest()]
  });
  const session = await new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW);
  assert.equal(session.status, 'requirements_confirmed');
});

test('enlace revocado: la lectura se niega', async () => {
  const state = world({ grants: [grant({ revokedAt: NOW })], requests: [confirmedRequest()] });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'SHARE_NOT_AVAILABLE'
  );
});

test('el token de una solicitud de OTRO enlace no lee nada', async () => {
  const state = world({ requests: [confirmedRequest({ sharingGrantId: 'otro' })] });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, REQUEST_TOKEN, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
});

test('sin token de sesion: REQUEST_NOT_AVAILABLE', async () => {
  const state = world({ requests: [confirmedRequest()] });
  assert.equal(
    await codeOf(() => new VerificationRequestService(state.prisma).readSession(SHARE_TOKEN, undefined, NOW)),
    'REQUEST_NOT_AVAILABLE'
  );
});
