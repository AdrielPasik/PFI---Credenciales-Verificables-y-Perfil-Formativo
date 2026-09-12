/**
 * DTOs de la superficie privada `/me/reasoning-runs` — slice F3.7.
 *
 * Tipos planos sin decoradores, igual que `dto/objective.dto.ts`: el repo no
 * tiene `ValidationPipe` global ni `class-validator`, y valida con validadores
 * escritos a mano.
 *
 * EL REQUEST LLEVA UNA SOLA COSA: qué Objective evaluar. Todo lo demás —el
 * universo de evidencia, el inventario, el plan de ejecución— lo congela el
 * servidor a partir de la identidad autenticada. Un cliente no puede aportar
 * credenciales, fuentes ni Requirements, y mandarlos es un 400.
 *
 * LAS RESPUESTAS SON ALLOWLIST. Nada de artifacts crudos, nada de
 * `executionMetadata`, nada de `policyTrace`, nada de `failureCode` interno.
 */

import { type RunFailureCategory } from '../reasoning-run-api.errors';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export class CreateReasoningRunRequestDto {
  /** El Objective del propio usuario contra el que se congela la evidencia. */
  objectiveId!: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Requirement tal como lo vio ESTE run.
 *
 * Sale del snapshot congelado en la fila, no del Objective actual: una revisión
 * posterior del Objective no puede reescribir contra qué se evaluó.
 */
export class ReasoningRunRequirementResponseDto {
  requirementId!: string;
  order!: number;
  requirementText!: string;
}

/** Vista histórica y acotada del Objective evaluado. */
export class ReasoningRunObjectiveSnapshotResponseDto {
  objectiveReference!: string;
  /** `objectiveTitleSnapshot`, no el título actual de la fila Objective. */
  title!: string;
  objectiveType!: string;
  objectiveContext!: string;
  requirements!: ReasoningRunRequirementResponseDto[];
}

export class ReasoningRunSummaryResponseDto {
  reasoningRunReference!: string;
  objectiveReference!: string;
  /** Del snapshot: lo que este run evaluó, no lo que el Objective dice hoy. */
  objectiveTitle!: string;
  objectiveType!: string;
  status!: string;
  requirementCount!: number;
  /** Categoría segura y cerrada. Nunca el `failureCode` interno. */
  failureCategory!: RunFailureCategory | null;
  createdAt!: string;
  startedAt!: string | null;
  completedAt!: string | null;
  failedAt!: string | null;
}

/**
 * Resultado por Requirement.
 *
 * `finalState` es uno de los cinco estados congelados y se preserva EXACTO: no
 * se colapsa a pass/fail, no se convierte en porcentaje y no se rankea.
 *
 * `explanation` es el render determinista de F3.6, copiado literal. No se
 * reescribe, no se resume y no pasa por otro modelo.
 */
/**
 * La credencial que respalda una evidencia, como ETIQUETA.
 *
 * `credentialReference` es el mismo id con el que el holder ya abre su propia
 * credencial, así que P2.4B puede enlazar sin inventar una ruta nueva.
 *
 * `currentStatus` es el estado de HOY y se llama así a propósito. No existe una
 * instantánea autoritativa del estado al momento del run —ver
 * `CREDENTIAL_STATUS_AT_RUN_SNAPSHOT` en la proyección—, así que nadie puede
 * derivar de acá que la credencial cambió desde entonces.
 */
export class ReasoningRunEvidenceCredentialResponseDto {
  credentialReference!: string;
  title!: string;
  credentialType!: string;
  issuerName!: string;
  currentStatus!: string;
}

/**
 * Una evidencia que RESPALDA el resultado de un Requirement.
 *
 * Todo lo citable sale del estado congelado del run; sólo los nombres para
 * mostrar de la credencial se leen del presente.
 *
 * NO SALEN, y no por olvido: `sourceId` / `src_NN`, `evidenceUnitId` / `eu_NN`,
 * `sourceSha256`, `charStart`, `charEnd`, `segmentId`, `artifactBlobSha256`,
 * `selectedAnalysisRunSourceId`, claves de storage y el JSON de extracción.
 */
export class ReasoningRunEvidenceResponseDto {
  /** La cita exacta, VERBATIM desde el artefacto congelado. */
  excerpt!: string;
  contextBefore!: string | null;
  contextAfter!: string | null;
  sectionLabel!: string | null;
  /** `null` legítimo: siempre en fuentes de texto, y en PDF sin página identificada. */
  pageNumber!: number | null;
  /** Observabilidad de la EXTRACCIÓN. Nunca una afirmación sobre la persona. */
  coverage!: string;
  sourceKind!: string;
  /** `null` sólo si la etiqueta no se pudo unir. La cita sigue siendo confiable. */
  credential!: ReasoningRunEvidenceCredentialResponseDto | null;
}

/**
 * Resultado de UN Requirement, ya proyectado para el holder.
 *
 * NO LLEVA `explanation` — P2.4A.1, y no es una omisión.
 *
 * El render determinista de F3.6 se sigue persistiendo EXACTO en el artifact:
 * es la explicación que ese run realmente produjo y reescribirla borraría
 * historia. Pero es DIAGNÓSTICO, no producto: lleva adentro los `src_NN` locales
 * del run, los tokens de `epistemicTarget`, el estado final en crudo y el texto
 * del Requirement repetido.
 *
 * Que P2.4B "no lo muestre" no alcanzaba. En cuanto la web consume este
 * endpoint, todo lo que viaja en el JSON está a un inspector de red de distancia
 * del holder. Una proyección segura no transporta material que ya sabemos
 * inseguro, así que el campo se va del transporte y se queda en la persistencia.
 *
 * El reemplazo NO es una explicación derivada por parsing: P2.4B compone el
 * lenguaje desde `finalState`, `supportedWeakerClaim` y `evidence[]`, que son
 * campos estructurados con autoridad propia.
 */
export class ReasoningRunRequirementResultResponseDto {
  requirementId!: string;
  /** Unido desde el snapshot histórico, no desde el Objective actual. */
  requirementText!: string;
  finalState!: string;
  /**
   * El claim más débil que este run consideró defendible, cuando su búsqueda
   * terminó en `FOUND`. Texto persistido, copiado exacto — nunca parseado desde
   * `explanation`. `null` en cualquier otro caso.
   */
  supportedWeakerClaim!: string | null;
  /**
   * Evidencia que RESPALDA este resultado. Puede estar vacía, y eso es un estado
   * normal: `INSUFFICIENT_EVIDENCE`, `NOT_ASSESSABLE` y `ABSTAIN` suelen no tener
   * ninguna.
   *
   * No es todo lo que el razonador evaluó: lo meramente relacionado, lo de
   * alcance limitado y lo conflictivo NO aparecen acá.
   */
  evidence!: ReasoningRunEvidenceResponseDto[];
}

export class ReasoningRunResultResponseDto {
  /** SIN estado final del Objective, sin score, sin porcentaje, sin ranking. */
  requirementResults!: ReasoningRunRequirementResultResponseDto[];
}

export class ReasoningRunDetailResponseDto {
  reasoningRunReference!: string;
  status!: string;
  objective!: ReasoningRunObjectiveSnapshotResponseDto;
  failureCategory!: RunFailureCategory | null;
  createdAt!: string;
  startedAt!: string | null;
  completedAt!: string | null;
  failedAt!: string | null;
  /** Presente SOLO cuando el run esta `completed`. `null` en cualquier otro caso. */
  result!: ReasoningRunResultResponseDto | null;
}
