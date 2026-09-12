export interface AiServiceHealthResponse {
  status: string;
  service: string;
}

export interface AnalyzePdfWithAiInput {
  filePath?: string;
  fileBytes?: Uint8Array;
  documentId?: string;
  correlationId?: string;
  fileName?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export interface BuildFormativeProfileWithAiInput {
  artifacts: unknown[];
}

// C2b.2: metadata declarada por el emisor, separada de `content` a
// proposito -- nunca se concatena con el texto analizable (ver
// AiServiceClient.analyzeText). `languageHint` existe en el contrato para
// uso futuro; el backend todavia no lo infiere ni lo completa.
export interface AnalyzeTextWithAiMetadata {
  platformName?: string;
  hours?: number;
  modality?: string;
  credentialType?: string;
  languageHint?: string;
}

export interface AnalyzeTextWithAiSourceRefs {
  textEvidenceId?: string;
  credentialId?: string;
}

export interface AnalyzeTextWithAiInput {
  content: string;
  metadata?: AnalyzeTextWithAiMetadata;
  sourceRefs?: AnalyzeTextWithAiSourceRefs;
  correlationId?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export type AiServiceErrorCode =
  | 'configuration'
  | 'file'
  | 'unavailable'
  | 'timeout'
  | 'http'
  | 'invalid_response';

export class AiServiceClientError extends Error {
  constructor(
    message: string,
    readonly code: AiServiceErrorCode,
    readonly status: number | null = null,
    readonly detail: unknown = null,
    readonly causeCode: string | null = null,
    /**
     * F3.3B.1: el cuerpo JSON parseado de una respuesta de error, cuando lo hubo.
     *
     * `detail` es una string ya formateada para un humano, y clasificar con ella
     * exigiria parsear texto. Este campo conserva la estructura para que un
     * consumidor pueda validar un contrato en vez de leer prosa. `null` cuando el
     * cuerpo no era JSON, estaba vacio, o el fallo ni siquiera llego a una
     * respuesta.
     */
    readonly body: unknown = null
  ) {
    super(message);
    this.name = 'AiServiceClientError';
  }
}

// F1.3: inputs del transporte de source extraction. Deliberadamente separados de
// los de semantic analysis: aquellos llevan versiones de pipeline/taxonomia y
// metadata declarada por el emisor, que no tienen ningun papel en F0. Aca solo
// viaja lo que los productores F0.2/F0.3 necesitan.
export interface ExtractPdfSourceInput {
  /** Bytes autoritativos, ya leidos por NestJS desde el storage. */
  fileBytes: Uint8Array;
  documentEvidenceId: string;
  sourceSha256: string;
  /**
   * Metadata OPACA. Viaja porque forma parte de la identidad que F0.2 conserva
   * en el artifact. FastAPI no la interpreta como ruta, URL ni ubicacion
   * alternativa de la fuente: el productor opera solo sobre `fileBytes`.
   */
  storageKey: string;
  correlationId?: string;
}

export interface ExtractTextSourceInput {
  /** Contenido persistido, tal cual. El transporte no lo normaliza. */
  content: string;
  textEvidenceId: string;
  sourceSha256: string;
  correlationId?: string;
}

// F3.3B: transporte del Objective Analysis productivo. Evidence-blind por
// construccion — no hay campo donde poner una credencial, una EvidenceUnit ni un
// excerpt, y eso es una propiedad del tipo, no una promesa del prompt.
export interface AnalyzeObjectiveExecutionPlan {
  readonly artifactSchemaVersion: string;
  readonly promptVersion: string;
  readonly adapterVersion: string;
  readonly provider: string;
  /** El modelo SOLICITADO, congelado en el plan del run. Nunca un secreto. */
  readonly model: string;
  readonly reasoningEffort: string;
}

export interface AnalyzeObjectiveRequirement {
  readonly requirementId: string;
  readonly requirementText: string;
}

export interface AnalyzeObjectiveWithAiInput {
  /**
   * Version del contrato de request. La aporta el llamante porque la identidad
   * de etapa vive en un unico modulo productivo, y duplicarla aca la volveria
   * dos fuentes.
   */
  readonly schemaVersion: string;
  readonly executionPlan: AnalyzeObjectiveExecutionPlan;
  readonly objectiveType: string;
  readonly objectiveContext: string;
  readonly requirements: readonly AnalyzeObjectiveRequirement[];
  readonly correlationId?: string;
}

/**
 * Taxonomia CERRADA del transporte de Objective Analysis.
 *
 * Se deriva EXCLUSIVAMENTE del status HTTP. Nunca de parsear el mensaje ni el
 * detail: un texto de error es prosa que cambia, y hacer depender de el si un run
 * muere o se reintenta seria construir semantica sobre algo que nadie versiona.
 */
export const OBJECTIVE_ANALYSIS_TRANSPORT_CODES = [
  /** 409 — el plan congelado no describe lo que el AI service ejecutaria. */
  'EXECUTION_PLAN_MISMATCH',
  /** 502 — el proveedor respondio entero y su salida no cumple el contrato. */
  'PROVIDER_INVALID_OUTPUT',
  /** 503, timeout o servicio caido — no hubo respuesta semantica utilizable. */
  'PROVIDER_TRANSPORT_FAILURE',
  /**
   * 424 — el proveedor rechazo la peticion de forma DETERMINISTA: modelo
   * inexistente, credencial invalida, peticion estructuralmente rechazada.
   *
   * Repetir el MISMO plan no puede dar otro resultado. Por eso es terminal y NO
   * comparte codigo con el fallo transitorio: aquel deja el run reintentable, y
   * confundirlos dejaria un run reintentando para siempre una configuracion que
   * nunca va a funcionar.
   */
  'PROVIDER_CONFIGURATION_FAILURE',
  /**
   * Cualquier otra cosa: 4xx de validacion, 401/403, 5xx inesperado, respuesta
   * no-JSON, configuracion faltante.
   *
   * NO es un desenlace del run. Un request mal armado o una credencial interna
   * rota son bugs de despliegue, y matar el run por eso destruiria trabajo por
   * un error que se arregla redeployando.
   */
  'INTERNAL_AI_SERVICE_FAILURE'
] as const;

export type ObjectiveAnalysisTransportCode =
  (typeof OBJECTIVE_ANALYSIS_TRANSPORT_CODES)[number];

export class ObjectiveAnalysisTransportError extends Error {
  constructor(
    readonly code: ObjectiveAnalysisTransportCode,
    readonly status: number | null = null,
    /**
     * Subcodigo de DIAGNOSTICO cuando `code` es `PROVIDER_INVALID_OUTPUT`.
     *
     * Ya viene allowlisted por `readInvalidOutputSubcode`: es un token del
     * vocabulario cerrado del ai-service o el centinela. `null` en cualquier
     * otro codigo.
     *
     * NO PARTICIPA DE NINGUNA DECISION. El desenlace del run lo sigue
     * decidiendo `code` y nada mas; esto existe para que un fallo se pueda
     * diagnosticar sin reproducirlo. Tampoco entra en `message`: el mensaje del
     * Error se imprime en cualquier log accidental y se mantiene minimo.
     */
    readonly invalidOutputSubcode: string | null = null
  ) {
    // El mensaje lleva SOLO el codigo cerrado y el status. Nunca el detail del
    // AI service: podria arrastrar texto del proveedor a un log.
    super(`${code}${status === null ? '' : `: status ${status}`}`);
    this.name = 'ObjectiveAnalysisTransportError';
  }
}

// ---------------------------------------------------------------------------
// ai_service_error_v1 — F3.3B.1
// ---------------------------------------------------------------------------

/**
 * Envelope de error de APLICACION del AI service.
 *
 * Existe porque el status HTTP solo no puede sostener un desenlace terminal. Un
 * `502` lo puede emitir un proxy, un gateway o un balanceador que jamas ejecuto
 * Objective Analysis, y ese 502 NO demuestra que un proveedor haya respondido
 * nada. Con la forma anterior, esa respuesta opaca mataba el run.
 *
 *     HTTP_STATUS_ALONE_TERMINAL:  NO
 *
 * El status sigue sirviendo como status. La autoridad semantica es `code`, y solo
 * cuando llega dentro de este envelope Y es coherente con el status.
 */
export const AI_SERVICE_ERROR_SCHEMA_VERSION = 'ai_service_error_v1';

/**
 * Correspondencia CONGELADA status <-> code, la misma tabla que el AI service.
 *
 * Se comprueban las dos mitades. Un par incoherente —`502` con
 * `EXECUTION_PLAN_MISMATCH`— significa que la frontera esta emitiendo un contrato
 * internamente inconsistente, y elegir cual de las dos mitades creer seria
 * inventar el hecho que falta.
 */
export const AI_SERVICE_ERROR_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  EXECUTION_PLAN_MISMATCH: 409,
  PROVIDER_INVALID_OUTPUT: 502,
  PROVIDER_TRANSPORT_FAILURE: 503,
  PROVIDER_CONFIGURATION_FAILURE: 424
};

/**
 * Lee el `code` de un cuerpo de error SI Y SOLO SI el envelope es exactamente el
 * contrato y es coherente con el status observado.
 *
 * Devuelve `null` para todo lo demas: cuerpo vacio, HTML, JSON arbitrario,
 * envelope malformado, codigo desconocido, o par status/code inconsistente. El
 * llamante debe tratar ese `null` como "no hay afirmacion de aplicacion", nunca
 * como "elegi el codigo por el status".
 *
 * No se parsea texto: ni `detail`, ni `message`, ni substrings, ni HTML.
 */
export function readAiServiceErrorCode(
  body: unknown,
  status: number | null
): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const envelope = body as Record<string, unknown>;
  if (envelope.schemaVersion !== AI_SERVICE_ERROR_SCHEMA_VERSION) return null;

