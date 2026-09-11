/**
 * Contratos de los tres artifacts de etapa del ReasoningRun — slice F3.1.
 *
 *   objective_analysis_v1     -> ReasoningRun.objectiveAnalysisArtifact
 *   evidence_units_v1         -> ReasoningRun.evidenceUnitsArtifact
 *   reasoning_run_result_v1   -> ReasoningRun.resultArtifact
 *
 * UNA AUTORIDAD PERSISTIDA POR HECHO. El resultado NO recopia el Objective
 * Analysis ni el catalogo de EvidenceUnits: los referencia por `requirementId` y
 * `evidenceUnitId`. Ver §12 de
 * evidence-reasoning-f3.0-reasoning-run-product-contract.md.
 *
 * DE DONDE SALEN LOS TOKENS. Todos los vocabularios cerrados de este archivo se
 * leyeron del candidato final congelado —B2.4.1 / Target v1.5.1— en
 * `services/ai-service/experiments/evidence_reasoning/`, no se inventaron:
 *
 *   b24_schemas.py     OBJECTIVE_SCHEMA, UNIFIED_SCHEMA, FACET, CONTINUITY,
 *                      CANDIDATE, EVALUATED, INCOMPLETE
 *   b24_versions.py    EPISTEMIC_TARGETS, WEAKER_SEARCH_STATUSES,
 *                      CONTINUITY_TRANSFORMATIONS
 *   schemas.py         RELATIONS
 *   b2_schemas.py      EVIDENCE_UNIT_PROPOSAL, SEMANTIC_QUALIFIER
 *   b2_artifacts.py    forma del catalogo construido y de `validation()`
 *   policy.py          los cinco final_state
 *
 * DOS CAMPOS DEL EXPERIMENTO NO EXISTEN EN PRODUCCION V1, y conviene decir por
 * que aca y no solo en el record:
 *
 *   lineageId            PRODUCT_LINEAGE_ID_V1: NONE. F3.0 previene el riesgo
 *                        aguas arriba con una sola representacion primaria por
 *                        credencial, en vez de fabricar un linaje productivo.
 *   technicallyVerified  auditado como SAFE_TO_DISCARD: B2.4.1 no lo lee.
 *
 * Y UNO QUEDABA BLOQUEADO, ahora CERRADO:
 *
 *   sourceProvenance     adjudicado como AUTORIDAD DE ASERCION con un unico token
 *                        `ISSUER_DECLARED`. Se completo V1 dentro de la ventana
 *                        pre-productiva (cero productores, cero artifacts
 *                        persistidos), sin crear `evidence_units_v2`. Ver
 *                        `SOURCE_PROVENANCE_TOKENS` mas abajo.
 */

// ---------------------------------------------------------------------------
// schemaVersion
// ---------------------------------------------------------------------------

export const OBJECTIVE_ANALYSIS_SCHEMA_VERSION = 'objective_analysis_v1';
export const EVIDENCE_UNITS_SCHEMA_VERSION = 'evidence_units_v1';
export const REASONING_RUN_RESULT_SCHEMA_VERSION = 'reasoning_run_result_v1';
export const REASONING_EXECUTION_METADATA_SCHEMA_VERSION =
  'reasoning_execution_metadata_v1';

// ---------------------------------------------------------------------------
// Vocabularios congelados
// ---------------------------------------------------------------------------

/** `req_01`, `req_02`, … El MISMO formato que asigna F2 en `objective_definition_v1`. */
export const REQUIREMENT_ID_PATTERN = /^req_\d{2,}$/;

/** `eu_01`, `eu_02`, … Locales al run, asignados por codigo confiable. */
export const EVIDENCE_UNIT_ID_PATTERN = /^eu_\d{2,}$/;

/** `src_01`, `src_02`, … Locales al run: es el `sourceId` que ve el reasoner. */
export const RUN_LOCAL_SOURCE_ID_PATTERN = /^src_\d{2,}$/;

/** DELTA_C: lo produce el Objective Analysis evidence-blind y llega read-only al reasoning. */
export const EPISTEMIC_TARGETS = [
  'FORMATIVE_EVIDENCE',
  'INDIVIDUAL_ACHIEVEMENT',
  'UNRESOLVED'
] as const;

