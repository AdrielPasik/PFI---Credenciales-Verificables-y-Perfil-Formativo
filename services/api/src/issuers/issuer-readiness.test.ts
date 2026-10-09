import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialType,
  IssuerAuthorizationStatus,
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { materialFromScalar } from '../identity/operator/signer-material-generator';
import {
  ISSUER_READINESS_REASON_VALUES,
  type IssuerReadinessSnapshot,
  evaluateIssuerReadiness,
  isReadyToIssueType,
  resolveReadinessTarget
} from './issuer-readiness';

/**
 * Readiness S8c9 -- matriz pura. Claves: SOLO los escalares publicos de test 1 y 2.
 */

const ISSUER_ID = '11111111-1111-4111-8111-111111111111';
const DID = `did:web:scope.example:did:issuers:${ISSUER_ID}`;
const ASSERT = materialFromScalar(`0x${'0'.repeat(63)}1`);
const ANCHOR = materialFromScalar(`0x${'0'.repeat(63)}2`);
const MOCK = resolveReadinessTarget({});
const VERIFIED = new Date('2026-10-01T00:00:00.000Z');

function snapshot(overrides: Partial<IssuerReadinessSnapshot> = {}): IssuerReadinessSnapshot {
  return {
    issuerId: ISSUER_ID,
    authorizationStatus: IssuerAuthorizationStatus.authorized,
    allowedCredentialTypes: [CredentialType.course],
    technicalIdentity: {
      status: IssuerTechnicalIdentityStatus.active,
      did: DID,
      assertionSignerProfileId: 'assert-1',
      assertionSignerProfile: {
        id: 'assert-1',
        purpose: SignerProfilePurpose.assertion,
        status: SignerProfileStatus.active,
        keyVersion: 1,
        address: ASSERT.address.toLowerCase(),
        addressVerifiedAt: VERIFIED
      },
      anchorSignerProfile: {
        id: 'anchor-1',
        purpose: SignerProfilePurpose.anchor,
        status: SignerProfileStatus.active,
        keyVersion: 1,
        address: ANCHOR.address.toLowerCase(),
        addressVerifiedAt: VERIFIED
      }
    },
    assertionHistory: [
      {
        id: 'assert-1',
        purpose: SignerProfilePurpose.assertion,
        status: SignerProfileStatus.active,
        keyVersion: 1,
        publicKeyX: ASSERT.publicKeyX,
        publicKeyY: ASSERT.publicKeyY,
        publicKeyCompressed: ASSERT.publicKeyCompressed
      }
    ],
    ...overrides
  };
}

function withIdentity(
  patch: Partial<NonNullable<IssuerReadinessSnapshot['technicalIdentity']>>
): IssuerReadinessSnapshot {
  const base = snapshot();
  return { ...base, technicalIdentity: { ...base.technicalIdentity!, ...patch } };
}

test('R1 issuer completo: listo, sin motivos, compat true', () => {
  const r = evaluateIssuerReadiness(snapshot(), MOCK);
  assert.equal(r.readyToIssue, true);
  assert.equal(r.configurationReady, true);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.compatibility, { didConfigured: true, walletConfigured: true });
});

test('R2 configurationReady es TECNICA: no autorizado sigue configurationReady=true', () => {
  for (const status of [IssuerAuthorizationStatus.pending, IssuerAuthorizationStatus.revoked]) {
    const r = evaluateIssuerReadiness(snapshot({ authorizationStatus: status }), MOCK);
    assert.equal(r.administrativelyAuthorized, false);
    assert.equal(r.configurationReady, true);
    assert.equal(r.readyToIssue, false);
    assert.deepEqual(r.reasons, ['ISSUER_NOT_AUTHORIZED']);
  }
});

test('R3 capacidades vacias: configurationReady=true, readyToIssue=false', () => {
  const r = evaluateIssuerReadiness(snapshot({ allowedCredentialTypes: [] }), MOCK);
  assert.equal(r.hasCredentialCapabilities, false);
  assert.equal(r.configurationReady, true);
  assert.equal(r.readyToIssue, false);
  assert.deepEqual(r.reasons, ['NO_ALLOWED_CREDENTIAL_TYPES']);
});

test('R4 readyToIssue(T) exige T habilitado', () => {
  const s = snapshot();
  const r = evaluateIssuerReadiness(s, MOCK);
  assert.equal(isReadyToIssueType(r, s.allowedCredentialTypes, CredentialType.course), true);
  assert.equal(
    isReadyToIssueType(r, s.allowedCredentialTypes, CredentialType.degree),
    false
  );
});

test('R5 sin identidad tecnica', () => {
  const r = evaluateIssuerReadiness(snapshot({ technicalIdentity: null }), MOCK);
  assert.equal(r.configurationReady, false);
  assert.ok(r.reasons.includes('TECHNICAL_IDENTITY_MISSING'));
  assert.deepEqual(r.compatibility, { didConfigured: false, walletConfigured: false });
});

test('R6 identidad no activa (rotation_required / disabled / unconfigured)', () => {
  for (const status of [
    IssuerTechnicalIdentityStatus.rotation_required,
    IssuerTechnicalIdentityStatus.disabled,
    IssuerTechnicalIdentityStatus.unconfigured
  ]) {
    const r = evaluateIssuerReadiness(withIdentity({ status }), MOCK);
    assert.equal(r.configurationReady, false);
    assert.ok(r.reasons.includes('TECHNICAL_IDENTITY_NOT_ACTIVE'));
  }
});

