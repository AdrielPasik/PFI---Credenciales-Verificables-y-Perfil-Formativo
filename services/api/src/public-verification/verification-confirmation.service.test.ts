/**
 * Confirmacion humana de requisitos.
 *
 * El verificador confirma el criterio; el sistema valida con EXACTAMENTE el mismo
 * contrato que un Objective del holder. Sin proveedor.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { MAX_VERIFIER_REQUIREMENTS } from './public-verification.limits';
import { PublicVerificationError } from './public-verification.errors';
import { VerificationConfirmationService } from './verification-confirmation.service';
import {
  HOLDER_ID,
  NOW,
  REQUEST_TOKEN,
  SHARE_TOKEN,
  confirmedRequest,
  fakePublicPrisma,
  grant
} from './__fixtures__/public-verification.fixture';

const RAW = 'Buscamos una persona para desarrollo backend con APIs REST y SQL.';

const ISSUED = [
  { id: 'cred-1', subjectUserId: HOLDER_ID, status: 'issued' as const, createdAt: NOW, documentEvidences: [], textEvidences: [] }
];

function proposed(overrides: Parameters<typeof confirmedRequest>[0] = {}) {
  return confirmedRequest({
    status: 'requirements_proposed',
    rawObjectiveText: RAW,
    proposedRequirements: { authority: 'PROPOSAL_ONLY' },
    confirmedObjectiveDefinition: null,
    confirmedAt: null,
    ...overrides
  });
}

function world(overrides: Parameters<typeof fakePublicPrisma>[0] = {}) {
  return fakePublicPrisma({ grants: [grant()], credentials: ISSUED, requests: [proposed()], ...overrides });
}

const DERIVED = { requirementText: 'Desarrollo de APIs REST', provenanceKind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: 'APIs REST' };
const EDITED = { requirementText: 'Diseño y desarrollo de APIs REST', provenanceKind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null };
const MANUAL = { requirementText: 'Experiencia con Docker', provenanceKind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null };

function manual(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    requirementText: `Requisito manual ${index + 1}`,
    provenanceKind: 'DIRECT_STRUCTURED_INPUT',
    sourceQuote: null
  }));
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

const confirm = (state: ReturnType<typeof world>, body: unknown, now = NOW) =>
  new VerificationConfirmationService(state.prisma).confirm(SHARE_TOKEN, REQUEST_TOKEN, body, now);

// ===========================================================================
// CONFIRMAR
// ===========================================================================

test('requirements_proposed -> requirements_confirmed con un objective_definition_v1 valido', async () => {
  const state = world();
  const session = await confirm(state, { requirements: [DERIVED, MANUAL] });

  assert.equal(session.status, 'requirements_confirmed');
  assert.equal(state.requests[0].status, 'requirements_confirmed');
  assert.deepEqual(state.requests[0].confirmedAt, NOW);
  // Verifica contra el MISMO verificador productivo del holder.
  verifyObjectiveDefinitionArtifact(state.requests[0].confirmedObjectiveDefinition);
});

test('el servidor fija tipo y fuente: el texto original PERSISTIDO, verbatim', async () => {
  const state = world({ requests: [proposed({ objectiveType: 'ADMISSION' })] });
  await confirm(state, { requirements: [DERIVED] });
  const definition = state.requests[0].confirmedObjectiveDefinition as Record<string, any>;

  assert.equal(definition.objectiveType, 'ADMISSION');
  assert.deepEqual(definition.source, { inputType: 'PASTED_TEXT', originalText: RAW });
  assert.equal(state.requests[0].rawObjectiveText, RAW, 'el texto original no se reescribe');
});

test('ids y orden los asigna el servidor, no el verificador', async () => {
  const state = world();
  await confirm(state, { requirements: [MANUAL, DERIVED] });
  const definition = state.requests[0].confirmedObjectiveDefinition as Record<string, any>;
  assert.deepEqual(
    definition.requirements.map((requirement: any) => [requirement.requirementId, requirement.order, requirement.requirementText]),
    [
      ['req_01', 1, 'Experiencia con Docker'],
      ['req_02', 2, 'Desarrollo de APIs REST']
    ]
  );
});

test('1 requisito es valido', async () => {
  const state = world();
  assert.equal((await confirm(state, { requirements: manual(1) })).status, 'requirements_confirmed');
});

test(`${MAX_VERIFIER_REQUIREMENTS} requisitos son validos`, async () => {
  const state = world();
  assert.equal((await confirm(state, { requirements: manual(MAX_VERIFIER_REQUIREMENTS) })).status, 'requirements_confirmed');
});

test('0 requisitos se rechaza', async () => {
  const state = world();
  assert.equal(await codeOf(() => confirm(state, { requirements: [] })), 'REQUIREMENTS_INVALID');
  assert.equal(state.requests[0].status, 'requirements_proposed');
});

test(`${MAX_VERIFIER_REQUIREMENTS + 1} requisitos se rechaza entero: nada se trunca`, async () => {
  const state = world();
  assert.equal(await codeOf(() => confirm(state, { requirements: manual(MAX_VERIFIER_REQUIREMENTS + 1) })), 'REQUIREMENTS_INVALID');
  assert.equal(state.requests[0].confirmedObjectiveDefinition, null);
});

test('un requisito editado se acepta como DIRECT_STRUCTURED_INPUT', async () => {
  // La MISMA regla de procedencia del holder (P2.0 §19): editar pierde la derivacion.
  const state = world();
  await confirm(state, { requirements: [EDITED] });
  const [requirement] = (state.requests[0].confirmedObjectiveDefinition as any).requirements;
  assert.deepEqual(requirement.provenance, { kind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null });
});

test('una cita DERIVED que no es literal del texto persistido se rechaza', async () => {
  const state = world();
  assert.equal(
    await codeOf(() => confirm(state, { requirements: [{ ...DERIVED, sourceQuote: 'Kubernetes avanzado' }] })),
    'REQUIREMENTS_INVALID'
  );
});

test('se puede confirmar a mano desde draft, sin propuesta de proveedor', async () => {
  const state = world({ requests: [proposed({ status: 'draft', proposedRequirements: null })] });
  assert.equal((await confirm(state, { requirements: [MANUAL] })).status, 'requirements_confirmed');
});

// ===========================================================================
// FORMA PROHIBIDA
// ===========================================================================

for (const [label, body] of [
  ['body no objeto', 'x'],
  ['requisitos no arreglo', { requirements: 'x' }],
  ['definicion malformada', { requirements: [{ requirementText: 12 }] }],
  ['tipo colado', { requirements: [MANUAL], objectiveType: 'OTHER' }],
  ['fuente colada', { requirements: [MANUAL], source: { inputType: 'PASTED_TEXT', originalText: 'otro' } }],
  ['credentialIds', { requirements: [MANUAL], credentialIds: ['cred-1'] }],
  ['credentialIds en el requisito', { requirements: [{ ...MANUAL, credentialIds: ['cred-1'] }] }],
  ['ownerUserId en el requisito', { requirements: [{ ...MANUAL, ownerUserId: HOLDER_ID }] }],
  ['evidenceUnits en el requisito', { requirements: [{ ...MANUAL, evidenceUnits: [] }] }],
  ['requirementId del cliente', { requirements: [{ ...MANUAL, requirementId: 'req_99' }] }],
  ['qualifiers del cliente', { requirements: [{ ...MANUAL, qualifiers: ['x'] }] }],
  ['holderUserId en la raiz', { requirements: [MANUAL], holderUserId: HOLDER_ID }]
] as Array<[string, unknown]>) {
  test(`confirmacion rechazada: ${label}`, async () => {
    const state = world();
    assert.equal(await codeOf(() => confirm(state, body)), 'REQUIREMENTS_INVALID');
    assert.equal(state.requests[0].status, 'requirements_proposed');
  });
}

// ===========================================================================
// INMUTABILIDAD
// ===========================================================================

test('reenviar EXACTAMENTE la misma confirmacion es idempotente', async () => {
  const state = world();
  await confirm(state, { requirements: [DERIVED, MANUAL] });
  const firstAt = state.requests[0].confirmedAt;
  const again = await confirm(state, { requirements: [DERIVED, MANUAL] }, new Date(NOW.getTime() + 60_000));

  assert.equal(again.status, 'requirements_confirmed');
  assert.deepEqual(state.requests[0].confirmedAt, firstAt, 'la marca no se reescribe');
});

test('una confirmacion DISTINTA despues de confirmar se rechaza y no cambia nada', async () => {
  const state = world();
  await confirm(state, { requirements: [DERIVED] });
  const before = structuredClone(state.requests[0].confirmedObjectiveDefinition);

  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL] })), 'REQUIREMENTS_ALREADY_CONFIRMED');
  assert.deepEqual(state.requests[0].confirmedObjectiveDefinition, before);
});

test('reordenar tambien es una confirmacion distinta', async () => {
  const state = world();
  await confirm(state, { requirements: [DERIVED, MANUAL] });
  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL, DERIVED] })), 'REQUIREMENTS_ALREADY_CONFIRMED');
});

test('una solicitud ya consumida no se reconfirma', async () => {
  const state = world({ requests: [confirmedRequest({ status: 'consumed', consumedAt: NOW, rawObjectiveText: RAW })] });
  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL] })), 'REQUIREMENTS_ALREADY_CONFIRMED');
});

// ===========================================================================
// AUTORIDAD
// ===========================================================================

test('solicitud vencida: no se confirma', async () => {
  const state = world({ requests: [proposed({ expiresAt: new Date(NOW.getTime() - 1) })] });
  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL] })), 'REQUEST_NOT_AVAILABLE');
  assert.equal(state.requests[0].status, 'requirements_proposed');
});

test('enlace revocado: no se confirma', async () => {
  const state = world({ grants: [grant({ revokedAt: NOW })] });
  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL] })), 'SHARE_NOT_AVAILABLE');
});

test('politica apagada: no se confirma', async () => {
  const state = world({ grants: [grant({ verificationPolicy: { enabled: false, policyVersion: 7, authorizedCredentials: [] } })] });
  assert.equal(await codeOf(() => confirm(state, { requirements: [MANUAL] })), 'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE');
});

test('confirmar NO congela la version de politica en la solicitud', async () => {
  // El snapshot de consentimiento pertenece al VerificationRun.
  const state = world();
  await confirm(state, { requirements: [MANUAL] });
  const serialized = JSON.stringify(state.requests[0]);
  assert.equal(serialized.includes('policyVersion'), false);
  assert.equal('policyVersionSnapshot' in state.requests[0], false);
});

test('confirmar NO crea VerificationRun', async () => {
  const state = world();
  await confirm(state, { requirements: [MANUAL] });
  assert.equal(state.runs.length, 0);
  assert.equal(state.requests[0].consumedAt, null);
});

test('la respuesta publica no transporta ids ni datos del enlace', async () => {
  const state = world();
  const session = await confirm(state, { requirements: [MANUAL] });
  const serialized = JSON.stringify(session);
  for (const forbidden of ['req-row-1', 'grant-1', 'cred-1', HOLDER_ID, REQUEST_TOKEN]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