export const ATOMICITY_TOKENS = ['ATOMIC', 'NEEDS_SPLIT', 'UNRESOLVED'] as const;

export const REQUIRED_EVIDENCE_TYPES = [
  'FORMATIVE_EVIDENCE',
  'PROFESSIONAL_HISTORY',
  'PERSONAL_OR_ADMINISTRATIVE_FACT',
  'BEHAVIORAL_PERFORMANCE',
  'UNRESOLVED'
] as const;

export const QUALIFIER_ROLES = [
  'MATERIAL_QUALIFIER',
  'CONTEXTUAL',
  'STRUCTURAL_WRAPPER'
] as const;

export const CLAIM_TYPES = [
  'DECLARED_CONTENT',
  'DECLARED_LEARNING_OUTCOME',
  'ASSESSED_OUTCOME',
  'CREDENTIAL_LEVEL_CLAIM'
] as const;

/**
 * `extractionQuality` de un EvidenceUnit y `coverageStatus` de una fuente son el
 * MISMO vocabulario: el `coverageStatus` de `source_extraction_v1`. No es una
 * coincidencia y no se duplica el concepto — el catalogo congelado copia el valor
 * del snapshot de extraccion tal cual.
 */
export const COVERAGE_STATUS_TOKENS = ['FULL', 'PARTIAL', 'FAILED'] as const;

/**
 * Constante en el codigo congelado: el catalogo siempre escribe `AI_INFERRED`.
 * Se modela como enum de un solo valor, no como string libre, porque el dia que
 * exista una interpretacion humana debe ser un cambio de contrato visible.
 */
export const INTERPRETATION_PROVENANCE_TOKENS = ['AI_INFERRED'] as const;

/**
 * AUTORIDAD DE ASERCION de una fuente. Un solo token en V1.
 *
 * QUE RESPONDE: "¿de quien provienen las afirmaciones formativas que esta fuente
 * representa?". NO responde como se creo la representacion, ni por que camino
 * —manual o generado por el backend— quedo materializada.
 *
 * Los tres caminos productivos mapean al MISMO token:
 *
 *   DocumentEvidence subida por un emisor autorizado      -> ISSUER_DECLARED
 *   TextEvidence manual enviada por un emisor autorizado  -> ISSUER_DECLARED
 *   TextEvidence construida por el backend desde campos
 *   que el emisor declaro al emitir la credencial         -> ISSUER_DECLARED
 *
 * El tercero es el que importa entender:
 *
 *     SYSTEM_TRANSFORMATION_DOES_NOT_CHANGE_ASSERTION_AUTHORITY: YES
 *
 * `ISSUER_DECLARED` NO afirma que el emisor haya tipeado el texto exacto que se
 * materializo. Afirma que las proposiciones de origen provienen de datos bajo su
 * autoridad. Que el backend haya hecho la transformacion no lo convierte en
 * autoridad semantica.
 *
 * Y NO SE PUEDE distinguir de forma confiable manual de generado, aunque se
 * quisiera: `TextEvidence` no tiene campo de origen, `label` es texto libre del
 * usuario en el camino manual, y la generacion reutiliza cualquier `current`
 * existente sin importar su origen.
 *
 *     MANUAL_VS_SYSTEM_TEXT_ORIGIN_RELIABLY_PERSISTED: NO
 *
 * Eso, si algun dia hace falta, es un contrato de ORIGEN DE REPRESENTACION
 * distinto de este, y necesitaria su propio campo persistido — nunca inferirse
 * de `label`, `submittedByUserId` ni patrones de contenido.
 *
 * Igual que en la especificacion congelada: sirve para autoridad y trazabilidad,
 * y NUNCA aumenta semantic support, ni fortalece relation, ni amplia facet
 * coverage, ni sube el claim ceiling.
 */
export const SOURCE_PROVENANCE_TOKENS = ['ISSUER_DECLARED'] as const;

export const RELATION_TOKENS = [
  'DIRECT_SUPPORT',
  'SPECIFIC_SUPPORT',
  'CONTRIBUTORY_SUPPORT',
  'RELATED_NON_ENTAILING',
  'LIMITED_SCOPE',
  'CONFLICTING'
] as const;

export const FACET_COVERAGE_TOKENS = ['FULL', 'PARTIAL', 'NONE'] as const;

