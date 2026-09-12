/**
 * Recuperacion del subcodigo de `PROVIDER_INVALID_OUTPUT` — slice P2.4 OBS.
 *
 * POR QUE EXISTE. El primer smoke real de F3 murio con
 * `reasoning_provider_invalid_output` y el subcodigo exacto —el que dice QUE
 * parte del contrato incumplio la salida del modelo— resulto irrecuperable
 * despues del run: viajaba en el cuerpo del envelope y nadie lo leia.
 *
 *     ai_service_error_v1
 *     { schemaVersion, code: "PROVIDER_INVALID_OUTPUT",
 *       message: "<stage>_invalid_provider_output:<subcodigo>" }
 *
 * `readAiServiceErrorCode` lee SOLO `code`, y hace bien: el `code` es la unica
 * autoridad semantica y de el depende si un run muere. Este modulo NO cambia esa
 * regla. Lee `message` para UNA cosa —diagnostico interno— y ninguna decision de
 * negocio depende de lo que devuelva.
 *
 * ES UN CANAL ALLOWLISTED, NO UN PARSER PERMISIVO. Se exige la gramatica exacta y
 * ademas pertenencia al vocabulario cerrado que define el ai-service. Si algo no
 * encaja, sale un centinela y el valor crudo NO se registra: un canal de
 * diagnostico que copiara texto libre del otro lado seria una via de fuga con
 * otro nombre.
 */

/** Las tres etapas de F3. Objective Understanding NO participa: otro mapper. */
export const F3_DIAGNOSTIC_STAGES = [
  'objective_analysis',
  'evidence_units',
  'contextual_reasoning'
] as const;

export type F3DiagnosticStage = (typeof F3_DIAGNOSTIC_STAGES)[number];

/** Lo que se registra cuando el subcodigo no se puede reconocer con confianza. */
export const UNKNOWN_INVALID_OUTPUT_SUBCODE = 'UNKNOWN_OR_UNPARSEABLE';

/**
 * Subcodigos de salida invalida, POR ETAPA.
 *
 * Copiados del codigo ejecutable del ai-service —`provider.py`, `service.py` y
 * `validation.py` de cada etapa—, no inventados. `ai-service-invalid-output-
 * diagnostics.guard.test.ts` los vuelve a derivar del fuente Python y falla si
 * las dos listas divergen: sin ese guard, agregar un subcodigo del otro lado lo
 * degradaria en silencio a `UNKNOWN_OR_UNPARSEABLE`, que es justo el problema
 * que este modulo existe para eliminar.
 */
const TRANSPORT_SUBCODES = [
  'provider_body_not_an_object',
  'provider_body_not_json',
  'provider_output_not_an_object',
  'provider_output_not_json',
  'provider_output_text_missing'
] as const;

export const INVALID_OUTPUT_SUBCODES: Readonly<
  Record<F3DiagnosticStage, readonly string[]>
> = {
  objective_analysis: [
    ...TRANSPORT_SUBCODES,
    'evaluability_capability_not_boolean',
    'provider_requirements_not_a_list',
    'qualifier_anchor_not_in_requirement_text',
    'qualifier_anchor_not_literal',
    'qualifiers_not_a_list',
    'requirement_count_mismatch',
    'requirement_identity_or_order_mismatch'
  ],
  evidence_units: [
    ...TRANSPORT_SUBCODES,
    'provider_evidence_units_not_a_list',
    'provider_output_unexpected_keys',
    'provider_proposal_qualifiers_invalid',
    'provider_proposal_unexpected_keys',
    'provider_qualifier_not_text',
    'provider_qualifier_unexpected_keys'
  ],
  contextual_reasoning: [
    ...TRANSPORT_SUBCODES,
    'provider_output_unexpected_keys',
    'contextual_continuity_shift_reason_missing',
    'contextual_continuity_transformation_inconsistent',
    'contextual_evaluated_evidence_duplicated',
    'contextual_facet_basis_empty',
    // P2.4 — ANCLAJE DETERMINISTA. `contextual_facet_basis_not_literal` y
    // `contextual_continuity_basis_not_literal` se RETIRARON: el modelo ya no
    // escribe la cita, la recorta el servidor, y esos dos subcodigos dejaron de
    // ser emitibles. En su lugar aparecen los fallos de RANGO, que son los
    // unicos que el modelo puede cometer ahora.
    'contextual_facet_basis_range_malformed',
    'contextual_facet_basis_range_out_of_bounds',
    'contextual_facet_evidence_reference_unknown',
    'contextual_facet_local_keys_duplicated',
    'contextual_facet_reference_dangling',
    'contextual_material_usefulness_evaluated_without_continuity',
    'contextual_observability_source_unknown',
    'contextual_output_attempts_final_state',
    'contextual_qualifier_reference_outside_requirement',
    'contextual_requirement_id_mismatch',
    'contextual_semantic_evidence_reference_unknown',
    'contextual_weaker_search_candidate_inconsistent'
  ]
};

/**
 * El subcodigo de salida invalida de ESTA etapa, o el centinela.
 *
 * `stage` lo pone el llamante desde su propia identidad; NUNCA se deduce del
 * mensaje ni de la URL. Que el prefijo del mensaje tenga que coincidir con la
 * etapa esperada es una comprobacion mas, no la fuente de la etapa: un envelope
 * de otra etapa en esta respuesta es incoherencia, no informacion.
 */
export function readInvalidOutputSubcode(
  stage: F3DiagnosticStage,
  body: unknown
): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return UNKNOWN_INVALID_OUTPUT_SUBCODE;
  }

  const message = (body as Record<string, unknown>).message;
  if (typeof message !== 'string') return UNKNOWN_INVALID_OUTPUT_SUBCODE;

  const prefix = `${stage}_invalid_provider_output:`;
  if (!message.startsWith(prefix)) return UNKNOWN_INVALID_OUTPUT_SUBCODE;

  const candidate = message.slice(prefix.length);

  // Pertenencia al vocabulario cerrado. Se comprueba la IGUALDAD, no que el
  // mensaje "contenga" un token conocido: un `includes` dejaria pasar cualquier
  // cosa concatenada alrededor de un subcodigo valido.
  return INVALID_OUTPUT_SUBCODES[stage].includes(candidate)
    ? candidate
    : UNKNOWN_INVALID_OUTPUT_SUBCODE;
}
