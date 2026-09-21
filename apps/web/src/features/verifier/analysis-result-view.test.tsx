/**
 * Copy epistemico del resultado publico.
 *
 * QA manual encontro que INSUFFICIENT_EVIDENCE y NOT_ASSESSABLE se explicaban con
 * la MISMA frase. Son dos estados que la policy determinista decide por razones
 * distintas, y colapsarlos le miente al lector:
 *
 *   INSUFFICIENT_EVIDENCE  el requisito ES evaluable desde evidencia formativa;
 *                          falta evidencia. Mas credenciales podrian cambiarlo.
 *   NOT_ASSESSABLE         el requisito no se evalua adecuadamente SOLO con esta
 *                          clase de evidencia. Mas credenciales del mismo tipo no
 *                          cambiarian nada: no es un problema de cantidad.
 *   ABSTAIN                se podia evaluar el tipo de afirmacion, pero no se
 *                          llego a una conclusion suficientemente fundada.
 *
 * Esto es COPY. No se toca `finalState`, ni la policy, ni la proyeccion publica:
 * lo que ya se decidio solo se dice bien.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import {
  PUBLIC_FINAL_STATE_EXPLANATIONS,
  type PublicAnalysisResultVM,
  type PublicFinalStateToken,
  type PublicRequirementResultVM
} from '@/models/public-analysis';

import { AnalysisResultView } from './analysis-result-view';

afterEach(cleanup);

function requirement(
  order: number,
  finalState: PublicFinalStateToken,
  overrides: Partial<PublicRequirementResultVM> = {}
): PublicRequirementResultVM {
  const labels: Record<PublicFinalStateToken, string> = {
    SUPPORTED: 'Respaldado por la evidencia compartida',
    PARTIALLY_SUPPORTED: 'Respaldado parcialmente',
    INSUFFICIENT_EVIDENCE: 'Evidencia insuficiente',
    NOT_ASSESSABLE: 'No evaluable con esta evidencia',
    ABSTAIN: 'No se pudo determinar con suficiente confiabilidad'
  };
  return {
    order,
    requirementText: `Requisito ${order}`,
    finalState,
    finalStateLabel: labels[finalState],
    supportedWeakerClaim: null,
    supportingCredentials: [],
    ...overrides
  };
}

function view(requirements: PublicRequirementResultVM[]): PublicAnalysisResultVM {
  return {
    state: 'COMPLETED',
    completedAtLabel: '20 sept 2026',
    failure: null,
    objective: {
      objectiveType: 'EMPLOYMENT',
      objectiveTypeLabel: 'Busqueda laboral',
      title: 'Backend junior',
      objectiveContext: '',
      requirements: requirements.map((item) => ({
        order: item.order,
        requirementText: item.requirementText
      }))
    },
    result: {
      requirements,
      synthesis: {
        stateSummary: [],
        totalRequirements: requirements.length,
        positiveConclusions: [],
        supportingCredentials: []
      },
      temporalNotice: 'El análisis refleja la evidencia disponible al momento de su ejecución.'
    }
  };
}

it('los tres estados no positivos explican cosas DISTINTAS', () => {
  render(
    <AnalysisResultView
      result={view([
        requirement(1, 'INSUFFICIENT_EVIDENCE'),
        requirement(2, 'NOT_ASSESSABLE'),
        requirement(3, 'ABSTAIN')
      ])}
    />
  );

  const insuficiente = screen.getByText(
    'La evidencia compartida no alcanza para justificar este requisito.'
  );
  const noEvaluable = screen.getByText(
    'Este requisito no puede evaluarse adecuadamente únicamente a partir de la evidencia formativa compartida.'
  );
  const abstencion = screen.getByText(
    'Scope pudo evaluar este tipo de requisito, pero no llegó a una conclusión suficientemente fundada con la evidencia compartida.'
  );

  // Tres frases, tres significados: ninguna repite a otra.
  const textos = new Set([
    insuficiente.textContent,
    noEvaluable.textContent,
    abstencion.textContent
  ]);
  expect(textos.size).toBe(3);
});

it('NOT_ASSESSABLE ya no se lee como "falta evidencia"', () => {
  render(<AnalysisResultView result={view([requirement(1, 'NOT_ASSESSABLE')])} />);

  // La frase vieja, que afirmaba algo falso para este estado.
  expect(
    screen.queryByText('Para este requisito, la evidencia compartida no alcanza para afirmar un respaldo.')
  ).toBeNull();
  expect(screen.queryByText(/no alcanza/)).toBeNull();
  expect(screen.getByText(/no puede evaluarse adecuadamente/)).toBeTruthy();
});

it('ABSTAIN no se describe como evidencia insuficiente', () => {
  render(<AnalysisResultView result={view([requirement(1, 'ABSTAIN')])} />);

  expect(screen.queryByText(/no alcanza/)).toBeNull();
  expect(screen.getByText(/no llegó a una conclusión suficientemente fundada/)).toBeTruthy();
});

it('cada titulo sigue siendo el suyo', () => {
  render(
    <AnalysisResultView
      result={view([
        requirement(1, 'INSUFFICIENT_EVIDENCE'),
        requirement(2, 'NOT_ASSESSABLE'),
        requirement(3, 'ABSTAIN')
      ])}
    />
  );

  expect(screen.getByText('Evidencia insuficiente')).toBeTruthy();
  expect(screen.getByText('No evaluable con esta evidencia')).toBeTruthy();
  expect(screen.getByText('No se pudo determinar con suficiente confiabilidad')).toBeTruthy();
});

it('PARTIALLY_SUPPORTED conserva el claim mas debil VERBATIM y no gana una frase generica', () => {
  const weaker = 'Exposición formativa a diseño de APIs REST.';
  render(
    <AnalysisResultView
      result={view([
        requirement(1, 'PARTIALLY_SUPPORTED', { supportedWeakerClaim: weaker })
      ])}
    />
  );

  expect(screen.getByText(weaker)).toBeTruthy();
  expect(screen.getByText('Lo que sí queda respaldado')).toBeTruthy();
  expect(screen.queryByText(/no alcanza|no puede evaluarse|no llegó a una conclusión/)).toBeNull();
});

it('SUPPORTED no recibe ninguna explicacion de carencia', () => {
  render(<AnalysisResultView result={view([requirement(1, 'SUPPORTED')])} />);

  expect(screen.getByText('Respaldado por la evidencia compartida')).toBeTruthy();
  expect(screen.queryByText(/no alcanza|no puede evaluarse|no llegó/)).toBeNull();
});

it('los estados positivos no llevan copy de carencia en el modelo', () => {
  expect(PUBLIC_FINAL_STATE_EXPLANATIONS.SUPPORTED).toBeNull();
  expect(PUBLIC_FINAL_STATE_EXPLANATIONS.PARTIALLY_SUPPORTED).toBeNull();
});

it('ningun copy de estado introduce puntaje, ranking ni ajuste', () => {
  const todos = Object.values(PUBLIC_FINAL_STATE_EXPLANATIONS)
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();

  for (const prohibido of ['puntaje', 'score', 'ranking', 'porcentaje', 'match', 'apto', 'califica']) {
    expect(todos).not.toContain(prohibido);
  }
});