  const code = envelope.code;
  if (typeof code !== 'string') return null;

  const expected = AI_SERVICE_ERROR_STATUS_BY_CODE[code];
  if (expected === undefined) return null;
  if (status !== expected) return null;

  return code;
}

// ---------------------------------------------------------------------------
// F3.4 — transporte del catalogo de EvidenceUnits
// ---------------------------------------------------------------------------


/**
 * P2.2 — entrada de la propuesta de Requirements de un Objective.
 *
 * SIN `executionPlan`: esta etapa no pertenece a ningún ReasoningRun. SIN nada del
 * holder: lo que viaja es el texto que la persona pegó y su tipo de Objective.
 */
export interface ProposeObjectiveRequirementsWithAiInput {
  readonly schemaVersion: string;
  readonly objectiveType: string;
  /** Contexto de interpretación. Puede ser vacío y no crea Requirements. */
  readonly title: string;
  readonly rawObjectiveText: string;
  readonly correlationId?: string | null;
}

/**
 * Taxonomía CERRADA de transporte de la propuesta.
 *
 * Se deriva del `code` VALIDADO del envelope `ai_service_error_v1`, nunca del
 * status a secas ni de parsear prosa. A diferencia de un ReasoningRun, acá ningún
 * desenlace mata una fila —no hay fila—: la distinción sólo decide si repetir el
 * pedido puede tener otro resultado.
 */
