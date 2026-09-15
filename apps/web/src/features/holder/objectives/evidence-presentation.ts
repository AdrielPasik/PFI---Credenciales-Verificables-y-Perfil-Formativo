/**
 * Que SIGNIFICA la evidencia bajo cada estado final — P2.4B.
 *
 * P2.4A proyecta evidencia de forma segura aunque el requisito NO haya quedado
 * respaldado: `evidence[]` sale del claim ceiling que el run realmente produjo,
 * y ese ceiling existe igual cuando el desenlace fue INSUFFICIENT_EVIDENCE,
 * ABSTAIN o NOT_ASSESSABLE. Presencia de evidencia y estado final son cosas
 * DISTINTAS.
 *
 * Hasta ahora la web las trataba igual: un unico titulo, "Evidencia utilizada",
 * debajo de cualquier estado. Eso afirma participacion probatoria que en varios
 * estados no ocurrio —y en NOT_ASSESSABLE es directamente falso, porque la
 * policy decide ese estado ANTES de mirar la evidencia—.
 *
 * FUNCION PURA Y CERRADA. La presentacion se deriva EXCLUSIVAMENTE de
 * `finalState` y de cuanta evidencia hay. No se mira el titulo de la credencial,
 * ni el texto del requisito, ni la relacion, ni parecido de cadenas: cualquiera
 * de esas cosas seria emparejamiento heuristico en el frontend, que es
 * justamente lo que F3 existe para no hacer.
 */

import type { RequirementFinalState } from '@/models/reasoning-runs';

/**
 * Los cinco modos, uno por estado final. No hay un sexto, igual que no hay un
 * sexto estado.
 */
export const EVIDENCE_PRESENTATION_MODES = [
  'SUPPORTING',
  'PARTIAL_SUPPORT',
  'CONSIDERED_INSUFFICIENT',
  'RELATED_UNCERTAIN',
  'HIDDEN_NON_ASSESSABLE'
] as const;

export type EvidencePresentationMode = (typeof EVIDENCE_PRESENTATION_MODES)[number];

/** Mapa TOTAL: el tipo obliga a decidir un modo para cada estado. */
export const EVIDENCE_PRESENTATION_MODE_BY_STATE: Record<
  RequirementFinalState,
  EvidencePresentationMode
> = {
  SUPPORTED: 'SUPPORTING',
  PARTIALLY_SUPPORTED: 'PARTIAL_SUPPORT',
  INSUFFICIENT_EVIDENCE: 'CONSIDERED_INSUFFICIENT',
  NOT_ASSESSABLE: 'HIDDEN_NON_ASSESSABLE',
  ABSTAIN: 'RELATED_UNCERTAIN'
};

export interface EvidencePresentation {
  mode: EvidencePresentationMode;
  /** Si se dibuja la seccion de evidencia. */
  visible: boolean;
  /** Titulo de la seccion. `null` cuando no se dibuja. */
  heading: string | null;
  /**
   * Aclaracion corta que impide leer la evidencia como respaldo cuando no lo
   * es. `null` cuando el titulo ya dice exactamente lo que paso.
   */
  clarification: string | null;
}

/**
 * Titulos por modo.
 *
 * Ninguno de los tres modos de NO respaldo usa el verbo "respalda": esa palabra
 * queda reservada para SUPPORTED y PARTIAL_SUPPORT, que son los unicos dos
 * desenlaces en los que la evidencia efectivamente sostiene algo.
 */
const HEADINGS: Record<EvidencePresentationMode, string | null> = {
  SUPPORTING: 'Evidencia que respalda este requisito',
  PARTIAL_SUPPORT: 'Evidencia que respalda parcialmente este requisito',
  CONSIDERED_INSUFFICIENT: 'Evidencia disponible',
  RELATED_UNCERTAIN: 'Evidencia relacionada',
  HIDDEN_NON_ASSESSABLE: null
};

const CLARIFICATIONS: Record<EvidencePresentationMode, string | null> = {
  SUPPORTING: null,
  PARTIAL_SUPPORT: null,
  CONSIDERED_INSUFFICIENT:
    'La evidencia disponible no alcanza para justificar este requisito.',
  RELATED_UNCERTAIN:
    'Esta evidencia se reviso, pero no permitio llegar a una conclusion confiable sobre este requisito.',
  HIDDEN_NON_ASSESSABLE: null
};

/**
 * POR QUE NOT_ASSESSABLE OCULTA LAS TARJETAS EN V1.
 *
 * El primer guard de la policy determinista decide NOT_ASSESSABLE a partir del
 * limite de EVALUABILIDAD —`formativeEvidenceCapable`— y lo hace ANTES de que
 * el soporte de la evidencia pueda decidir el estado. La propia policy lo
 * documenta asi: "no se miro la evidencia".
 *
 * Entonces cualquier seccion de evidencia bajo ese estado —se titule "utilizada",
 * "considerada" o "relacionada"— sugiere una participacion que no existio. El
 * caso concreto que lo hace evidente: un requisito de tres años de experiencia
 * profesional mostrando debajo la cita de una credencial de APIs REST.
 *
 * Esto NO vacia `evidence[]` ni toca el DTO. Es presentacion. Si en el futuro se
 * quiere mostrar contexto de trayectoria relacionado, va en una superficie
 * propia y con su propio nombre, no reusando la seccion de evidencia de un
 * requisito.
 */
export function evidencePresentationFor(
  finalState: RequirementFinalState,
  evidenceCount: number
): EvidencePresentation {
  const mode = EVIDENCE_PRESENTATION_MODE_BY_STATE[finalState];

  return {
    mode,
    visible: mode !== 'HIDDEN_NON_ASSESSABLE' && evidenceCount > 0,
    heading: HEADINGS[mode],
    clarification: CLARIFICATIONS[mode]
  };
}