export const COMPOSITION_MODES = [
  'NONE',
  'COMPLEMENTARY_COVERAGE',
  'INTEGRATED_CAPABILITY'
] as const;

export const FULL_CLAIM_STATUS_TOKENS = [
  'REACHED',
  'NOT_REACHED',
  'UNRESOLVED'
] as const;

export const OBSERVABILITY_STATUS_TOKENS = [
  'SUFFICIENT',
  'MATERIAL_GAP',
  'UNRESOLVED'
] as const;

export const INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS = [
  'FULL_CLAIM',
  'WEAKER_CLAIM',
  'NONE',
  'UNRESOLVED'
] as const;

export const MISSING_MATERIAL_RELEVANCE_TOKENS = [
  'RELEVANT',
  'NOT_RELEVANT',
  'UNRESOLVED'
] as const;

/** DELTA_A: la busqueda misma es observable; `NONE` ya no se confunde con "nunca se busco". */
export const WEAKER_SEARCH_STATUS_TOKENS = ['FOUND', 'NONE', 'UNRESOLVED'] as const;

export const YES_NO_UNRESOLVED_TOKENS = ['YES', 'NO', 'UNRESOLVED'] as const;

/** DELTA_B: reduccion constitutiva frente a desplazamiento semantico. */
export const CONTINUITY_TRANSFORMATION_TOKENS = [
  'CONSTITUTIVE_REDUCTION',
  'SEMANTIC_SHIFT',
  'UNRESOLVED'
] as const;

export const SHIFT_REASON_TOKENS = [
  'PREREQUISITE_OR_FOUNDATION',
  'NEIGHBOR_OR_SUBSTITUTION',
  'OTHER'
] as const;

export const MATERIAL_USEFULNESS_TOKENS = [
  'YES',
  'NO',
  'UNRESOLVED',
  'NOT_EVALUATED'
] as const;

/**
 * Los cinco estados finales POR REQUIREMENT. No hay un sexto, no hay estado final
 * del Objective, no hay score ni porcentaje.
 *
 * Ninguno de estos pertenece a `ReasoningRun.status`, que es lifecycle
 * operacional: un run que completa habiendo abstenido es `completed`.
 */
export const FINAL_STATE_TOKENS = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'INSUFFICIENT_EVIDENCE',
  'NOT_ASSESSABLE',
  'ABSTAIN'
] as const;

export const VALIDATION_TAXONOMIES = [
  'HARD_FACTUAL_INVARIANT',
  'DETERMINISTIC_REPAIRABLE',
  'SEMANTIC_CONSISTENCY'
] as const;

export const VALIDATION_STATUSES = [
  'PASS',
  'FAIL',
  'REPAIRED',
  'REJECTED',
  'MANUAL_ADJUDICATION_REQUIRED'
] as const;

export type EpistemicTarget = (typeof EPISTEMIC_TARGETS)[number];
export type AtomicityToken = (typeof ATOMICITY_TOKENS)[number];
export type RequiredEvidenceType = (typeof REQUIRED_EVIDENCE_TYPES)[number];
export type QualifierRole = (typeof QUALIFIER_ROLES)[number];
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type CoverageStatusToken = (typeof COVERAGE_STATUS_TOKENS)[number];
export type InterpretationProvenance =
  (typeof INTERPRETATION_PROVENANCE_TOKENS)[number];
export type SourceProvenanceV1 = (typeof SOURCE_PROVENANCE_TOKENS)[number];
export type RelationToken = (typeof RELATION_TOKENS)[number];
export type FacetCoverageToken = (typeof FACET_COVERAGE_TOKENS)[number];
export type CompositionMode = (typeof COMPOSITION_MODES)[number];
export type FullClaimStatus = (typeof FULL_CLAIM_STATUS_TOKENS)[number];
export type ObservabilityStatus = (typeof OBSERVABILITY_STATUS_TOKENS)[number];
export type IndependentObservableSupport =
  (typeof INDEPENDENT_OBSERVABLE_SUPPORT_TOKENS)[number];
export type MissingMaterialRelevance =
  (typeof MISSING_MATERIAL_RELEVANCE_TOKENS)[number];
