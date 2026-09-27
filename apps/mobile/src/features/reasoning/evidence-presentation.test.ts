import {
  EVIDENCE_PRESENTATION_MODE_BY_STATE,
  evidencePresentationFor
} from '@/features/reasoning/evidence-presentation';
import { REQUIREMENT_FINAL_STATES } from '@/types/reasoning-runs';

describe('presentación de evidencia por estado final', () => {
  it('cubre los cinco estados, sin un sexto modo', () => {
    for (const state of REQUIREMENT_FINAL_STATES) {
      expect(EVIDENCE_PRESENTATION_MODE_BY_STATE[state]).toBeDefined();
    }
    expect(Object.keys(EVIDENCE_PRESENTATION_MODE_BY_STATE)).toHaveLength(5);
  });

  it('SUPPORTED titula la evidencia como respaldo', () => {
    const presentation = evidencePresentationFor('SUPPORTED', 2);

    expect(presentation.visible).toBe(true);
    expect(presentation.heading).toBe('Evidencia que respalda este requisito');
    expect(presentation.clarification).toBeNull();
  });

  it('PARTIALLY_SUPPORTED aclara que el respaldo es parcial', () => {
    expect(evidencePresentationFor('PARTIALLY_SUPPORTED', 1).heading).toBe(
      'Evidencia que respalda parcialmente este requisito'
    );
  });

  it('INSUFFICIENT_EVIDENCE NO usa el verbo respaldar y aclara el límite', () => {
    const presentation = evidencePresentationFor('INSUFFICIENT_EVIDENCE', 3);

    expect(presentation.heading).toBe('Evidencia disponible');
    expect(presentation.heading).not.toMatch(/respald/i);
    expect(presentation.clarification).toBe(
      'La evidencia disponible no alcanza para justificar este requisito.'
    );
  });

  it('ABSTAIN la presenta como relacionada, no como respaldo', () => {
    const presentation = evidencePresentationFor('ABSTAIN', 1);

    expect(presentation.heading).toBe('Evidencia relacionada');
    expect(presentation.heading).not.toMatch(/respald/i);
    expect(presentation.clarification).toMatch(/no permitió llegar/i);
  });

  it('NOT_ASSESSABLE OCULTA la evidencia aunque el backend la proyecte', () => {
    // La policy decide este estado ANTES de mirar la evidencia: mostrarla
    // sugeriría una participación probatoria que no existió.
    const presentation = evidencePresentationFor('NOT_ASSESSABLE', 5);

    expect(presentation.visible).toBe(false);
    expect(presentation.heading).toBeNull();
  });

  it('sin evidencia no se dibuja la sección en ningún estado', () => {
    for (const state of REQUIREMENT_FINAL_STATES) {
      expect(evidencePresentationFor(state, 0).visible).toBe(false);
    }
  });

  it('ningún copy de no-respaldo usa la palabra respalda', () => {
    for (const state of [
      'INSUFFICIENT_EVIDENCE',
      'ABSTAIN',
      'NOT_ASSESSABLE'
    ] as const) {
      const presentation = evidencePresentationFor(state, 1);
      expect(presentation.heading ?? '').not.toMatch(/respalda/i);
    }
  });
});
