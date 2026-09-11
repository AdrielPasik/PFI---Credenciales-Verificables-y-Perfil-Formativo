/**
 * Mappers de respuesta de `/me/objectives` — slice F2.2.
 *
 * ALLOWLIST EXPLICITA, campo por campo. Nunca `{ ...objective }`, nunca la fila
 * de Prisma, nunca una relacion. Es la leccion de F1.5: un mapper que esparce el
 * objeto propaga en silencio cualquier columna futura, y el dia que alguien
 * agregue un campo interno se publica solo.
 *
 * `ownerUserId` NO sale nunca. El dueño es siempre quien pregunta —la ruta va
 * bajo `/me` y el service filtra por `ownerUserId`—, asi que devolverlo no
 * aportaria nada y agregaria un identificador interno a la respuesta.
 */

import {
  type ObjectiveDetailResponseDto,
  type ObjectiveSummaryResponseDto
} from './dto/objective.dto';
import { type VerifiedObjectiveDefinition } from './objective-definition.types';
import { type ObjectiveSummary, type VerifiedObjective } from './objectives.service';

function mapDefinition(
  definition: VerifiedObjectiveDefinition
): ObjectiveDetailResponseDto['definition'] {
  return {
    schemaVersion: definition.schemaVersion,
    objectiveType: definition.objectiveType,
    objectiveContext: definition.objectiveContext,
    // La forma anidada `source` se aplana en la respuesta: el cliente no gana
    // nada con un nivel extra y asi la allowlist es una sola lista plana.
    sourceInputType: definition.source.inputType,
    sourceOriginalText: definition.source.originalText,
    requirements: definition.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      order: requirement.order,
      // Texto EXACTO, tal como se persistio. El mapper no normaliza.
      requirementText: requirement.requirementText,
      provenanceKind: requirement.provenance.kind,
      sourceQuote: requirement.provenance.sourceQuote,
      // Siempre `[]` bajo v1. Se expone para que el contrato de respuesta sea
      // estable cuando exista `objective_definition_v2`.
      qualifiers: requirement.qualifiers as readonly never[]
    }))
  };
}

/** Resumen de la lista. NO incluye `definition`. */
export function mapObjectiveSummary(
  objective: ObjectiveSummary
): ObjectiveSummaryResponseDto {
  return {
    objectiveReference: objective.id,
    objectiveType: objective.objectiveType,
    title: objective.title,
    status: objective.status,
    supersedesObjectiveReference: objective.supersedesObjectiveId,
    createdAt: objective.createdAt.toISOString()
  };
}

/**
 * Detalle completo, incluida la `definition`.
 *
 * Exponerla al propio dueño es correcto: es el Objective que escribio y que
 * necesita ver. Y viene del `VerifiedObjectiveDefinition` que devolvio el
 * service —ya re-verificado—, no del JSON crudo de la fila.
 */
export function mapObjectiveDetail(
  objective: VerifiedObjective
): ObjectiveDetailResponseDto {
  return {
    objectiveReference: objective.id,
    objectiveType: objective.objectiveType,
    title: objective.title,
    status: objective.status,
    supersedesObjectiveReference: objective.supersedesObjectiveId,
    createdAt: objective.createdAt.toISOString(),
    definition: mapDefinition(objective.definition)
  };
}