export type WeakerSearchStatus = (typeof WEAKER_SEARCH_STATUS_TOKENS)[number];
export type YesNoUnresolved = (typeof YES_NO_UNRESOLVED_TOKENS)[number];
export type ContinuityTransformation =
  (typeof CONTINUITY_TRANSFORMATION_TOKENS)[number];
export type ShiftReason = (typeof SHIFT_REASON_TOKENS)[number];
export type MaterialUsefulness = (typeof MATERIAL_USEFULNESS_TOKENS)[number];
export type FinalStateToken = (typeof FINAL_STATE_TOKENS)[number];
export type ValidationTaxonomy = (typeof VALIDATION_TAXONOMIES)[number];
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Registro de validacion/reparacion — compartido por las tres etapas
// ---------------------------------------------------------------------------

/**
 * Misma forma que `validation()` del codigo congelado.
 *
 * SE REPARTE POR ETAPA, no se concentra en el resultado: las validaciones del
 * catalogo de EvidenceUnits pertenecen a `evidence_units_v1`, las del Objective
 * Analysis a `objective_analysis_v1`, y las del reasoning a
 * `reasoning_run_result_v1`. Es la regla de autoridad unica aplicada a los
 * registros de reparacion.
 *
 * `detail` es texto acotado del propio pipeline (un id, un estado de alineacion,
 * un contador). NO es un lugar para contenido de la fuente: quien lo llene con
 * una cita estara filtrando material del holder a un artifact de diagnostico.
 */
export interface StageValidationRecord {
  readonly taxonomy: ValidationTaxonomy;
  readonly code: string;
  readonly status: ValidationStatus;
  readonly artifactRef: string;
  readonly detail: string;
  readonly affectsEpistemicState: boolean;
}

// ---------------------------------------------------------------------------
// objective_analysis_v1
// ---------------------------------------------------------------------------

/**
 * Qualifier derivado del analisis del Requirement.
 *
 * Sin `sourceSpan` ni `traceValid`: en el experimento los produce el aligner
 * contra el texto libre del Objective, y en produccion F2 ya congelo el
 * Requirement — `objective_definition_v1` valida que `qualifier.sourcePhrase` sea
 * literal de `requirementText` en el momento de crear el Objective.
 */
export interface ObjectiveAnalysisQualifier {
  readonly qualifierId: string | null;
  readonly kind: string;
  readonly value: string;
  readonly sourcePhrase: string;
  readonly role: QualifierRole;
  readonly rationale: string;
}

export interface ObjectiveAnalysisEvaluability {
  readonly requiredEvidenceType: RequiredEvidenceType;
  readonly formativeEvidenceCapable: boolean;
  readonly rationale: string;
}

/**
 * El analisis de UN Requirement ya confirmado.
 *
 * `requirementId` es REFERENCIA: lo define `objective_definition_v1` dentro de
 * `ReasoningRun.objectiveDefinitionSnapshot`. Este artifact clasifica; no crea,
 * no divide y no renumera.
 *
 * SIN `requirementQuote` ni copia de `requirementText`: el texto autoritativo ya
 * esta congelado en el snapshot de la MISMA fila del run.
 */
export interface ObjectiveAnalysisRequirement {
  readonly requirementId: string;
  readonly epistemicTarget: EpistemicTarget;
  readonly epistemicTargetRationale: string;
  readonly atomicity: AtomicityToken;
  readonly evaluability: ObjectiveAnalysisEvaluability;
  readonly qualifiers: readonly ObjectiveAnalysisQualifier[];
  /** Parafrasis auxiliar, SIN autoridad. Nunca puede modificar `epistemicTarget`. */
  readonly normalizedRequirement: string;
  readonly validations: readonly StageValidationRecord[];
}

/**
 * SIN `decompositionStatus`, `ambiguityRationale` ni `candidateSegments`:
 * produccion NO descompone el Objective. Persistir `RESOLVED` como constante
 * seria decorar el artifact con el eco de una etapa que no corre.
 *
 * SIN `continuityCore`: no existe en B2.4.1 —cero apariciones en `b24_schemas`,
 * `b24_artifacts`, `b24_prompts`, `b241_prompts` y `b24_validation`—. Era un
 * mecanismo de B2.1 que B2.4 reemplazo por
 * `weakerClaimSearch.candidate.continuityAssessment`, evaluado CON la evidencia
 * delante, o sea que pertenece al resultado y no al analisis evidence-blind.
 */
