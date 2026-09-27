import type { RequirementFinalState } from '@/types/reasoning-runs';

/**
 * Qué SIGNIFICA la evidencia bajo cada estado final.
 *
 * El backend proyecta evidencia de forma segura aunque el requisito NO haya
 * quedado respaldado: `evidence[]` sale del claim ceiling que el run realmente
 * produjo, y ese ceiling existe igual cuando el desenlace fue
 * INSUFFICIENT_EVIDENCE, ABSTAIN o NOT_ASSESSABLE. Presencia de evidencia y
 * estado final son cosas DISTINTAS.
 *
 * Un único título del tipo "Evidencia utilizada" debajo de cualquier estado
 * afirmaría una participación probatoria que en varios estados no ocurrió —y en
 * NOT_ASSESSABLE es directamente falso, porque la policy decide ese estado
 * ANTES de mirar la evidencia—.
 *
 * FUNCIÓN PURA Y CERRADA. La presentación se deriva EXCLUSIVAMENTE de
 * `finalState` y de cuánta evidencia hay. No se mira el título de la
 * credencial, ni el texto del requisito, ni la relación, ni parecido de
 * cadenas: cualquiera de esas cosas sería emparejamiento heurístico en el
 * cliente, que es justamente lo que el razonador existe para no hacer.
 */

/** Los cinco modos, uno por estado final. No hay un sexto. */
export const EVIDENCE_PRESENTATION_MODES = [
  'SUPPORTING',
  'PARTIAL_SUPPORT',
  'CONSIDERED_INSUFFICIENT',
  'RELATED_UNCERTAIN',
  'HIDDEN_NON_ASSESSABLE'
] as const;

export type EvidencePresentationMode =
  (typeof EVIDENCE_PRESENTATION_MODES)[number];

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
  /** Si se dibuja la sección de evidencia. */
  visible: boolean;
  /** Título de la sección. `null` cuando no se dibuja. */
  heading: string | null;
  /**
   * Aclaración corta que impide leer la evidencia como respaldo cuando no lo
   * es. `null` cuando el título ya dice exactamente lo que pasó.
   */
  clarification: string | null;
}

/**
 * Títulos por modo.
 *
 * Ninguno de los tres modos de NO respaldo usa el verbo "respalda": esa palabra
 * queda reservada para SUPPORTED y PARTIAL_SUPPORT, que son los únicos dos
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
    'Esta evidencia se revisó, pero no permitió llegar a una conclusión confiable sobre este requisito.',
  HIDDEN_NON_ASSESSABLE: null
};

/**
 * POR QUÉ NOT_ASSESSABLE OCULTA LAS TARJETAS.
 *
 * El primer guard de la policy determinista decide NOT_ASSESSABLE a partir del
 * límite de EVALUABILIDAD y lo hace ANTES de que el soporte de la evidencia
 * pueda decidir el estado: "no se miró la evidencia".
 *
 * Entonces cualquier sección de evidencia bajo ese estado —se titule
 * "utilizada", "considerada" o "relacionada"— sugiere una participación que no
 * existió. El caso concreto que lo hace evidente: un requisito de tres años de
 * experiencia profesional mostrando debajo la cita de una credencial de APIs
 * REST.
 *
 * Esto NO vacía `evidence[]` ni toca el DTO. Es presentación.
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