export const OBJECTIVE_PROPOSAL_TRANSPORT_CODES = [
  /** El Objective no entra en una sola llamada. */
  'OBJECTIVE_TOO_LARGE',
  /** El proveedor respondió entero y su salida no sirve. Repetir no ayuda. */
  'PROVIDER_INVALID_OUTPUT',
  /** No se obtuvo respuesta utilizable. Repetir es razonable. */
  'PROVIDER_TRANSPORT_FAILURE',
  /** El proveedor rechazó la petición de forma determinista. */
  'PROVIDER_CONFIGURATION_FAILURE',
  /** Cualquier otra cosa: sin envelope válido no se afirma nada del proveedor. */
  'INTERNAL_AI_SERVICE_FAILURE'
] as const;

export type ObjectiveProposalTransportCode =
  typeof OBJECTIVE_PROPOSAL_TRANSPORT_CODES[number];

export class ObjectiveProposalTransportError extends Error {
  public constructor(public readonly code: ObjectiveProposalTransportCode) {
    super(`objective_proposal_transport:${code}`);
    this.name = 'ObjectiveProposalTransportError';
  }
}


/**
 * Correspondencia status <-> code CERRADA de la etapa de propuesta.
 *
 * No reutiliza `AI_SERVICE_ERROR_STATUS_BY_CODE` porque el vocabulario no es el
 * mismo: acá no existe `EXECUTION_PLAN_MISMATCH` —no hay plan congelado de un
 * tercero— y sí existe `OBJECTIVE_TOO_LARGE`, que es una afirmación sobre la
 * ENTRADA y no sobre el proveedor.
 */
export const OBJECTIVE_PROPOSAL_ERROR_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  PROVIDER_INVALID_OUTPUT: 502,
  PROVIDER_TRANSPORT_FAILURE: 503,
  PROVIDER_CONFIGURATION_FAILURE: 424,
  OBJECTIVE_TOO_LARGE: 413
};

/**
 * Lee el código de aplicación del envelope, exigiendo coherencia con el status.
 *
 * Devuelve `null` cuando no hay una afirmación de aplicación válida: cuerpo vacío,
 * HTML, JSON arbitrario, envelope malformado, código desconocido o par
 * status/code inconsistente. Ese `null` significa "no hay afirmación", nunca
 * "elegí el código por el status". No se parsea texto en ningún caso.
 */
export function readObjectiveProposalErrorCode(
  body: unknown,
  status: number | null
): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const envelope = body as Record<string, unknown>;
  if (envelope.schemaVersion !== AI_SERVICE_ERROR_SCHEMA_VERSION) return null;

  const code = envelope.code;
  if (typeof code !== 'string') return null;

  const expected = OBJECTIVE_PROPOSAL_ERROR_STATUS_BY_CODE[code];
  if (expected === undefined) return null;
  if (status !== expected) return null;

  return code;
}