test('R7 DID legacy, de otro issuer o por prefijo: ISSUER_DID_INVALID', () => {
  for (const did of [
    'did:example:issuer-demo',
    'did:web:scope.example:did:issuers:22222222-2222-4222-8222-222222222222',
    `did:web:scope.example:did:issuers:${ISSUER_ID}:extra`,
    `did:web:scope.example:did:users:${ISSUER_ID}`
  ]) {
    const r = evaluateIssuerReadiness(withIdentity({ did }), MOCK);
    assert.ok(r.reasons.includes('ISSUER_DID_INVALID'), did);
    assert.equal(r.compatibility.didConfigured, false);
  }
});

test('R8 asercion: faltante, proposito, estado, no verificada, direccion invalida', () => {
  const base = snapshot().technicalIdentity!.assertionSignerProfile!;
  const cases: [Partial<typeof base> | null, string][] = [
    [null, 'ASSERTION_PROFILE_MISSING'],
    [{ purpose: SignerProfilePurpose.anchor }, 'ASSERTION_PROFILE_WRONG_PURPOSE'],
    [{ status: SignerProfileStatus.retired }, 'ASSERTION_PROFILE_NOT_ACTIVE'],
    [{ status: SignerProfileStatus.compromised }, 'ASSERTION_PROFILE_NOT_ACTIVE'],
    [{ addressVerifiedAt: null }, 'ASSERTION_ADDRESS_UNVERIFIED'],
    [{ address: 'x' }, 'ASSERTION_ADDRESS_INVALID'],
    [{ address: `0x${'g'.repeat(40)}` }, 'ASSERTION_ADDRESS_INVALID']
  ];
  for (const [patch, code] of cases) {
    const r = evaluateIssuerReadiness(
      withIdentity({ assertionSignerProfile: patch === null ? null : { ...base, ...patch } }),
      MOCK
    );
    assert.ok(r.reasons.includes(code as never), code);
    assert.equal(r.configurationReady, false);
  }
});

test('R9 asercion vigente sin binding historico: ASSERTION_HISTORY_BINDING_MISSING', () => {
  const r = evaluateIssuerReadiness(snapshot({ assertionHistory: [] }), MOCK);
  assert.ok(r.reasons.includes('ASSERTION_HISTORY_BINDING_MISSING'));
  assert.equal(r.configurationReady, false);

  // Historia con OTRA clave pero no la vigente: mismo motivo.
  const other = { ...snapshot().assertionHistory[0], id: 'assert-0' };
  const r2 = evaluateIssuerReadiness(snapshot({ assertionHistory: [other] }), MOCK);
  assert.ok(r2.reasons.includes('ASSERTION_HISTORY_BINDING_MISSING'));
});

test('R9b historia con un anchor: ASSERTION_CONFIGURATION_INCONSISTENT', () => {
  const bad = { ...snapshot().assertionHistory[0], purpose: SignerProfilePurpose.anchor };
  const r = evaluateIssuerReadiness(snapshot({ assertionHistory: [bad] }), MOCK);
  assert.ok(r.reasons.includes('ASSERTION_CONFIGURATION_INCONSISTENT'));
});

test('R10 anchor: faltante, proposito, estado, no verificado, invalido; compat wallet=false', () => {
  const base = snapshot().technicalIdentity!.anchorSignerProfile!;
  const cases: [Partial<typeof base> | null, string][] = [
    [null, 'ANCHOR_PROFILE_MISSING'],
    [{ purpose: SignerProfilePurpose.assertion }, 'ANCHOR_PROFILE_WRONG_PURPOSE'],
    [{ status: SignerProfileStatus.retired }, 'ANCHOR_PROFILE_NOT_ACTIVE'],
    [{ addressVerifiedAt: null }, 'ANCHOR_ADDRESS_UNVERIFIED'],
    [{ address: '0x1234' }, 'ANCHOR_ADDRESS_INVALID']
  ];
  for (const [patch, code] of cases) {
    const r = evaluateIssuerReadiness(
      withIdentity({ anchorSignerProfile: patch === null ? null : { ...base, ...patch } }),
      MOCK
    );
    assert.ok(r.reasons.includes(code as never), code);
    assert.equal(r.compatibility.walletConfigured, false);
    assert.equal(r.compatibility.didConfigured, true);
  }
});

test('R11 target invalido: BLOCKCHAIN_TARGET_UNCONFIGURED, sin red', () => {
  const r = evaluateIssuerReadiness(
    snapshot(),
    resolveReadinessTarget({ BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry' })
  );
  assert.ok(r.reasons.includes('BLOCKCHAIN_TARGET_UNCONFIGURED'));
  assert.equal(r.configurationReady, false);
});

test('R12 motivos: subconjunto del enum cerrado, sin duplicados', () => {
  const r = evaluateIssuerReadiness(
    snapshot({
      authorizationStatus: IssuerAuthorizationStatus.pending,
      allowedCredentialTypes: [],
      technicalIdentity: null
    }),
    resolveReadinessTarget({ BLOCKCHAIN_EVIDENCE_MODE: 'nope' })
  );
  for (const reason of r.reasons) {
    assert.ok((ISSUER_READINESS_REASON_VALUES as readonly string[]).includes(reason));
  }
  assert.equal(new Set(r.reasons).size, r.reasons.length);
});

test('R13 la evaluacion es pura: no muta el snapshot', () => {
  const s = snapshot();
  const before = JSON.stringify(s);
  evaluateIssuerReadiness(s, MOCK);
  assert.equal(JSON.stringify(s), before);
});