export interface ObjectiveAnalysisV1 {
  readonly schemaVersion: typeof OBJECTIVE_ANALYSIS_SCHEMA_VERSION;
  readonly requirements: readonly ObjectiveAnalysisRequirement[];
}

// ---------------------------------------------------------------------------
// evidence_units_v1
// ---------------------------------------------------------------------------

export interface EvidenceUnitSemanticQualifier {
  readonly kind: string;
  readonly value: string;
}

/**
 * Coordenadas autoritativas de la cita. Las asigna codigo confiable contra el
 * artifact de extraccion de F0, NUNCA el modelo.
 *
 * `sourceId` es el `runLocalSourceId` de un item INCLUDED del inventario. No hay
 * `credentialId`: se llega por el item de inventario, que ya lo lleva como
 * columna requerida — duplicarlo aca crearia una segunda autoridad del mismo
 * hecho.
 */
export interface EvidenceUnitSourceTrace {
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly segmentId: string | null;
  readonly pageNumber: number | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly exactExcerpt: string;
}

export interface EvidenceUnitV1 {
  readonly evidenceUnitId: string;
  readonly normalizedProposition: string;
  readonly claimType: ClaimType;
  readonly semanticQualifiers: readonly EvidenceUnitSemanticQualifier[];
  readonly exactQuote: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly sectionLabel: string | null;
  readonly sourceTrace: EvidenceUnitSourceTrace;
  readonly interpretationProvenance: InterpretationProvenance;
  readonly extractionQuality: CoverageStatusToken;
}

/**
 * Hecho determinista por fuente. NO es un juicio del reasoner.
 *
 * Auditado: `source_observability_facts(snapshots, evidence_units)` es una
 * funcion pura de los snapshots de extraccion y del catalogo, corre ANTES del
 * reasoning contextual y el prompt congelado la trata como entrada
 * —"sourceObservabilityFacts son hechos deterministicos"—. Por eso vive aca y no
 * en el resultado. No confundir con `observabilityAssessment`, que si es output
 * del reasoner y es por Requirement.
 */
export interface SourceObservabilityFact {
  readonly sourceId: string;
  readonly coverageStatus: CoverageStatusToken;
  readonly observedEvidenceUnitIds: readonly string[];
  readonly extractionDiagnostics: readonly string[];
}

/** Capa determinista de preparacion. Sin llamada a proveedor. */
export interface EvidenceUnitsPreparation {
  readonly mode: 'FULL_SCAN';
  readonly evidenceUnitIds: readonly string[];
  /**
   * Grupos de redundancia. En V1 SOLO por span exacto
   * —`sourceSha256:charStart:charEnd`—, porque `PRODUCT_LINEAGE_ID_V1: NONE`.
   */
  readonly exactRedundancyGroups: readonly (readonly string[])[];
  readonly sourceObservabilityFacts: readonly SourceObservabilityFact[];
  readonly discardedEvidenceProposalCount: number;
}

/**
 * Declaracion por FUENTE del grounding set del run.
 *
 * `sourceProvenance` vive aca y no dentro de cada EvidenceUnit, y es una decision
 * con motivo. En el candidato congelado nace como `snapshot["source"]["sourceProvenance"]`
 * —una propiedad de la FUENTE— y `build_evidence_units` la COPIA a cada unidad
 * construida desde esa fuente. Repetir la copia en el artifact persistido haria
 * representable que dos EvidenceUnits de la misma fuente tuvieran autoridades de
 * asercion distintas, que es imposible por definicion.
 *
 * UNA AUTORIDAD POR HECHO, referenciada deterministicamente por `sourceId`. El
 * adapter de F3.4 la proyecta por unidad al armar el payload del reasoner,
 * exactamente como hace el builder congelado.
 *
 * COMPLETITUD, y esto es para quien escriba F3.4:
 *
 *     sources[]  ==  EXACTAMENTE el conjunto de items INCLUDED del inventario
 *
 * En las dos direcciones. NO se construye recorriendo las EvidenceUnits
 * producidas: una fuente INCLUDED que no genero ninguna unidad —coverage FAILED,
 * por ejemplo— quedaria sin declarar, y esa fuente SI entro al grounding set.
 * `coverage FAILED` es input epistemologico valido con sus limites de
 * observabilidad, no ausencia de fuente. Lo mismo vale para
 * `preparation.sourceObservabilityFacts`.
 *
 * `verifyEvidenceUnitsAgainstRunInventory` verifica esa igualdad de conjuntos.
 */
