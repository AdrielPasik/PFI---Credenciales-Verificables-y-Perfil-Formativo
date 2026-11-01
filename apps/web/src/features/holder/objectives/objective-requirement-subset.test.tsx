/**
 * P0 — objetivos guardados antes del tope de 15 requisitos.
 *
 * Lo que se prueba: que la salida NO toque el objetivo original, que no haya
 * preseleccion por orden, que el tope se respete al elegir y que cada requisito
 * elegido viaje exacto (texto, procedencia, cita, texto original).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectiveRequirementSubset } from '@/features/holder/objectives/objective-requirement-subset';
import { buildSubsetObjectiveBody } from '@/features/holder/objectives/review-draft';
import type { ObjectiveDetailVM } from '@/models/objectives';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  push: vi.fn(),
  requestAuthenticated: vi.fn()
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: mocks.requestAuthenticated })
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api/objectives-api', () => ({ createObjectiveRequest: mocks.create }));

const ORIGINAL = Array.from({ length: 20 }, (_unused, index) => `- Requisito ${index + 1}.`).join('\n');

function historic(count = 20): ObjectiveDetailVM {
  return {
    objectiveReference: 'obj-historico',
    objectiveType: 'EMPLOYMENT',
    objectiveTypeLabel: 'Busqueda laboral',
    title: 'Plataforma Senior',
    createdAtLabel: '1 de septiembre de 2026',
    requirements: Array.from({ length: count }, (_unused, index) => ({
      requirementId: `req_${String(index + 1).padStart(2, '0')}`,
      requirementText: `Requisito ${index + 1}`,
      provenanceKind: index % 2 === 0 ? 'DERIVED_FROM_SOURCE_TEXT' : 'DIRECT_STRUCTURED_INPUT',
      originLabel: '',
      sourceQuote: index % 2 === 0 ? `- Requisito ${index + 1}.` : null
    })),
    sourceInputType: 'PASTED_TEXT',
    sourceOriginalText: ORIGINAL,
    objectiveContext: ''
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ objectiveReference: 'obj-nuevo' });
});

describe('P0: objetivo historico de mas de 15', () => {
  it('el cuerpo derivado conserva texto, procedencia, cita y texto original, en orden', () => {
    const body = buildSubsetObjectiveBody(historic(), ['req_05', 'req_02', 'req_01']);
    expect(body.source).toEqual({ inputType: 'PASTED_TEXT', originalText: ORIGINAL });
    expect(body.requirements).toEqual([
      { requirementText: 'Requisito 1', provenanceKind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: '- Requisito 1.' },
      { requirementText: 'Requisito 2', provenanceKind: 'DIRECT_STRUCTURED_INPUT', sourceQuote: null },
      { requirementText: 'Requisito 5', provenanceKind: 'DERIVED_FROM_SOURCE_TEXT', sourceQuote: '- Requisito 5.' }
    ]);
    for (const requirement of body.requirements) {
      if (requirement.sourceQuote !== null) expect(ORIGINAL).toContain(requirement.sourceQuote);
    }
  });

  it('explica la situacion, no preselecciona y respeta el tope de 15', async () => {
    render(<ObjectiveRequirementSubset objective={historic()} />);
    expect(screen.getByText(/Tiene 20 requisitos y un análisis admite hasta 15/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Elegir hasta 15 requisitos para analizar' }));
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((box) => !box.checked)).toBe(true);
    expect((screen.getByRole('button', { name: 'Crear objetivo con los elegidos' }) as HTMLButtonElement).disabled).toBe(true);

    for (const box of boxes.slice(0, 15)) fireEvent.click(box);
    expect(screen.getByText('15 de hasta 15 elegidos')).toBeTruthy();
    expect(boxes[15].disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Crear objetivo con los elegidos' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][1].requirements).toHaveLength(15);
    expect(mocks.push).toHaveBeenCalledWith('/wallet/objectives/obj-nuevo');
  });
});
