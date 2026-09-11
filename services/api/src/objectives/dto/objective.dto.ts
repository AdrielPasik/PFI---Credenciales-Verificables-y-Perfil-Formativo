/**
 * DTOs de la superficie privada `/me/objectives` — slice F2.2.
 *
 * Son tipos planos, sin decoradores: el repo no tiene `ValidationPipe` global ni
 * `class-validator` instalado, y valida con validadores escritos a mano
 * (`create-credential-draft.validator.ts`, `text-evidence.validator.ts`). Se
 * sigue esa convencion en `objective-request.validator.ts`.
 *
 * EL REQUEST LLEVA SOLO CONTENIDO CONFIRMADO POR LA PERSONA. Todo lo tecnico lo
 * sigue poniendo el servidor: `schemaVersion`, `requirementId`, `order` y
 * `qualifiers` NO forman parte de ningun DTO de entrada, y mandarlos es un 400.
 */

import {
  type ObjectiveSourceInputType,
  type ObjectiveTypeToken,
  type RequirementProvenanceKind
} from '../objective-definition.types';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class ObjectiveRequirementRequestDto {
  requirementText!: string;
  provenanceKind!: RequirementProvenanceKind;
  /** Cita literal del texto de origen; `null` u omitido si se escribio directo. */
  sourceQuote?: string | null;
}

export class ObjectiveSourceRequestDto {
  inputType!: ObjectiveSourceInputType;
  originalText!: string | null;
}

export class CreateObjectiveRequestDto {
  objectiveType!: ObjectiveTypeToken;
  /** Metadata de fila, no del artifact. */
  title!: string;
  objectiveContext!: string;
  source!: ObjectiveSourceRequestDto;
  requirements!: ObjectiveRequirementRequestDto[];
}

/**
 * La revision manda el mismo contenido confirmado que una creacion.
 *
 * NO lleva `supersedesObjectiveId`: el predecesor lo determina el path. Y aunque
 * lleva `objectiveType`, el servicio exige que coincida con el del predecesor
 * persistido — el request no puede cambiar el tipo de una linea de revision.
 */
export class CreateObjectiveRevisionRequestDto extends CreateObjectiveRequestDto {}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ObjectiveSummaryResponseDto {
  objectiveReference!: string;
  objectiveType!: string;
  title!: string;
  status!: string;
  supersedesObjectiveReference!: string | null;
  createdAt!: string;
}

export class ObjectiveRequirementResponseDto {
  requirementId!: string;
  order!: number;
  requirementText!: string;
  provenanceKind!: string;
  sourceQuote!: string | null;
  /** Siempre `[]` bajo `objective_definition_v1`. */
  qualifiers!: readonly never[];
}

export class ObjectiveDefinitionResponseDto {
  schemaVersion!: string;
  objectiveType!: string;
  objectiveContext!: string;
  sourceInputType!: string;
  sourceOriginalText!: string | null;
  requirements!: ObjectiveRequirementResponseDto[];
}

export class ObjectiveDetailResponseDto {
  objectiveReference!: string;
  objectiveType!: string;
  title!: string;
  status!: string;
  supersedesObjectiveReference!: string | null;
  createdAt!: string;
  definition!: ObjectiveDefinitionResponseDto;
}
