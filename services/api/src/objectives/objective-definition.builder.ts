/**
 * Constructor del artifact `objective_definition_v1` — slice F2.1.
 *
 * EL SERVIDOR ES DUEÑO DE LOS CAMPOS TECNICOS. El input de creacion no permite
 * decidir `schemaVersion`, `requirementId` ni `order`: se derivan de la posicion.
 * Pedirle a un futuro browser que sea autoridad sobre identificadores tecnicos
 * seria darle una responsabilidad que no le corresponde y abrir una clase de
 * inconsistencias que despues hay que validar.
 *
 * EL BUILDER NO INFIERE NADA. No descompone texto en Requirements, no llama a
 * ninguna IA, no genera qualifiers y no reescribe el texto de origen. Sólo
 * estructura datos que una persona ya confirmo. La inferencia pertenece a una
 * futura etapa de ingestion asistida, y su salida tendria que pasar por
 * confirmacion humana antes de llegar aca.
 *
 * El resultado NO se asume valido: el flujo es siempre
 *
 *     build  ->  verify  ->  persist
 */

import {
  OBJECTIVE_DEFINITION_SCHEMA_VERSION,
  type ObjectiveDefinitionV1,
  type ObjectiveSourceInputType,
  type ObjectiveTypeToken,
  type RequirementProvenanceKind
} from './objective-definition.types';
import { requirementIdForOrder } from './objective-definition.validator';

/** Un Requirement tal como lo aporta quien crea el Objective. */
export interface ObjectiveRequirementInput {
  /** Se preserva EXACTAMENTE: el builder no hace trim ni normaliza. */
  readonly requirementText: string;
  readonly provenanceKind: RequirementProvenanceKind;
  /** Cita literal del texto de origen, o `null` si se escribio directamente. */
  readonly sourceQuote?: string | null;
}

export interface ObjectiveDefinitionInput {
  readonly objectiveType: ObjectiveTypeToken;
  readonly objectiveContext: string;
  readonly sourceInputType: ObjectiveSourceInputType;
  readonly sourceOriginalText: string | null;
  readonly requirements: readonly ObjectiveRequirementInput[];
}

/**
 * Ensambla el artifact. NO valida: eso es responsabilidad exclusiva de
 * `verifyObjectiveDefinitionArtifact`, que corre inmediatamente despues.
 *
 * Tener un unico verificador —y no reglas repartidas entre builder y validator—
 * es lo que hace que releer una fila persistida aplique EXACTAMENTE los mismos
 * invariantes que se aplicaron al escribirla.
 */
export function buildObjectiveDefinitionV1(
  input: ObjectiveDefinitionInput
): ObjectiveDefinitionV1 {
  return {
    schemaVersion: OBJECTIVE_DEFINITION_SCHEMA_VERSION,
    objectiveType: input.objectiveType,
    objectiveContext: input.objectiveContext,
    source: {
      inputType: input.sourceInputType,
      originalText: input.sourceOriginalText
    },
    requirements: input.requirements.map((requirement, index) => {
      const order = index + 1;
      return {
        requirementId: requirementIdForOrder(order),
        order,
        requirementText: requirement.requirementText,
        provenance: {
          kind: requirement.provenanceKind,
          sourceQuote: requirement.sourceQuote ?? null
        },
        // Siempre `[]`, y el input del caller NO tiene un campo `qualifiers`:
        // no se le pide un dato cuyo unico valor valido es vacio. Congelado para
        // `objective_definition_v1`; ver la nota del validator.
        qualifiers: []
      };
    })
  };
}
