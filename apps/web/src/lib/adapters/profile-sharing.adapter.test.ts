import { expect, it } from 'vitest';

import { adaptProfileShareLink, adaptPublicProfileShare } from './profile-sharing.adapter';

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

it('accepts only an opaque profile share path', () => {
  expect(adaptProfileShareLink({ sharePath: `/share/profile/${'a'.repeat(43)}`, expiresAt: null }).sharePath).toContain('/share/profile/');
  expect(() => adaptProfileShareLink({ sharePath: '/share/profile/profile-id', expiresAt: null })).toThrow();
});
