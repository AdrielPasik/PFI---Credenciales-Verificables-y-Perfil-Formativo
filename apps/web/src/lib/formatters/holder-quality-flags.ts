export const HOLDER_UNKNOWN_QUALITY_FLAG_LABEL =
  'El análisis incluye observaciones técnicas que requieren revisión.';

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
  online_course_catalog_not_completion_evidence: 'Incluye catálogo de cursos online, no evidencia de finalización',

  // Tokens estables del exporter semantic_analysis_v1. Las etiquetas son
  // deliberadamente descriptivas y no exponen códigos, puntajes ni diagnósticos
  // del proveedor.
  area_assignment_confident: 'La asignación de área tiene confianza suficiente',
  area_assignment_low_confidence: 'La asignación de área tiene confianza baja',
  area_assignment_insufficient_evidence:
    'No hay evidencia suficiente para asignar un área con confianza',
  area_assignment_unresolved: 'No se pudo asignar un área con confianza',
  semantic_quality_high: 'La cobertura semántica es amplia',
  semantic_quality_medium: 'La cobertura semántica es moderada',
  semantic_quality_low: 'La cobertura semántica es limitada',
  skills_detection_reliability_high:
    'La detección de habilidades tiene confianza alta',
  skills_detection_reliability_medium:
    'La detección de habilidades requiere revisión',
  skills_detection_reliability_low_or_absent:
    'La detección de habilidades es limitada o no está disponible',
  hours_distribution_reliability_high:
    'La distribución horaria tiene confianza alta',
  hours_distribution_reliability_medium:
    'La distribución horaria tiene confianza media',
  hours_distribution_reliability_low_or_absent:
    'La distribución horaria no está disponible o tiene baja confiabilidad',
  short_unstructured_text: 'El texto disponible es breve o poco estructurado',
  no_curricular_sections_detected:
    'No se detectaron secciones curriculares estructuradas',
  missing_description: 'La fuente no incluye una descripción suficiente',
  missing_category: 'La fuente no incluye una categoría',
  missing_explicit_skills: 'La fuente no incluye habilidades explícitas',
  inferred_skills_only:
    'Las habilidades se identificaron a partir del texto disponible',
  low_text_signal: 'La información textual disponible es limitada'
};

export function formatHolderQualityFlag(value: string) {
  const normalized = value.trim().toLowerCase();
  return knownLabels[normalized] ?? HOLDER_UNKNOWN_QUALITY_FLAG_LABEL;
}

/**
 * `qualityFlags` describe condiciones, no eventos contables. Conservamos el
 * orden de los tokens conocidos y ocultamos varias causas futuras/desconocidas
 * detrás de una sola observación segura en la primera posición desconocida.
 */
export function formatHolderQualityFlags(values: readonly string[]): string[] {
  const seenTokens = new Set<string>();
  const labels: string[] = [];
  let includedUnknownFallback = false;

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (seenTokens.has(normalized)) continue;
    seenTokens.add(normalized);

    const knownLabel = knownLabels[normalized];
    if (knownLabel) {
      labels.push(knownLabel);
      continue;
    }

    if (!includedUnknownFallback) {
      labels.push(HOLDER_UNKNOWN_QUALITY_FLAG_LABEL);
      includedUnknownFallback = true;
    }
  }

  return labels;
}
