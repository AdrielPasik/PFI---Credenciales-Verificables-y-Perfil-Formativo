/**
 * Policy epistemológica DETERMINISTA — slice F3.6.
 *
 * Promoción del candidato congelado B2.4.1 / Target v1.5.1. NO importa nada de
 * `experiments/evidence_reasoning/`: el código de investigación queda intacto y
 * acá se reescribe la MISMA lógica con los tipos del producto. La equivalencia se
 * demuestra con tests, no se asume.
 *
 *     experiments/evidence_reasoning/policy.py::final_state
 *         → resolveFinalState
 *     experiments/evidence_reasoning/b24_policy.py::b24_final_state
 *         → derivePolicyInputs
 *     experiments/evidence_reasoning/b24_validation.py::validate_and_enrich_b24
 *         → epistemicIntegrityGuards   (sólo la parte que F3.5 no hace terminal)
 *     experiments/evidence_reasoning/b24_renderer.py::render_b24_explanation
 *         → renderExplanation
 *
 * FUNCIÓN PURA. Sin Prisma, sin HTTP, sin `process.env`, sin reloj, sin azar y
 * sin proveedor. Para las mismas entradas devuelve el mismo artifact, y por eso
 * se puede testear a fondo sin base de datos ni red.
 *
 *     DETERMINISTIC_POLICY_PROVIDER_CALLS: 0
 *
 * NO DECIDE SEMÁNTICA. Todo juicio —relación, composición, ceiling, continuidad,
 * utilidad, observabilidad— ya lo produjo F3.5. Acá sólo se aplican las reglas
 * aceptadas sobre esos juicios.
 */

import {
  type ContextualReasoningV1,
  type ContextualRequirementResult
} from './contextual-reasoning.contract';
import {
  type EvidenceUnitV1,
  type FinalStateToken,
  type ObjectiveAnalysisRequirement,
  type PolicyTrace,
  type RequirementResult,
  type StageValidationRecord,
  type VerifiedEvidenceUnits,
  type VerifiedObjectiveAnalysis,
  REASONING_RUN_RESULT_SCHEMA_VERSION,
  type ReasoningRunResultV1
} from './reasoning-run-artifact.types';
import { type VerifiedObjectiveDefinition } from '../objectives/objective-definition.types';

/**
 * PRECEDENCIA DE GUARDS — NORMATIVA.
 *
 * Copia literal del orden de `policy.py::final_state`. Es una cadena ORDENADA,
 * no un conjunto de condiciones independientes: un mismo caso puede satisfacer
 * varias a la vez y sólo la primera decide.
 *
 *     1. no formativeEvidenceCapable            → NOT_ASSESSABLE
 *     2. unresolved OR hardFactualFailure       → ABSTAIN
 *     3. reachesFullRequirement                 → SUPPORTED
 *     4. hasMateriallyUsefulWeakerClaim
 *          AND weakerClaimStillBelongsToRequirement
 *                                               → PARTIALLY_SUPPORTED
 *     5. (resto)                                → INSUFFICIENT_EVIDENCE
 *
 * Los tres estados negativos NO se colapsan, y la diferencia importa:
 *
 *     NOT_ASSESSABLE         el Requirement no es contestable con evidencia
 *                            formativa. No se miró la evidencia.
 *     ABSTAIN                se miró y no se puede responder responsablemente.
 *     INSUFFICIENT_EVIDENCE  se miró, se pudo responder, y la respuesta es que
 *                            la evidencia no alcanza.
 *
 * El orden 1→2 dice además que la no-evaluabilidad gana sobre lo irresoluble:
 * si el Requirement no admite prueba formativa, que además haya quedado algo sin
 * resolver es información sobre una pregunta que no correspondía hacer.
 */
export const POLICY_GUARD_PRECEDENCE = [
  'NOT_FORMATIVE_EVIDENCE_CAPABLE',
  'UNRESOLVED_OR_HARD_FACTUAL_FAILURE',
  'REACHES_FULL_REQUIREMENT',
  'MATERIALLY_USEFUL_WEAKER_CLAIM_WITH_CONTINUITY',
  'RESIDUAL_INSUFFICIENT_EVIDENCE'
] as const;