export interface EvidenceUnitsSource {
  readonly sourceId: string;
  readonly sourceProvenance: SourceProvenanceV1;
}

export interface EvidenceUnitsV1 {
  readonly schemaVersion: typeof EVIDENCE_UNITS_SCHEMA_VERSION;
  readonly sources: readonly EvidenceUnitsSource[];
  readonly evidenceUnits: readonly EvidenceUnitV1[];
  readonly preparation: EvidenceUnitsPreparation;
  readonly validations: readonly StageValidationRecord[];
}

// ---------------------------------------------------------------------------
// reasoning_run_result_v1
// ---------------------------------------------------------------------------

export interface EvaluatedEvidence {
  readonly evidenceUnitId: string;
  readonly relation: RelationToken;
  readonly supportedQualifierIds: readonly string[];
  readonly missingQualifierIds: readonly string[];
  readonly evidenceContribution: string;
  readonly rationale: string;
}

/** `localFacetKey` es LOCAL al Requirement de este run. No es un id global. */
export interface RequirementFacet {
  readonly localFacetKey: string;
  readonly facetText: string;
  readonly requirementBasisPhrases: readonly string[];
  readonly whyNecessary: string;
  readonly essential: boolean;
  readonly coverage: FacetCoverageToken;
  readonly evidenceUnitIds: readonly string[];
  readonly rationale: string;
}

export interface CompositionAssessment {
  readonly mode: CompositionMode;
  readonly nonRedundantEvidenceUnitIds: readonly string[];
  readonly jointlySupportsFullRequirement: boolean;
  readonly integrationRequired: boolean;
  readonly integrationDemonstrated: boolean;
  readonly integrationEvidenceIds: readonly string[];
  readonly missingFacetLocalKeys: readonly string[];
  readonly unresolved: boolean;
  readonly rationale: string;
}

export interface FullClaimAssessment {
  readonly status: FullClaimStatus;
  readonly supportedQualifierIds: readonly string[];
  readonly missingQualifierIds: readonly string[];
  readonly coveredFacetLocalKeys: readonly string[];
  readonly missingFacetLocalKeys: readonly string[];
  readonly rationale: string;
}

export interface JointClaimCeiling {
  readonly text: string;
  readonly supportingEvidenceUnitIds: readonly string[];
}

export interface IncompleteSourceAssessment {
  readonly sourceId: string;
  readonly affectedRequirementElements: readonly string[];
  readonly missingMaterialRelevance: MissingMaterialRelevance;
  readonly rationale: string;
}

export interface ObservabilityAssessment {
  readonly incompleteSourceAssessments: readonly IncompleteSourceAssessment[];
  readonly independentObservableSupport: IndependentObservableSupport;
  readonly observabilityStatus: ObservabilityStatus;
  readonly rationale: string;
}

export interface ContinuityAssessment {
  readonly status: YesNoUnresolved;
  readonly transformation: ContinuityTransformation;
  readonly requirementBasisPhrases: readonly string[];
  readonly constitutiveProjection: string;
  readonly explicitlyRelaxed: readonly string[];
  readonly externalTargetIntroduced: YesNoUnresolved;
  readonly shiftReason: ShiftReason | null;
  readonly rationale: string;
}

export interface WeakerClaimCandidate {
  readonly text: string;
  readonly supportingEvidenceUnitIds: readonly string[];
  readonly derivedFromJointClaimCeiling: YesNoUnresolved;
  readonly droppedQualifierIds: readonly string[];
  readonly droppedFacetLocalKeys: readonly string[];
  readonly continuityAssessment: ContinuityAssessment;
  readonly materialUsefulness: MaterialUsefulness;
  readonly usefulnessRationale: string;
}

export interface WeakerClaimSearch {
  readonly status: WeakerSearchStatus;
  readonly rationale: string;
  readonly candidate: WeakerClaimCandidate | null;
}

