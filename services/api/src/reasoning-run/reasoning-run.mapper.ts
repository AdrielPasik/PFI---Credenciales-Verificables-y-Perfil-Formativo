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
import { failEvidenceProjection } from './reasoning-run-evidence.errors';
import { type ProjectedRequirementEvidence } from './reasoning-run-evidence.projection';

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
  /**
   * Evidencia YA PROYECTADA por Requirement — P2.4A.
   *
   * Llega resuelta, no resoluble: el mapper no consulta el inventario, no lee
   * artefactos y no conoce `src_NN`. La cadena `eu_NN → src_NN → inventario
   * congelado → credencial` vive entera en `reasoning-run-evidence.projection`,
   * y acá sólo se copia campo por campo.
   *
   * `null` cuando el run no completó, que es exactamente cuando `result` es
   * `null`. La lista no la necesita y no la pide: el resumen no lleva evidencia.
   */
  readonly evidence: ReadonlyMap<string, ProjectedRequirementEvidence> | null;
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
 * `explanation` NO SALE — P2.4A.1. El render determinista de F3.6 se sigue
 * persistiendo exacto, y no se reescribe ni se resume ni se le pasa otro modelo
 * por encima: si se reformulara, dejaría de ser la explicación que el run
 * realmente produjo. Pero es diagnóstico —`src_01: "…"`, tokens de enum— y por
 * eso deja de viajar al cliente. La respuesta lleva en su lugar la cadena ya
 * RESUELTA: `evidence[]` con la cita y su credencial.
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
    requirementResults: view.result.requirementResults.map((item) => {
      // La proyección recorre EXACTAMENTE estos Requirements, así que una entrada
      // ausente significa que el mapper recibió una evidencia de otro resultado.
      // No se completa con una lista vacía: eso mostraría "sin evidencia" para un
      // requisito que sí la tenía.
      const projected = view.evidence?.get(item.requirementId);
      if (projected === undefined) {
        failEvidenceProjection('EVIDENCE_UNIT_NOT_IN_CATALOG');
      }

      return {
        requirementId: item.requirementId,
        // El cruce ya se verificó antes de llegar acá: el id existe en el snapshot.
        requirementText: textByRequirementId.get(item.requirementId) as string,
        // Token cerrado de los cinco. No se colapsa a pass/fail ni a porcentaje.
        finalState: item.finalState,
        // `item.explanation` NO se copia — P2.4A.1. Sigue en el artifact, exacta,
        // pero es diagnóstico y no viaja al holder. Ver el DTO.
        supportedWeakerClaim: projected.supportedWeakerClaim,
        evidence: projected.evidence.map((evidence) => ({
          excerpt: evidence.excerpt,
          contextBefore: evidence.contextBefore,
          contextAfter: evidence.contextAfter,
          sectionLabel: evidence.sectionLabel,
          pageNumber: evidence.pageNumber,
          coverage: evidence.coverage,
          sourceKind: evidence.sourceKind,
          credential:
            evidence.credential === null
              ? null
              : {
                  credentialReference: evidence.credential.credentialReference,
                  title: evidence.credential.title,
                  credentialType: evidence.credential.credentialType,
                  issuerName: evidence.credential.issuerName,
                  currentStatus: evidence.credential.currentStatus
                }
        }))
      };
    })
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
