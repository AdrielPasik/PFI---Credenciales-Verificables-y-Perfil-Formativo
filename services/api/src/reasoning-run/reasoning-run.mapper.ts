/**
 * Mappers de respuesta de `/me/reasoning-runs` — slice F3.7.
 *
 * ALLOWLIST EXPLÍCITA, campo por campo. Nunca `{ ...run }`, nunca la fila de
 * Prisma, nunca un artifact crudo. Es la lección de F1.5 y de F2.2: un mapper
 * que esparce el objeto publica sola cualquier columna futura.
 *
 * LO QUE NUNCA SALE, y no por olvido:
 *
 *     executionMetadata        el plan: provider, model, prompt, adapter, effort
 *     objectiveAnalysisArtifact / evidenceUnitsArtifact   JSON crudo de etapa
 *     resultArtifact           el envoltorio crudo; se proyecta, no se vuelca
 *     policyTrace              maquinaria de policy, no producto
 *     failureCode              token operativo interno y extensible
 *     ownerUserId              quien pregunta ya es el dueño
 *     validations              registros de reparación internos
 *     semanticUnresolved · compositionAssessment · jointClaimCeiling ·
 *     weakerClaimSearch · evaluatedEvidence · facets · observabilityAssessment
 *                              juicios intermedios del razonador
 *
 * LA AUTORIDAD HISTÓRICA ES EL SNAPSHOT. El Objective que se muestra sale de
 * `objectiveDefinitionSnapshot` y `objectiveTitleSnapshot` de la propia fila,
 * NUNCA de un join contra `Objective.definition`. Si el usuario revisa el
 * Objective después, un run viejo tiene que seguir mostrando contra qué se
 * evaluó realmente; leer la definición actual reescribiría la historia.
 */

import {
  type ReasoningRunDetailResponseDto,
  type ReasoningRunObjectiveSnapshotResponseDto,
  type ReasoningRunResultResponseDto,
  type ReasoningRunSummaryResponseDto
} from './dto/reasoning-run.dto';
import { toFailureCategory } from './reasoning-run-api.errors';
import { type VerifiedObjectiveDefinition } from '../objectives/objective-definition.types';
import { type VerifiedReasoningRunResult } from './reasoning-run-artifact.types';

/** Lo mínimo que el mapper necesita de la fila, ya releído y verificado. */
export interface ReasoningRunView {
  readonly id: string;
  readonly objectiveId: string;
  readonly objectiveTitleSnapshot: string;
  readonly status: string;
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly failedAt: Date | null;
  /** Ya verificado con el validador de F2, no el JSON crudo. */
  readonly definition: VerifiedObjectiveDefinition;
  /** Ya verificado con el validador de F3.1. `null` si el run no completó. */
  readonly result: VerifiedReasoningRunResult | null;
}

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/**
 * Vista histórica del Objective.
 *
 * NO se vuelca `objective_definition_v1` entero. Queda deliberadamente fuera
 * `source.originalText`: es el pegado original de la oferta, puede ser largo y
 * arbitrario, y no aporta nada a entender POR QUÉ este run dio lo que dio. Que
 * viva dentro del snapshot no es razón para publicarlo acá — `/me/objectives` ya
 * es el lugar donde el dueño ve su Objective completo.
 *
 * `provenanceKind` y `sourceQuote` tampoco salen: describen de dónde salió el
 * Requirement al redactarlo, no contra qué se evaluó.
 */
function mapObjectiveSnapshot(
  view: ReasoningRunView
): ReasoningRunObjectiveSnapshotResponseDto {
  return {
    objectiveReference: view.objectiveId,
    // Del snapshot de la fila, NO de `Objective.title` actual.
    title: view.objectiveTitleSnapshot,
    objectiveType: view.definition.objectiveType,
    objectiveContext: view.definition.objectiveContext,
    requirements: view.definition.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      order: requirement.order,
      requirementText: requirement.requirementText
    }))
  };
}

export function mapReasoningRunSummary(
  view: ReasoningRunView
): ReasoningRunSummaryResponseDto {
  return {
    reasoningRunReference: view.id,
    objectiveReference: view.objectiveId,
    objectiveTitle: view.objectiveTitleSnapshot,
    objectiveType: view.definition.objectiveType,
    status: view.status,
    requirementCount: view.definition.requirements.length,
    failureCategory: toFailureCategory(view.failureCode),
    createdAt: view.createdAt.toISOString(),
    startedAt: iso(view.startedAt),
    completedAt: iso(view.completedAt),
    failedAt: iso(view.failedAt)
  };
}

/**
 * El resultado, proyectado.
 *
 * `requirementText` se une desde el SNAPSHOT, porque el artifact referencia
 * Requirements por id y no recopia su texto: una sola autoridad por hecho, igual
 * que en persistencia.
 *
 * `explanation` se copia EXACTA. Es el render determinista de F3.6 y no se
 * reescribe, ni se resume, ni se le pasa otro modelo por encima: si se
 * reformulara, la explicación dejaría de ser la que el run realmente produjo.
 *
 * CONTIENE CITAS DEL PROPIO HOLDER —`src_01: "…"`— y eso es correcto acá: es su
 * material, en su superficie privada. Lo que todavía NO está resuelto es traducir
 * el `src_NN` local del run a una etiqueta legible de credencial/fuente; ver la
 * nota de citación en el registro del slice.
 */
function mapResult(view: ReasoningRunView): ReasoningRunResultResponseDto | null {
  if (view.result === null) return null;

  const textByRequirementId = new Map(
    view.definition.requirements.map((requirement) => [
      requirement.requirementId,
      requirement.requirementText
    ])
  );

  return {
    requirementResults: view.result.requirementResults.map((item) => ({
      requirementId: item.requirementId,
      // El cruce ya se verificó antes de llegar acá: el id existe en el snapshot.
      requirementText: textByRequirementId.get(item.requirementId) as string,
      // Token cerrado de los cinco. No se colapsa a pass/fail ni a porcentaje.
      finalState: item.finalState,
      explanation: item.explanation
    }))
  };
}

export function mapReasoningRunDetail(
  view: ReasoningRunView
): ReasoningRunDetailResponseDto {
  return {
    reasoningRunReference: view.id,
    status: view.status,
    objective: mapObjectiveSnapshot(view),
    failureCategory: toFailureCategory(view.failureCode),
    createdAt: view.createdAt.toISOString(),
    startedAt: iso(view.startedAt),
    completedAt: iso(view.completedAt),
    failedAt: iso(view.failedAt),
    result: mapResult(view)
  };
}
