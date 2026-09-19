import { expect, it } from 'vitest';

import { adaptHolderProfileShares, adaptProfileShareLink, adaptPublicProfileShare, adaptShareVerificationPolicy } from './profile-sharing.adapter';

it('adapts a public profile share through a bounded allowlist', () => {
  const profile = adaptPublicProfileShare({
    holder: { displayLabel: 'Titular Demo', email: 'must-not-leak@example.com' },
    profile: {
      narrative: 'La trayectoria formativa muestra credenciales vinculadas con Gestión.',
      areas: Array.from({ length: 8 }, (_, index) => ({ label: `Área ${index}`, estimatedHours: index })),
      skills: Array.from({ length: 14 }, (_, index) => ({ label: `Habilidad ${index}`, confidence: 0.8 })),
      concepts: Array.from({ length: 22 }, (_, index) => `Concepto ${index}`),
      totalOfficialHours: 12,
      credentialsCount: 1,
      rawData: { forbidden: true }
    },
    credentials: [{ credentialReference: 'credential-1', title: 'Curso', typeLabel: 'Curso', issuerName: 'Institución', issuedAt: '2026-08-14T00:00:00Z', analysisJson: {} }]
  });

  expect(profile.areas).toHaveLength(6);
  expect(profile.skills).toHaveLength(12);
  expect(profile.concepts).toHaveLength(20);
  expect(JSON.stringify(profile)).not.toMatch(/email|rawData|analysisJson|must-not-leak/i);
});

// C5b.2: defensa en profundidad. El backend nunca deberia mandar
// provenanceSummary/sources en el share publico (ver profile-sharing.
// service.ts, allowlist explicita), pero el adaptador tampoco debe
// propagarlos si algun dia lo hiciera -- extrae campos explicitos, nunca
// hace spread del objeto recibido.
it('C5b.2: never carries provenanceSummary or internal ids into the public profile VM, even if the backend payload includes them', () => {
  const profile = adaptPublicProfileShare({
    holder: { displayLabel: 'Titular Demo' },
    profile: {
      narrative: null,
      areas: [{
        label: 'Gestión de proyectos', estimatedHours: 12,
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 1 },
        sources: [{ credentialId: 'must-not-leak', provenance: 'issuer_reviewed' }]
      }],
      skills: [{
        label: 'Scrum', confidence: 0.8,
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 0 }
      }],
      concepts: ['Kanban'],
      totalOfficialHours: 12,
      credentialsCount: 1
    },
    credentials: []
  });

  expect(profile.areas).toEqual([{ label: 'Gestión de proyectos', estimatedHoursLabel: '12 horas estimadas por IA' }]);
  expect(profile.skills).toEqual(['Scrum']);
  const serialized = JSON.stringify(profile);
  for (const forbidden of ['provenanceSummary', 'issuerReviewedCount', 'aiInferredCount', 'sources', 'must-not-leak', 'issuer_reviewed']) {
    expect(serialized.includes(forbidden)).toBe(false);
  }
});

it('accepts only an opaque profile share path', () => {
  expect(adaptProfileShareLink({ sharePath: `/share/profile/${'a'.repeat(43)}`, expiresAt: null }).sharePath).toContain('/share/profile/');
  expect(() => adaptProfileShareLink({ sharePath: '/share/profile/profile-id', expiresAt: null })).toThrow();
});

// ---------------------------------------------------------------------------
// Ciclo de vida del enlace y consentimiento de computo
// ---------------------------------------------------------------------------

const PUBLIC_PAYLOAD = {
  holder: { displayLabel: 'Holder Demo' },
  profile: {
    narrative: null,
    areas: [],
    skills: [],
    concepts: [],
    totalOfficialHours: null,
    credentialsCount: 0
  },
  credentials: []
};

it('un backend sin el campo de verificacion contextual se lee como NO habilitado', () => {
  // El default seguro es el unico aceptable para un permiso: ausente nunca
  // puede interpretarse como consentimiento.
  expect(adaptPublicProfileShare(PUBLIC_PAYLOAD).contextualVerificationEnabled).toBe(false);
});

it('respeta el booleano cuando viene', () => {
  expect(
    adaptPublicProfileShare({ ...PUBLIC_PAYLOAD, contextualVerificationEnabled: true })
      .contextualVerificationEnabled
  ).toBe(true);
  expect(
    adaptPublicProfileShare({ ...PUBLIC_PAYLOAD, contextualVerificationEnabled: false })
      .contextualVerificationEnabled
  ).toBe(false);
});

it('rechaza un valor que no sea booleano', () => {
  expect(() =>
    adaptPublicProfileShare({ ...PUBLIC_PAYLOAD, contextualVerificationEnabled: 'true' })
  ).toThrow();
});

const SHARE_ROW = {
  shareId: 'share-1',
  scope: 'profile',
  status: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  contextualVerificationEnabled: false,
  authorizedCredentialCount: 0,
  effectiveAuthorizedCredentialCount: 0
};

it('adapta los tres estados de un enlace con su etiqueta', () => {
  const shares = adaptHolderProfileShares([
    SHARE_ROW,
    { ...SHARE_ROW, shareId: 'b', status: 'REVOKED', revokedAt: '2026-09-02T00:00:00.000Z' },
    { ...SHARE_ROW, shareId: 'c', status: 'EXPIRED', expiresAt: '2026-09-03T00:00:00.000Z' }
  ]);

  expect(shares.map((share) => [share.status, share.statusLabel])).toEqual([
    ['ACTIVE', 'Activo'],
    ['REVOKED', 'Revocado'],
    ['EXPIRED', 'Vencido']
  ]);
});

it('rechaza un estado desconocido en lugar de inventarle una etiqueta', () => {
  expect(() => adaptHolderProfileShares([{ ...SHARE_ROW, status: 'PAUSED' }])).toThrow();
});

it('conserva la diferencia entre lo consentido y lo utilizable', () => {
  const [share] = adaptHolderProfileShares([
    { ...SHARE_ROW, authorizedCredentialCount: 3, effectiveAuthorizedCredentialCount: 1 }
  ]);
  expect(share.authorizedCredentialCount).toBe(3);
  expect(share.effectiveAuthorizedCredentialCount).toBe(1);
});

it('el listado nunca transporta un token', () => {
  const serialized = JSON.stringify(
    adaptHolderProfileShares([{ ...SHARE_ROW, tokenHash: 'no-deberia-estar' }])
  );
  expect(serialized.includes('no-deberia-estar')).toBe(false);
  expect(serialized.includes('tokenHash')).toBe(false);
});

it('adapta el estado de la politica sin perder la version', () => {
  const policy = adaptShareVerificationPolicy({
    enabled: true,
    policyVersion: 4,
    authorizedCredentialIds: ['cred-a', 'cred-b'],
    effectiveAuthorizedCredentialIds: ['cred-a']
  });

  expect(policy.enabled).toBe(true);
  expect(policy.policyVersion).toBe(4);
  expect(policy.authorizedCredentialIds).toEqual(['cred-a', 'cred-b']);
  expect(policy.effectiveAuthorizedCredentialIds).toEqual(['cred-a']);
});

it('rechaza una politica sin booleano explicito', () => {
  expect(() =>
    adaptShareVerificationPolicy({
      policyVersion: 1,
      authorizedCredentialIds: [],
      effectiveAuthorizedCredentialIds: []
    })
  ).toThrow();
});