/**
 * Las entradas DETERMINISTAS con las que la policy produjo `finalState`.
 *
 * Se persisten para poder reconstruir por que salio ese estado sin re-ejecutar
 * nada. `preGuardState` es el estado que habria salido si no hubiera fallado
 * ningun guard factual duro: la diferencia entre los dos es exactamente lo que
 * aporto el guard.
 */
export interface PolicyTrace {
  readonly preGuardState: FinalStateToken;
  readonly hardFactualFailure: boolean;
  readonly formativeEvidenceCapable: boolean;
  readonly epistemicTarget: EpistemicTarget;
  readonly unresolved: boolean;
  readonly reachesFullRequirement: boolean;
  readonly weakerSearchStatus: WeakerSearchStatus;
  readonly continuityStatus: YesNoUnresolved | null;
  readonly materialUsefulness: MaterialUsefulness | null;
  readonly hasMateriallyUsefulWeakerClaim: boolean;
  readonly weakerClaimStillBelongsToRequirement: boolean;
  readonly observabilityStatus: ObservabilityStatus;
}

export interface RequirementResult {
  readonly requirementId: string;
  readonly finalState: FinalStateToken;
  readonly evaluatedEvidence: readonly EvaluatedEvidence[];
  readonly facets: readonly RequirementFacet[];
  readonly compositionAssessment: CompositionAssessment;
  readonly fullClaimAssessment: FullClaimAssessment;
  readonly jointClaimCeiling: JointClaimCeiling;
  readonly observabilityAssessment: ObservabilityAssessment;
  readonly weakerClaimSearch: WeakerClaimSearch;
  readonly semanticUnresolved: boolean;
  readonly unresolvedReason: string;
  readonly policyTrace: PolicyTrace;
  /**
   * Render determinista, sin ninguna decision semantica nueva.
   *
   * CONTIENE CITAS renderizadas: el renderer congelado arma frases
   * `sourceId: "exactExcerpt"` buscando cada EvidenceUnit en el catalogo. La
   * AUTORIDAD de la cita sigue siendo `evidence_units_v1` y, en ultima instancia,
   * el artifact de extraccion de F0 — pero el string las lleva adentro y eso no
   * se va a describir como "cero duplicacion". Se persiste exacto en vez de
   * re-renderizar al leer, porque un renderer distinto cambiaria en silencio lo
   * que un run historico dijo.
   */
  readonly explanation: string;
}

/**
 * SIN `objectiveAnalysis[]` ni `evidenceUnits[]`: se referencian por
 * `requirementId` y `evidenceUnitId`.
 *
 * SIN estado final del Objective, sin score, sin porcentaje, sin ranking. La
 * especificacion congelada los excluye explicitamente.
 */
export interface ReasoningRunResultV1 {
  readonly schemaVersion: typeof REASONING_RUN_RESULT_SCHEMA_VERSION;
  readonly requirementResults: readonly RequirementResult[];
  readonly validations: readonly StageValidationRecord[];
}

// ---------------------------------------------------------------------------
// reasoning_execution_metadata_v1
// ---------------------------------------------------------------------------

/**
 * Esfuerzo de razonamiento del proveedor.
 *
 * NO es cosmetico: el wrapper congelado manda `reasoning.effort` en cada llamada
 * a OpenAI, asi que dos ejecuciones con el mismo `{provider, model}` y distinto
 * effort NO son la misma configuracion semantica. Un plan que no lo dijera no
 * describiria lo que el run realmente ejecuto.
 *
 * UN SOLO VALOR EN V1, y a proposito: `medium` es la configuracion con la que se
 * ejecuto el candidato aceptado. Ensanchar el vocabulario despues es compatible
 * hacia atras; recortarlo no lo seria, porque los planes ya persistidos se
 * volverian invalidos al releerlos. Es la misma disciplina que F2.1 aplico a los
 * qualifiers.
 */
export const REASONING_EFFORT_TOKENS = ['medium'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_TOKENS)[number];

/** Proveedores con integracion productiva conocida. */
export const EXECUTION_PROVIDERS = ['openai', 'anthropic'] as const;

export type ExecutionProvider = (typeof EXECUTION_PROVIDERS)[number];

