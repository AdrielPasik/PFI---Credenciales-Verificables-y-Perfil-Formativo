/**
 * Errores de la propuesta de Requirements — slice P2.2.
 *
 * TAXONOMÍA CERRADA, ORIENTADA A LO QUE EL HOLDER PUEDE HACER. No describe al
 * proveedor: describe qué le pasó a SU pedido y si vale la pena repetirlo.
 *
 *     INVALID_OBJECTIVE_INPUT       arreglá el texto y volvé a pedir
 *     OBJECTIVE_TOO_LARGE           acortá el Objective
 *     TEMPORARILY_UNAVAILABLE       volvé a intentar en un rato
 *     UNABLE_TO_PRODUCE_PROPOSAL    repetir lo mismo no va a funcionar
 *
 * Ninguna categoría menciona OpenAI, ni un id de modelo, ni una variable de
 * configuración, ni el prompt. Esa información no le sirve al holder y sí le
 * sirve a alguien que esté probando el borde.
 */

export const OBJECTIVE_REQUIREMENT_PROPOSAL_ERROR_CODES = [
  /** El texto enviado no satisface el contrato de entrada. */
  'INVALID_OBJECTIVE_INPUT',
  /** El Objective no entra en una sola llamada. No se trunca ni se segmenta. */
  'OBJECTIVE_TOO_LARGE',
  /** No se obtuvo una propuesta utilizable, pero repetir es razonable. */
  'TEMPORARILY_UNAVAILABLE',
  /** Se obtuvo una respuesta y no sirve. Repetir lo mismo no puede cambiarlo. */
  'UNABLE_TO_PRODUCE_PROPOSAL'
] as const;

export type ObjectiveRequirementProposalErrorCode =
  typeof OBJECTIVE_REQUIREMENT_PROPOSAL_ERROR_CODES[number];

/**
 * Fallo tipado de la etapa.
 *
 * `detail` es un token de máquina para logs y tests. NUNCA viaja al holder en el
 * cuerpo de la respuesta: el controller mapea sólo el `code`.
 */
export class ObjectiveRequirementProposalError extends Error {
  public constructor(
    public readonly code: ObjectiveRequirementProposalErrorCode,
    public readonly detail: string
  ) {
    super(`${code}:${detail}`);
    this.name = 'ObjectiveRequirementProposalError';
  }
}

/**
 * El artefacto que devolvió el AI service no pasó la verificación INDEPENDIENTE
 * de NestJS.
 *
 * Se distingue del fallo del proveedor a propósito: acá el AI service afirmó
 * éxito y su salida no cumple el contrato estructural. Que venga de la red
 * interna no lo vuelve confiable.
 */
export class ObjectiveProposalArtifactInvariantError extends Error {
  public constructor(public readonly detail: string) {
    super(`objective_proposal_artifact_invariant:${detail}`);
    this.name = 'ObjectiveProposalArtifactInvariantError';
  }
}