export type PolicyGuard = (typeof POLICY_GUARD_PRECEDENCE)[number];

/** Las entradas booleanas de la cadena de guards. */
export interface FinalStateInputs {
  readonly formativeEvidenceCapable: boolean;
  readonly unresolved: boolean;
  readonly criticalGuardFailure: boolean;
  readonly reachesFullRequirement: boolean;
  readonly hasMateriallyUsefulWeakerClaim: boolean;
  readonly weakerClaimStillBelongsToRequirement: boolean;
}

/**
 * `policy.py::final_state`, promovida sin reordenar ni simplificar.
 *
 * El guard 4 pregunta por las DOS cosas aunque `hasMateriallyUsefulWeakerClaim`
 * ya implique continuidad por construcción. Se conserva la redundancia porque es
 * la forma congelada, y porque hace explícito en el código lo que la cláusula
 * restaurada de B2.4.1 dice en palabras: la utilidad nunca rescata por sí sola.
 */
export function resolveFinalState(inputs: FinalStateInputs): FinalStateToken {
  if (!inputs.formativeEvidenceCapable) return 'NOT_ASSESSABLE';
  if (inputs.unresolved || inputs.criticalGuardFailure) return 'ABSTAIN';
  if (inputs.reachesFullRequirement) return 'SUPPORTED';
  if (
    inputs.hasMateriallyUsefulWeakerClaim &&
    inputs.weakerClaimStillBelongsToRequirement
  ) {
    return 'PARTIALLY_SUPPORTED';
  }
  return 'INSUFFICIENT_EVIDENCE';
}

/** Los ocho aportantes de `unresolved`, nombrados para poder testearlos uno a uno. */
export interface UnresolvedContributors {
  readonly semanticUnresolved: boolean;
  readonly composition: boolean;
  readonly fullClaim: boolean;
  readonly observability: boolean;
  readonly weakerSearch: boolean;
  readonly continuity: boolean;
  readonly usefulness: boolean;
  readonly epistemicTarget: boolean;
}

export interface DerivedPolicyInputs {
  readonly finalStateInputs: FinalStateInputs;
  readonly contributors: UnresolvedContributors;
  readonly continuityStatus: PolicyTrace['continuityStatus'];
  readonly materialUsefulness: PolicyTrace['materialUsefulness'];
  /**
   * `weakerClaimSearch.searchRequired` del validador congelado.
   *
   * El contrato productivo no lo persiste —lo dijo el handoff de F3.5— así que se
   * recomputa acá desde las tres entradas que lo definen. No es un dato nuevo:
   * es el mismo predicado, calculado donde hace falta.
   */
  readonly weakerSearchRequired: boolean;
}

/**
 * `b24_policy.py::b24_final_state`, la mitad que arma las entradas.
 *
 * ORDEN CONTINUIDAD → UTILIDAD, y es la cláusula restaurada de B2.4.1:
 *
 *     useful = continuidad YES  AND  utilidad YES
 *
 * La utilidad sólo cuenta una vez que la continuidad dio YES. `continuidad NO +
 * utilidad YES` nunca puede producir PARTIALLY_SUPPORTED: un claim que se
 * desplazó a otro objetivo no vuelve a pertenecer a éste por ser útil. Es
 * exactamente lo que impide que un prerequisito o un vecino se cuenten como
 * soporte parcial del Requirement original.
 */
