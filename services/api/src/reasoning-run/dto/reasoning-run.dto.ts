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
export class ReasoningRunRequirementResultResponseDto {
  requirementId!: string;
  /** Unido desde el snapshot histórico, no desde el Objective actual. */
  requirementText!: string;
  finalState!: string;
  explanation!: string;
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
