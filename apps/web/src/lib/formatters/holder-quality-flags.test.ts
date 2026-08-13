import { expect, it } from 'vitest';

import { formatHolderQualityFlag } from '@/lib/formatters/holder-quality-flags';

it('humanizes known holder quality flags without rendering raw codes', () => {
  expect(formatHolderQualityFlag('partial_evidence')).toBe('Información parcial');
  expect(formatHolderQualityFlag('low_coverage')).toBe('Cobertura limitada');
  expect(formatHolderQualityFlag('future_safe_flag')).toBe('El análisis incluye observaciones técnicas que requieren revisión.');
});

it('humanizes the IA-Q1 quality flags in clear Spanish', () => {
  expect(formatHolderQualityFlag('credential_without_semantic_analysis_has_emitted_data'))
    .toBe('Algunas credenciales sin análisis ya aportan información declarada por la institución');
  expect(formatHolderQualityFlag('no_emitted_skills_available'))
    .toBe('Todavía no hay información declarada por instituciones disponible');
  expect(formatHolderQualityFlag('profile_partially_built'))
    .toBe('Este perfil se construyó con información parcial');
  expect(formatHolderQualityFlag('total_hours_unavailable'))
    .toBe('El total de horas no está disponible todavía');
  expect(formatHolderQualityFlag('area_hours_are_estimated_not_emitted'))
    .toBe('Las horas por área son estimaciones del análisis, no datos oficiales');
});

it('never phrases a coverage warning as a fatal error or as an AI certification/invalidation claim', () => {
  const flags = [
    'credential_without_semantic_analysis_has_emitted_data',
    'no_emitted_skills_available',
    'profile_partially_built',
    'total_hours_unavailable',
    'area_hours_are_estimated_not_emitted',
    'credential_without_semantic_analysis',
    'no_skills_detected'
  ];
  for (const flag of flags) {
    const label = formatHolderQualityFlag(flag);
    expect(label).not.toMatch(/error|falló|inválid|certific/i);
  }
});

it('falls back to a safe humanized label for unknown flags without rendering raw objects', () => {
  expect(formatHolderQualityFlag('some_future_unmapped_flag')).toBe('El análisis incluye observaciones técnicas que requieren revisión.');
  expect(typeof formatHolderQualityFlag('another_unknown_code')).toBe('string');
});