/**
 * El proveedor que una etapa VA a usar. Es un compromiso, no una observacion.
 *
 * `model` es el modelo SOLICITADO, que es lo unico que un plan puede prometer. El
 * wrapper congelado distingue `requested_model` de `effective_model` —lo que la
 * API devuelve— y el segundo es una observacion posterior a la llamada, asi que
 * no pertenece a un plan. Limitacion aceptada y documentada en el record: si un
 * proveedor sustituyera el modelo efectivo, el plan seguiria diciendo el
 * solicitado.
 *
 * `reasoningEffort` es REQUERIDO cuando `provider` es `openai`, porque ese
 * wrapper lo envia siempre. Para un proveedor que no lo acepta va `null`.
 */
export interface ProviderPlan {
  readonly provider: ExecutionProvider;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort | null;
}

/**
 * Plan de UNA etapa.
 *
 * Las tres identidades que hay que poder responder historicamente —contrato de
 * artifact, prompt productivo y adapter productivo— son campos EXPLICITOS.
 *
 * Se eligio esta estrategia y no "un manifiesto versionado que `reasonerContractVersion`
 * determina": ese manifiesto tendria que existir de verdad, ser inmutable y estar
 * testeado, y el repo no tiene esa maquinaria. Decir "la version del contrato lo
 * implica" sin una correspondencia ejecutable seria una autoridad imaginaria.
 *
 * `promptVersion` es `null` exactamente cuando `provider` es `null`: una etapa sin
 * proveedor no tiene prompt.
 */
export interface StageExecutionPlan {
  readonly artifactSchemaVersion: string;
  readonly promptVersion: string | null;
  readonly adapterVersion: string;
  readonly provider: ProviderPlan | null;
}

/**
 * Plan de ejecucion COMPLETO del run. NO es un cuarto stage artifact: no es output
 * de ninguna etapa, es la configuracion con la que se van a ejecutar.
 *
 * Fill-once: `ABSENT -> PRESENT`, una sola vez, y se congela ANTES de la primera
 * llamada a un proveedor. Llamar primero y anotar despues que modelo se uso
 * perderia la procedencia de ejecucion ante cualquier crash entre las dos
 * operaciones.
 *
 * `provider: null` significa UNA sola cosa:
 *
 *     ESTA ETAPA NO INVOCA A NINGUN PROVEEDOR, POR DISEÑO DEL PLAN
 *
 * Nunca "todavia no configurado", "desconocido" ni "se llena despues". Con
 * fill-once esas lecturas serian irrecuperables: una etapa futura no podria
 * completar su identidad nunca mas. Si una etapa con proveedor no puede
 * identificarse al congelar el plan, NO se escribe un plan incompleto y NO puede
 * empezar ninguna llamada.
 *
 * EL PLAN ES UN COMPROMISO. Antes de cada llamada, la configuracion desplegada de
 * esa etapa debe COINCIDIR con la congelada acá; si no coincide, no se llama al
 * proveedor y el run no puede continuar bajo ese plan.
 *
 * Nunca secrets, nunca API keys, nunca endpoints, nunca latencia, tokens ni
 * respuesta cruda.
 */
export interface ReasoningExecutionMetadataV1 {
  readonly schemaVersion: typeof REASONING_EXECUTION_METADATA_SCHEMA_VERSION;
  /** Contrato productivo global de reasoning. */
  readonly reasonerContractVersion: string;
  /** Policy determinista. No tiene proveedor ni prompt: no llama a nadie. */
  readonly deterministicPolicyVersion: string;
  readonly objectiveAnalysis: StageExecutionPlan;
  readonly evidenceUnits: StageExecutionPlan;
  readonly contextualReasoning: StageExecutionPlan;
}

// ---------------------------------------------------------------------------
// Salidas verificadas
// ---------------------------------------------------------------------------

/**
 * Un artifact que paso su verificador: desacoplado del input y congelado en
 * profundidad, igual que en F0.4 y F2.1.
 */
export type VerifiedObjectiveAnalysis = ObjectiveAnalysisV1;
export type VerifiedEvidenceUnits = EvidenceUnitsV1;
export type VerifiedReasoningRunResult = ReasoningRunResultV1;
export type VerifiedReasoningExecutionMetadata = ReasoningExecutionMetadataV1;
