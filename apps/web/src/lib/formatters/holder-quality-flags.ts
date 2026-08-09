const knownLabels: Record<string, string> = {
  partial_evidence: 'Información parcial',
  low_coverage: 'Cobertura limitada',
  qualitative_only: 'Resultado principalmente cualitativo',

  // Códigos de FormativeProfileService (backend_deterministic_aggregation_v0),
  // agregados/ampliados en IA-Q1. Ninguno implica que la IA certifique o
  // invalide el perfil: son advertencias de cobertura, no errores.
  no_issued_credentials: 'Todavía no hay credenciales emitidas',
  credential_without_semantic_analysis: 'Hay credenciales sin análisis disponible todavía',
  credential_without_semantic_analysis_has_emitted_data:
    'Algunas credenciales sin análisis ya aportan información declarada por la institución',
  no_skills_detected: 'El análisis todavía no detectó habilidades',
  no_emitted_skills_available: 'Todavía no hay información declarada por instituciones disponible',
  profile_partially_built: 'Este perfil se construyó con información parcial',
  confidence_not_available: 'La confianza del análisis no está disponible todavía',
  total_hours_unavailable: 'El total de horas no está disponible todavía',
  area_hours_are_estimated_not_emitted: 'Las horas por área son estimaciones del análisis, no datos oficiales',
  online_course_catalog_not_completion_evidence: 'Incluye catálogo de cursos online, no evidencia de finalización'
};

export function formatHolderQualityFlag(value: string) {
  const normalized = value.trim().toLowerCase();
  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