export interface AnalyzeEvidenceUnitsSegment {
  readonly segmentId: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly exactExcerpt: string;
}

export interface AnalyzeEvidenceUnitsPage {
  readonly pageNumber: number;
  readonly pageOffsetStart: number;
  readonly pageOffsetEnd: number;
}

/**
 * Una fuente INCLUIDA del grounding set congelado.
 *
 * `sourceId` es el `runLocalSourceId`. NO viaja `credentialId`,
 * `documentEvidenceId`, `textEvidenceId`, el id del `AnalysisRunSource` ni
 * `artifactBlobSha256`: eso es topologia de nuestra base y pertenece al binding
 * de NestJS. El proveedor trabaja sobre las fuentes LOCALES del run.
 */
export interface AnalyzeEvidenceUnitsSource {
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly coverageStatus: string;
  readonly canonicalText: string;
  readonly segments: readonly AnalyzeEvidenceUnitsSegment[];
  readonly pages: readonly AnalyzeEvidenceUnitsPage[];
  readonly diagnostics: readonly string[];
}

export interface AnalyzeEvidenceUnitsWithAiInput {
  readonly schemaVersion: string;
  readonly executionPlan: AnalyzeObjectiveExecutionPlan;
  /** Puede venir vacia: un run sin fuentes incluidas produce un catalogo vacio. */
  readonly sources: readonly AnalyzeEvidenceUnitsSource[];
  readonly correlationId?: string;
}


// ---------------------------------------------------------------------------
// F3.5 — transporte del razonamiento contextual (UN Requirement por request)
// ---------------------------------------------------------------------------

export interface AnalyzeContextualReasoningQualifier {
  readonly qualifierId: string | null;
  readonly kind: string;
  readonly value: string;
  readonly sourcePhrase: string;
  readonly role: string;
  readonly rationale: string;
}

export interface AnalyzeContextualReasoningRequirement {
  readonly requirementId: string;
  readonly requirementText: string;
  readonly epistemicTarget: string;
  readonly atomicity: string;
  readonly evaluability: {
    readonly requiredEvidenceType: string;
    readonly formativeEvidenceCapable: boolean;
    readonly rationale: string;
  };
  readonly qualifiers: readonly AnalyzeContextualReasoningQualifier[];
  readonly normalizedRequirement: string;
}

/**
 * Una EvidenceUnit del catalogo verificado, proyectada al transporte.
 *
 * Lleva la cita y su contexto, NO el texto canonico completo de la fuente ni el
 * artifact de extraccion: F3.5 razona sobre EvidenceUnits, no sobre documentos.
 */
export interface AnalyzeContextualReasoningEvidenceUnit {
  readonly evidenceUnitId: string;
  readonly sourceId: string;
  readonly normalizedProposition: string;
  readonly claimType: string;
  readonly semanticQualifiers: readonly { readonly kind: string; readonly value: string }[];
  readonly exactQuote: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly sectionLabel: string | null;
  readonly interpretationProvenance: string;
  readonly extractionQuality: string;
}

export interface AnalyzeContextualReasoningSource {
  readonly sourceId: string;
  readonly sourceProvenance: string;
  readonly coverageStatus: string;
}

export interface AnalyzeContextualReasoningObservabilityFact {
  readonly sourceId: string;
  readonly coverageStatus: string;
  readonly observedEvidenceUnitIds: readonly string[];
  readonly extractionDiagnostics: readonly string[];
}

export interface AnalyzeContextualReasoningPreparation {
  readonly mode: string;
  readonly evidenceUnitIds: readonly string[];
  readonly exactRedundancyGroups: readonly (readonly string[])[];
  readonly sourceObservabilityFacts: readonly AnalyzeContextualReasoningObservabilityFact[];
  readonly discardedEvidenceProposalCount: number;
}

export interface AnalyzeContextualReasoningWithAiInput {
  readonly schemaVersion: string;
  readonly executionPlan: AnalyzeObjectiveExecutionPlan;
  readonly objectiveContext: string;
  /** UN Requirement por llamada: la granularidad congelada del stage. */
  readonly requirement: AnalyzeContextualReasoningRequirement;
  readonly evidenceUnits: readonly AnalyzeContextualReasoningEvidenceUnit[];
  readonly sources: readonly AnalyzeContextualReasoningSource[];
  readonly preparation: AnalyzeContextualReasoningPreparation;
  readonly correlationId?: string;
}
