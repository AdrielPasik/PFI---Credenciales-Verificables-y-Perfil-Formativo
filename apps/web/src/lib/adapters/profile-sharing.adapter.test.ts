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