export function derivePolicyInputs(
  analysisRequirement: ObjectiveAnalysisRequirement,
  contextual: ContextualRequirementResult,
  hardFactualFailure: boolean
): DerivedPolicyInputs {
  const full = contextual.fullClaimAssessment;
  const search = contextual.weakerClaimSearch;
  const candidate = search.candidate;
  const observability = contextual.observabilityAssessment;

  const continuityStatus = candidate === null
    ? null
    : candidate.continuityAssessment.status;
  const materialUsefulness = candidate === null
    ? null
    : candidate.materialUsefulness;

  const continuity = continuityStatus === 'YES';
  const useful = continuity && materialUsefulness === 'YES';

  const contributors: UnresolvedContributors = Object.freeze({
    semanticUnresolved: contextual.semanticUnresolved,
    composition: contextual.compositionAssessment.unresolved,
    fullClaim: full.status === 'UNRESOLVED',
    observability:
      observability.observabilityStatus === 'MATERIAL_GAP' ||
      observability.observabilityStatus === 'UNRESOLVED',
    weakerSearch: search.status === 'UNRESOLVED',
    continuity: continuityStatus === 'UNRESOLVED',
    // La utilidad sólo puede quedar irresuelta si llegó a evaluarse.
    usefulness: continuity && materialUsefulness === 'UNRESOLVED',
    // DELTA_C: un target epistemológico irresuelto es irresolución del caso, no
    // un default silencioso a FORMATIVE_EVIDENCE.
    epistemicTarget: analysisRequirement.epistemicTarget === 'UNRESOLVED'
  });

  const unresolved =
    contributors.semanticUnresolved ||
    contributors.composition ||
    contributors.fullClaim ||
    contributors.observability ||
    contributors.weakerSearch ||
    contributors.continuity ||
    contributors.usefulness ||
    contributors.epistemicTarget;

  return Object.freeze({
    finalStateInputs: Object.freeze({
      formativeEvidenceCapable:
        analysisRequirement.evaluability.formativeEvidenceCapable,
      unresolved,
      criticalGuardFailure: hardFactualFailure,
      reachesFullRequirement: full.status === 'REACHED',
      hasMateriallyUsefulWeakerClaim: useful,
      weakerClaimStillBelongsToRequirement: continuity
    }),
    contributors,
    continuityStatus,
    materialUsefulness,
    weakerSearchRequired:
      analysisRequirement.evaluability.formativeEvidenceCapable &&
      full.status === 'NOT_REACHED' &&
      observability.observabilityStatus === 'SUFFICIENT'
  });
}

// ---------------------------------------------------------------------------
// Guards de integridad epistemológica
// ---------------------------------------------------------------------------

/**
 * Inflación de soporte por PROCEDENCIA. Regex congelado de `b24_validation.py`.
 *
 * Que una credencial esté en cadena o revisada por el emisor dice quién asegura
 * la fuente, no cuánto soporta el Requirement. Un razonamiento que use la
 * procedencia como si fuera más evidencia está fortaleciendo un claim con un
 * hecho que no es semántico.
 */
const PROVENANCE_INFLATION =
  /(blockchain|on-chain|issuer_reviewed|verificad[oa]).{0,100}(aument|fortale|mayor soporte|más soporte)/i;

/**
 * DELTA_C. Cue LÉXICO y DESCRIPTIVO — nunca un override.
 *
 * Un patrón de texto no puede decidir una cuestión semántica. Se registra para
 * que una persona pueda revisar si se coló una condición de posesión o dominio
 * que el Requirement formativo no pedía, y por eso su
 * `affectsEpistemicState` es `false`.
 */
const ACHIEVEMENT_CUE =
  /(domin\w+|acredit\w+|posee|posesión|posesion|cuente con|cuenta con|demuestr\w+ que la persona|competencia individual|desempeño profesional|desempeno profesional)/gi;

