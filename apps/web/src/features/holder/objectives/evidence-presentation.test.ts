/**
 * Presentacion de la evidencia por estado final — P2.4B.
 *
 * Lo que se defiende aca no es el copy: es que la web no afirme respaldo donde
 * el razonador no lo concluyo.
 */

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_PRESENTATION_MODE_BY_STATE,
  evidencePresentationFor
} from '@/features/holder/objectives/evidence-presentation';
import {
  REQUIREMENT_FINAL_STATES,
  type RequirementFinalState
} from '@/models/reasoning-runs';

const NON_SUPPORT_STATES: RequirementFinalState[] = [
  'INSUFFICIENT_EVIDENCE',
  'ABSTAIN',
  'NOT_ASSESSABLE'
];

describe('mapeo de presentacion', () => {
  it('los cinco estados tienen modo, y no hay un sexto', () => {
    expect(Object.keys(EVIDENCE_PRESENTATION_MODE_BY_STATE).sort()).toEqual(
      [...REQUIREMENT_FINAL_STATES].sort()
    );
  });

  it('se deriva SOLO del estado y de cuanta evidencia hay', () => {
    // Misma entrada, misma salida: no hay nada mas de donde leer.
    for (const state of REQUIREMENT_FINAL_STATES) {
      expect(evidencePresentationFor(state, 1)).toEqual(
        evidencePresentationFor(state, 1)
      );
    }
  });

  it('sin evidencia ningun estado dibuja la seccion', () => {
    for (const state of REQUIREMENT_FINAL_STATES) {
      expect(evidencePresentationFor(state, 0).visible, state).toBe(false);
    }
  });
});

describe('quien puede decir "respalda"', () => {
  it('SUPPORTED presenta la evidencia como respaldo', () => {
    const presentation = evidencePresentationFor('SUPPORTED', 1);
    expect(presentation.mode).toBe('SUPPORTING');
    expect(presentation.visible).toBe(true);
    expect(presentation.heading).toBe('Evidencia que respalda este requisito');
    expect(presentation.clarification).toBeNull();
  });

  it('PARTIALLY_SUPPORTED dice PARCIALMENTE, nunca el requisito entero', () => {
    const presentation = evidencePresentationFor('PARTIALLY_SUPPORTED', 2);
    expect(presentation.mode).toBe('PARTIAL_SUPPORT');
    expect(presentation.visible).toBe(true);
    expect(presentation.heading).toBe(
      'Evidencia que respalda parcialmente este requisito'
    );
  });

  it('NINGUN estado de no-respaldo usa el verbo respaldar', () => {
    for (const state of NON_SUPPORT_STATES) {
      const { heading, clarification } = evidencePresentationFor(state, 1);
      const text = `${heading ?? ''} ${clarification ?? ''}`;
      expect(text.includes('respalda'), state).toBe(false);
      expect(text.includes('utilizada'), state).toBe(false);
    }
  });
});

describe('estados sin respaldo', () => {
  it('INSUFFICIENT_EVIDENCE muestra la evidencia como considerada', () => {
    const presentation = evidencePresentationFor('INSUFFICIENT_EVIDENCE', 1);
    expect(presentation.mode).toBe('CONSIDERED_INSUFFICIENT');
    expect(presentation.visible).toBe(true);
    expect(presentation.heading).toBe('Evidencia considerada');
    expect(presentation.clarification).toBe(
      'La evidencia disponible no alcanza para justificar este requisito.'
    );
  });

  it('ABSTAIN la muestra como relacionada, sin culpar a la persona', () => {
    const presentation = evidencePresentationFor('ABSTAIN', 1);
    expect(presentation.mode).toBe('RELATED_UNCERTAIN');
    expect(presentation.visible).toBe(true);
    expect(presentation.heading).toBe('Evidencia relacionada');
    expect(presentation.clarification).toContain('no permitio llegar a una conclusion');
  });

  it('NOT_ASSESSABLE OCULTA la seccion aunque haya evidencia', () => {
    // El guard 1 de la policy decide este estado antes de mirar la evidencia.
    // Cualquier titulo seria una participacion probatoria que no ocurrio.
    const presentation = evidencePresentationFor('NOT_ASSESSABLE', 3);
    expect(presentation.mode).toBe('HIDDEN_NON_ASSESSABLE');
    expect(presentation.visible).toBe(false);
    expect(presentation.heading).toBeNull();
  });
});