function record(
  taxonomy: StageValidationRecord['taxonomy'],
  code: string,
  status: StageValidationRecord['status'],
  artifactRef: string,
  detail: string,
  affectsEpistemicState: boolean
): StageValidationRecord {
  return Object.freeze({
    taxonomy,
    code,
    status,
    artifactRef,
    detail,
    affectsEpistemicState
  });
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Los invariantes duros que SOBREVIVEN hasta la policy.
 *
 * F3.5 ya convierte en fallo TERMINAL todo lo que es una violación del contrato
 * de transporte: ids inexistentes, contradicciones estructurales, citas que no
 * son literales. Eso NO llega acá: si el proveedor devolvió algo que no es un
 * `contextual_reasoning_v1` válido, el run falla y no hay resultado que explicar.
 *
 * Lo que queda son guards EPISTEMOLÓGICOS: el payload es un contrato perfectamente
 * bien formado, y aun así afirma algo que los hechos deterministas del run
 * contradicen. Esos no son "output inválido", son motivo de ABSTENCIÓN, que es
 * exactamente lo que la policy congelada hace con ellos.
 *
 * Es la distinción que hace que `policyTrace.hardFactualFailure` y
 * `preGuardState` tengan contenido: sin estos guards serían siempre `false` y
 * siempre iguales a `finalState`, y el contrato congelado de F3.1 no los habría
 * pedido.
 */
export function epistemicIntegrityGuards(
  analysisRequirement: ObjectiveAnalysisRequirement,
  contextual: ContextualRequirementResult,
  evidenceUnits: VerifiedEvidenceUnits,
  weakerSearchRequired: boolean
): readonly StageValidationRecord[] {
  const ref = contextual.requirementId;
  const results: StageValidationRecord[] = [];

  // --- la búsqueda del claim más débil quedó documentada cuando correspondía --
  const documented = contextual.weakerClaimSearch.rationale.trim().length > 0;
  const searchUndocumented = weakerSearchRequired && !documented;
  results.push(
    record(
      'HARD_FACTUAL_INVARIANT',
      'WEAKER_SEARCH_DOCUMENTED_WHEN_REQUIRED',
      searchUndocumented ? 'FAIL' : 'PASS',
      ref,
      `required=${String(weakerSearchRequired)};rationale=${documented ? 'present' : 'empty'}`,
      searchUndocumented
    )
  );

  // --- observabilidad: sólo una fuente realmente incompleta puede alegarse ----
  //
  // `sourceObservabilityFacts` es un hecho DETERMINISTA de F3.4. Declarar una
  // laguna sobre una fuente que se leyó entera no es una opinión discutible: es
  // una afirmación contradicha por el propio run.
  const incomplete = new Set(
    evidenceUnits.preparation.sourceObservabilityFacts
      .filter(
        (fact) =>
          fact.coverageStatus === 'PARTIAL' || fact.coverageStatus === 'FAILED'
      )
      .map((fact) => fact.sourceId)
  );
  const supplied = contextual.observabilityAssessment.incompleteSourceAssessments.map(
    (item) => item.sourceId
  );
  const ineligible = supplied.filter((id) => !incomplete.has(id));
  const eligibilityBroken = hasDuplicates(supplied) || ineligible.length > 0;
  results.push(
    record(
      'HARD_FACTUAL_INVARIANT',
      'INCOMPLETE_SOURCE_ASSESSMENTS_ELIGIBLE',
      eligibilityBroken ? 'FAIL' : 'PASS',
      ref,
      // Ids locales del run, nunca contenido de la fuente.
      `ineligible=${JSON.stringify([...ineligible].sort())};duplicated=${String(hasDuplicates(supplied))}`,
      eligibilityBroken
    )
  );

  // --- todas las fuentes completas ⇒ no hay material faltante que alegar ------
  const allFull =
    evidenceUnits.preparation.sourceObservabilityFacts.length > 0 &&
    incomplete.size === 0;
  const status = contextual.observabilityAssessment.observabilityStatus;
  const fullSourcesBroken =
    allFull && (supplied.length > 0 || status === 'MATERIAL_GAP');
  results.push(
    record(
      'HARD_FACTUAL_INVARIANT',
      'FULL_SOURCES_NO_MISSING_MATERIAL',
      fullSourcesBroken ? 'FAIL' : 'PASS',
      ref,
      status,
      fullSourcesBroken
    )
  );

  // --- semántica positiva sin evidencia que la sostenga ----------------------
  //
  // EL GUARD DEL CEILING. Un `REACHED`, o una continuidad YES con utilidad YES,
  // son afirmaciones POSITIVAS: dicen que la evidencia disponible sostiene algo.
  // Si ni el ceiling ni el candidato nombran una sola EvidenceUnit del catálogo,
  // el estado fuerte no tiene de dónde salir. Sin este guard, `SUPPORTED` con
  // `supportingEvidenceUnitIds: []` sería representable, que es precisamente el
  // sobre-claim que el ceiling existe para impedir.
  const candidate = contextual.weakerClaimSearch.candidate;
  const positive =
    contextual.fullClaimAssessment.status === 'REACHED' ||
    (candidate !== null &&
      candidate.continuityAssessment.status === 'YES' &&
      candidate.materialUsefulness === 'YES');
  const catalogued = new Set(
    evidenceUnits.evidenceUnits.map((unit) => unit.evidenceUnitId)
  );
  const supports = [
    ...contextual.jointClaimCeiling.supportingEvidenceUnitIds,
    ...(candidate === null ? [] : candidate.supportingEvidenceUnitIds)
  ];
  const grounded = supports.some((id) => catalogued.has(id));
  const positiveUngrounded = positive && !grounded;
  results.push(
    record(
      'HARD_FACTUAL_INVARIANT',
      'POSITIVE_SEMANTICS_HAVE_EVIDENCE',
      positiveUngrounded ? 'FAIL' : 'PASS',
      ref,
      `positive=${String(positive)};supports=${String(supports.length)}`,
      positiveUngrounded
    )
  );

  // --- procedencia ≠ soporte semántico ---------------------------------------
  const reasoningText = [
    contextual.jointClaimCeiling.text,
    contextual.fullClaimAssessment.rationale,
    contextual.compositionAssessment.rationale,
    ...contextual.evaluatedEvidence.map((item) => item.rationale)
  ].join(' ');
  const inflated = PROVENANCE_INFLATION.test(reasoningText);
  results.push(
    record(
      'HARD_FACTUAL_INVARIANT',
      'PROVENANCE_BLOCKCHAIN_NOT_SEMANTIC_SUPPORT',
      inflated ? 'FAIL' : 'PASS',
      ref,
      'trace_context_only',
      inflated
    )
  );

  // --- DELTA_C: cue descriptivo, jamás un veredicto --------------------------
  //
  // Se registra la CANTIDAD de coincidencias, no las palabras: el `detail` de un
  // artifact persistido no es lugar para prosa del razonador.
  const cues = reasoningText.match(ACHIEVEMENT_CUE) ?? [];
  const cueCount = new Set(cues.map((cue) => cue.toLowerCase())).size;
  const targetIsFormative =
    analysisRequirement.epistemicTarget === 'FORMATIVE_EVIDENCE';
  results.push(
    record(
      'SEMANTIC_CONSISTENCY',
      'EPISTEMIC_TARGET_PRESERVATION',
      targetIsFormative && cueCount > 0 ? 'MANUAL_ADJUDICATION_REQUIRED' : 'PASS',
      ref,
      `target=${analysisRequirement.epistemicTarget};cues=${String(cueCount)}`,
      false
    )
  );

  return Object.freeze(results);
}

/** `_hard(...)` del validador congelado. */
export function hasHardFactualFailure(
  validations: readonly StageValidationRecord[]
): boolean {
  return validations.some(
    (item) =>
      item.taxonomy === 'HARD_FACTUAL_INVARIANT' &&
      (item.status === 'FAIL' || item.status === 'REJECTED') &&
      item.affectsEpistemicState
  );
}

// ---------------------------------------------------------------------------
// Render determinista
// ---------------------------------------------------------------------------

/**
 * `b24_renderer.py::render_b24_explanation`, promovido.
 *
 * NO TOMA NINGUNA DECISIÓN SEMÁNTICA NUEVA. Sólo enuncia lo que ya está decidido
 * y cita lo que ya está registrado.
 *
 * LENGUAJE ACOTADO A LA EVIDENCIA. El render dice `Estado: INSUFFICIENT_EVIDENCE`
 * —una afirmación sobre lo que la evidencia verificada disponible justifica— y
 * nunca una afirmación sobre lo que la persona sabe o puede hacer. La ausencia de
 * evidencia no es evidencia de ausencia, y el texto no puede sugerir lo contrario.
 *
 * DELTA DE PROMOCIÓN: el renderer congelado prefijaba cada cita con
 * `credentialId / sourceId`. `EvidenceUnitSourceTrace` del producto NO lleva
 * `credentialId` —se llega por el item de inventario, y duplicarlo crearía una
 * segunda autoridad del mismo hecho—, así que la cita se prefija sólo con el
 * `sourceId` local del run. Es una diferencia de RENDER, no de policy: ninguna
 * entrada de `resolveFinalState` cambia.
 */
export function renderExplanation(
  requirementText: string,
  analysisRequirement: ObjectiveAnalysisRequirement,
  contextual: ContextualRequirementResult,
  finalState: FinalStateToken,
  evidenceById: ReadonlyMap<string, EvidenceUnitV1>
): string {
  const parts: string[] = [
    `Requirement: ${requirementText}.`,
    `Objetivo epistemológico: ${analysisRequirement.epistemicTarget}.`,
    `Estado: ${finalState}.`
  ];

  const ceiling = contextual.jointClaimCeiling;
  if (ceiling.text) parts.push(`Claim ceiling: ${ceiling.text}.`);

  const search = contextual.weakerClaimSearch;
  const candidate = search.candidate;
  if (search.status === 'FOUND' && candidate !== null) {
    const continuity = candidate.continuityAssessment;
    parts.push(`Claim más débil considerado: ${candidate.text}.`);
    if (continuity.status === 'YES') {
      parts.push(
        `Continuidad: reducción constitutiva del mismo Requirement (${continuity.rationale.trim()}).`
      );
      if (continuity.explicitlyRelaxed.length > 0) {
        parts.push(
          `Se relaja explícitamente: ${continuity.explicitlyRelaxed.join('; ')}.`
        );
      }
    } else if (continuity.status === 'NO') {
      parts.push(
        `Continuidad: no constitutiva (${String(continuity.shiftReason)}). ${continuity.rationale.trim()}`
      );
    } else {
      parts.push('Continuidad: no resoluble responsablemente.');
    }
  } else if (search.status === 'NONE') {
    parts.push(
      `Búsqueda de claim más débil: no se identificó una versión defendible. ${search.rationale.trim()}`
    );
  } else if (search.status === 'UNRESOLVED') {
    parts.push(
      `Búsqueda de claim más débil: no resoluble responsablemente. ${search.rationale.trim()}`
    );
  }

  // Orden de aparición y sin repetir, igual que `dict.fromkeys` del congelado.
  const ids = [
    ...ceiling.supportingEvidenceUnitIds,
    ...(candidate === null ? [] : candidate.supportingEvidenceUnitIds)
  ];
  const quotes: string[] = [];
  for (const id of new Set(ids)) {
    const unit = evidenceById.get(id);
    if (unit === undefined) continue;
    quotes.push(`${unit.sourceTrace.sourceId}: “${unit.sourceTrace.exactExcerpt}”`);
  }
  if (quotes.length > 0) parts.push(`Evidencia: ${quotes.join('; ')}.`);

  const observability = contextual.observabilityAssessment;
  if (observability.observabilityStatus !== 'SUFFICIENT') {
    parts.push(`Observabilidad: ${observability.rationale.trim()}`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

export interface DeterministicPolicyInput {
  /** Snapshot congelado del Objective: ORDEN y TEXTO autoritativos. */
  readonly definition: VerifiedObjectiveDefinition;
  readonly objectiveAnalysis: VerifiedObjectiveAnalysis;
  readonly evidenceUnits: VerifiedEvidenceUnits;
  readonly contextualReasoning: ContextualReasoningV1;
}

/**
 * Error de CONSISTENCIA de las entradas de policy.
 *
 * No es un fallo del proveedor ni de transporte: es que el conjunto de entradas
 * verificadas no se corresponde entre sí. Lo lanza la policy pura para que el
 * orquestador decida el desenlace del run; la policy no conoce el lifecycle.
 */
export class DeterministicPolicyInputError extends Error {
  public constructor(
    public readonly invariant: string,
    public readonly requirementId?: string
  ) {
    super(`deterministic_policy_input_invalid:${invariant}`);
    this.name = 'DeterministicPolicyInputError';
  }
}

/**
 * Aplica la policy congelada y construye `reasoning_run_result_v1`.
 *
 * EL ORDEN LO MANDA EL SNAPSHOT. `requirementResults` sale recorriendo
 * `definition.requirements`, no el array contextual: quien decide qué se evaluó y
 * en qué orden es el Objective congelado del run, y así una respuesta reordenada
 * no puede reordenar el resultado.
 *
 * IDENTIDAD LOCAL AL REQUIREMENT. Los qualifiers y las facets se resuelven contra
 * el Requirement en curso, nunca contra un mapa global: `req_01/q_01` y
 * `req_02/q_01` son distintos, y lo mismo vale para `localFacetKey`.
 */
export function applyDeterministicReasoningPolicy(
  input: DeterministicPolicyInput
): ReasoningRunResultV1 {
  const analysisByRequirement = new Map(
    input.objectiveAnalysis.requirements.map((item) => [item.requirementId, item])
  );
  const contextualByRequirement = new Map(
    input.contextualReasoning.requirementResults.map((item) => [
      item.requirementId,
      item
    ])
  );
  const evidenceById = new Map(
    input.evidenceUnits.evidenceUnits.map((unit) => [unit.evidenceUnitId, unit])
  );

  // Ni de más ni de menos: exactamente un resultado contextual por Requirement.
  if (
    contextualByRequirement.size !==
    input.contextualReasoning.requirementResults.length
  ) {
    throw new DeterministicPolicyInputError(
      'contextual_results_must_not_repeat_a_requirement'
    );
  }
  if (
    input.contextualReasoning.requirementResults.length !==
    input.definition.requirements.length
  ) {
    throw new DeterministicPolicyInputError(
      'exactly_one_contextual_result_per_snapshot_requirement'
    );
  }

  const requirementResults: RequirementResult[] = [];
  const validations: StageValidationRecord[] = [];

  for (const requirement of input.definition.requirements) {
    const analysisRequirement = analysisByRequirement.get(
      requirement.requirementId
    );
    if (analysisRequirement === undefined) {
      throw new DeterministicPolicyInputError(
        'objective_analysis_must_cover_every_snapshot_requirement',
        requirement.requirementId
      );
    }
    const contextual = contextualByRequirement.get(requirement.requirementId);
    if (contextual === undefined) {
      throw new DeterministicPolicyInputError(
        'contextual_reasoning_must_cover_every_snapshot_requirement',
        requirement.requirementId
      );
    }

    // 1. Entradas de policy, con `hardFactualFailure` todavía en `false`.
    const preliminary = derivePolicyInputs(analysisRequirement, contextual, false);

    // 2. Guards duros sobre esas entradas ya derivadas.
    const guards = epistemicIntegrityGuards(
      analysisRequirement,
      contextual,
      input.evidenceUnits,
      preliminary.weakerSearchRequired
    );
    const hardFactualFailure = hasHardFactualFailure(guards);

    // 3. Los DOS estados, igual que el runtime congelado: el que habría salido
    //    sin guards y el definitivo. La diferencia es lo que aportó el guard.
    const preGuardState = resolveFinalState(preliminary.finalStateInputs);
    const derived = derivePolicyInputs(
      analysisRequirement,
      contextual,
      hardFactualFailure
    );
    const finalState = resolveFinalState(derived.finalStateInputs);

    const policyTrace: PolicyTrace = Object.freeze({
      preGuardState,
      hardFactualFailure,
      formativeEvidenceCapable:
        derived.finalStateInputs.formativeEvidenceCapable,
      epistemicTarget: analysisRequirement.epistemicTarget,
      unresolved: derived.finalStateInputs.unresolved,
      reachesFullRequirement: derived.finalStateInputs.reachesFullRequirement,
      weakerSearchStatus: contextual.weakerClaimSearch.status,
      continuityStatus: derived.continuityStatus,
      materialUsefulness: derived.materialUsefulness,
      hasMateriallyUsefulWeakerClaim:
        derived.finalStateInputs.hasMateriallyUsefulWeakerClaim,
      weakerClaimStillBelongsToRequirement:
        derived.finalStateInputs.weakerClaimStillBelongsToRequirement,
      observabilityStatus:
        contextual.observabilityAssessment.observabilityStatus
    });

    requirementResults.push(
      Object.freeze({
        ...contextual,
        finalState,
        policyTrace,
        explanation: renderExplanation(
          requirement.requirementText,
          analysisRequirement,
          contextual,
          finalState,
          evidenceById
        )
      })
    );
    validations.push(...guards);
  }

  return Object.freeze({
    schemaVersion: REASONING_RUN_RESULT_SCHEMA_VERSION,
    requirementResults: Object.freeze(requirementResults),
    validations: Object.freeze(validations)
  });
}
