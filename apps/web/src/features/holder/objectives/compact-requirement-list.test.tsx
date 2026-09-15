import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CompactRequirementList } from '@/features/holder/objectives/compact-requirement-list';
import { ObjectiveSynthesisOverview } from '@/features/holder/objectives/objective-synthesis-overview';
import type {
  ObjectiveSynthesisVM,
  RequirementFinalState,
  RequirementResultVM
} from '@/models/reasoning-runs';

function evidence(overrides = {}) {
  return {
    excerpt: 'Diseño y consumo de APIs REST.',
    contextBefore: 'Contenidos: ',
    contextAfter: ' con persistencia.',
    sectionLabel: 'Contenidos',
    pageNumber: 3,
    coverage: 'PARTIAL' as const,
    sourceKind: 'DOCUMENT' as const,
    credential: {
      credentialReference: 'cred-1',
      title: 'Análisis de datos con Python para negocios',
      credentialType: 'course',
      issuerName: 'Plataforma de Cursos Demo',
      currentStatus: 'issued',
      currentStatusLabel: 'Emitida'
    },
    ...overrides
  };
}

function result(
  index: number,
  finalState: RequirementFinalState,
  overrides: Partial<RequirementResultVM> = {}
): RequirementResultVM {
  return {
    requirementId: `req_${String(index).padStart(2, '0')}`,
    requirementText: `Requisito ${index}: condición importante y deseable para evaluar.`,
    finalState,
    supportedWeakerClaim:
      finalState === 'PARTIALLY_SUPPORTED' ? 'Formación introductoria vinculada.' : null,
    evidence: finalState === 'NOT_ASSESSABLE' ? [evidence()] : [evidence()],
    ...overrides
  };
}

function synthesis(results: readonly RequirementResultVM[]): ObjectiveSynthesisVM {
  const count = (state: RequirementFinalState) =>
    results.filter((candidate) => candidate.finalState === state).length;
  return {
    schemaVersion: 'objective_synthesis_v1',
    reasoningRunReference: 'run-1',
    objectiveReference: 'objective-1',
    stateSummary: {
      supportedCount: count('SUPPORTED'),
      partiallySupportedCount: count('PARTIALLY_SUPPORTED'),
      insufficientEvidenceCount: count('INSUFFICIENT_EVIDENCE'),
      abstainCount: count('ABSTAIN'),
      notAssessableCount: count('NOT_ASSESSABLE')
    },
    requirements: results.map((candidate, index) => ({
      requirementId: candidate.requirementId,
      order: index + 1,
      requirementText: candidate.requirementText,
      finalState: candidate.finalState
    })),
    positiveConclusions: [],
    credentialsSupportingPositiveConclusions: []
  };
}

function renderList(results: readonly RequirementResultVM[], target: string | null = null) {
  void target;
  const view = synthesis(results);
  return render(<ListHarness results={results} synthesis={view} />);
}

function ListHarness({
  results,
  synthesis: view
}: {
  results: readonly RequirementResultVM[];
  synthesis: ObjectiveSynthesisVM;
}) {
  const [activeFilter, setActiveFilter] = useState<'ALL' | RequirementFinalState>('ALL');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  return (
    <CompactRequirementList
      results={results}
      synthesis={view}
      activeFilter={activeFilter}
      expandedIds={expandedIds}
      onFilterChange={(filter) => {
        setActiveFilter(filter);
        setExpandedIds(
          (current) =>
            new Set(
              [...current].filter((requirementId) => {
                const candidate = results.find((item) => item.requirementId === requirementId);
                return candidate !== undefined && (filter === 'ALL' || candidate.finalState === filter);
              })
            )
        );
      }}
      onToggle={(requirementId) =>
        setExpandedIds((current) => {
          const next = new Set(current);
          if (next.has(requirementId)) next.delete(requirementId);
          else next.add(requirementId);
          return next;
        })
      }
    />
  );
}

describe('lista compacta de requisitos', () => {
  it('mantiene el caso real de catorce requisitos escaneable sin evidencia inicial', () => {
    const results = [
      result(1, 'PARTIALLY_SUPPORTED'),
      ...Array.from({ length: 5 }, (_, offset) => result(offset + 2, 'INSUFFICIENT_EVIDENCE')),
      ...Array.from({ length: 2 }, (_, offset) => result(offset + 7, 'ABSTAIN')),
      ...Array.from({ length: 6 }, (_, offset) => result(offset + 9, 'NOT_ASSESSABLE'))
    ];
    renderList(results);

    expect(document.querySelectorAll('article[id^="requirement-result-"]')).toHaveLength(14);
    expect(screen.queryByText('Diseño y consumo de APIs REST.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Respaldados parcialmente (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evidencia insuficiente (5)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sin conclusión confiable (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No evaluables (6)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Respaldados \(0\)/ })).toBeNull();
    expect((document.body.textContent ?? '')).not.toMatch(/1\s*\/\s*14|puntaje|score|ranking/i);
  });

  it('mantiene los cinco estados complementarios y oculta evidencia hasta el segundo disclosure', () => {
    const results: RequirementResultVM[] = [
      result(1, 'SUPPORTED'),
      result(2, 'PARTIALLY_SUPPORTED'),
      result(3, 'INSUFFICIENT_EVIDENCE'),
      result(4, 'ABSTAIN'),
      result(5, 'NOT_ASSESSABLE')
    ];
    renderList(results);

    for (const candidate of results) {
      const card = document.getElementById(`requirement-result-${candidate.requirementId}`)!;
      fireEvent.click(within(card).getByRole('button', { name: 'Ver detalle' }));
    }

    expect(screen.getByRole('button', { name: 'Ver evidencia que respalda este requisito' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Ver evidencia que respalda parcialmente este requisito' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver evidencia disponible' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ver evidencia vinculada al análisis' })).toBeTruthy();
    const notAssessableCard = document.getElementById('requirement-result-req_05')!;
    expect(within(notAssessableCard).queryByRole('button', { name: /evidencia/i })).toBeNull();
    expect(screen.queryByText('Diseño y consumo de APIs REST.')).toBeNull();
    expect(screen.getByText('Formación introductoria vinculada.')).toBeTruthy();
  });

  it('conserva página, cobertura, contexto y credencial después de abrir evidencia', () => {
    renderList([result(1, 'SUPPORTED')]);
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver evidencia que respalda este requisito' })
    );

    expect(screen.getByText('Pagina 3')).toBeTruthy();
    expect(screen.getByText(/La extraccion de esta fuente fue parcial/)).toBeTruthy();
    expect(screen.getByText('Ver el fragmento en contexto')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Ver credencial/ }).getAttribute('href')).toBe(
      '/wallet/credentials/cred-1'
    );
  });

  it('preserva orden al filtrar y colapsa el detalle que queda oculto', () => {
    const results = [
      result(1, 'SUPPORTED'),
      result(2, 'INSUFFICIENT_EVIDENCE'),
      result(3, 'INSUFFICIENT_EVIDENCE'),
      result(4, 'ABSTAIN')
    ];
    renderList(results);
    fireEvent.click(
      within(document.getElementById('requirement-result-req_01')!).getByRole('button', {
        name: 'Ver detalle'
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Evidencia insuficiente (2)' }));

    expect(document.querySelectorAll('article[id^="requirement-result-"]')).toHaveLength(2);
    expect(document.getElementById('requirement-result-req_02')).not.toBeNull();
    expect(document.getElementById('requirement-result-req_03')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Todos (4)' }));
    expect(
      within(document.getElementById('requirement-result-req_01')!).getByRole('button', {
        name: 'Ver detalle'
      })
    ).toBeTruthy();
  });

  it('no agrega filtros para tres requisitos', () => {
    renderList([
      result(1, 'SUPPORTED'),
      result(2, 'PARTIALLY_SUPPORTED'),
      result(3, 'NOT_ASSESSABLE')
    ]);

    expect(screen.queryByLabelText('Filtrar requisitos')).toBeNull();
  });

  it('mantiene treinta requisitos en el orden congelado sin paginación', () => {
    const results = Array.from({ length: 30 }, (_, index) =>
      result(index + 1, index % 2 === 0 ? 'INSUFFICIENT_EVIDENCE' : 'NOT_ASSESSABLE')
    );
    renderList(results);

    expect(document.querySelectorAll('article[id^="requirement-result-"]')).toHaveLength(30);
    expect(document.getElementById('requirement-result-req_01')).not.toBeNull();
    expect(document.getElementById('requirement-result-req_30')).not.toBeNull();
  });

  it('navega desde la síntesis, resetea el filtro, expande y enfoca el requisito', async () => {
    const results = [
      result(1, 'INSUFFICIENT_EVIDENCE'),
      result(2, 'PARTIALLY_SUPPORTED'),
      result(3, 'ABSTAIN'),
      result(4, 'NOT_ASSESSABLE')
    ];
    const view = synthesis(results);
    view.positiveConclusions = [
      {
        requirementId: 'req_02',
        requirementText: results[1].requirementText,
        finalState: 'PARTIALLY_SUPPORTED',
        supportedWeakerClaim: 'Formación introductoria vinculada.',
        supportingCredentialReferences: []
      }
    ];
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    function Harness() {
      const [target, setTarget] = useState<string | null>(null);
      const [activeFilter, setActiveFilter] = useState<'ALL' | RequirementFinalState>('ALL');
      const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
      const focusTargetRef = useRef<string | null>(null);
      const [focusRequest, setFocusRequest] = useState(0);

      useEffect(() => {
        const targetId = focusTargetRef.current;
        if (focusRequest === 0 || targetId === null) return;
        const targetElement = document.getElementById(`requirement-result-${targetId}`);
        targetElement?.scrollIntoView?.({ block: 'start' });
        targetElement?.focus({ preventScroll: true });
        focusTargetRef.current = null;
      }, [focusRequest]);

      return (
        <>
          <ObjectiveSynthesisOverview
            synthesis={view}
            completedAtLabel="11 de septiembre de 2026"
            onRequirementDetail={(requirementId) => {
              setTarget(requirementId);
              setActiveFilter('ALL');
              setExpandedIds((current) => new Set(current).add(requirementId));
              focusTargetRef.current = requirementId;
              setFocusRequest((current) => current + 1);
            }}
          />
          <CompactRequirementList
            results={results}
            synthesis={view}
            activeFilter={target === null ? activeFilter : 'ALL'}
            expandedIds={expandedIds}
            onFilterChange={setActiveFilter}
            onToggle={(requirementId) =>
              setExpandedIds((current) => new Set(current).add(requirementId))
            }
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Evidencia insuficiente (1)' }));
    expect(document.getElementById('requirement-result-req_02')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ver el detalle del requisito/ }));

    const target = document.getElementById('requirement-result-req_02')!;
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(within(target).getByRole('button', { name: 'Ocultar detalle' })).toBeTruthy();
    expect(within(target).getByRole('button', { name: /Ver evidencia que respalda parcialmente/ })).toBeTruthy();
    expect(screen.queryByText('Diseño y consumo de APIs REST.')).toBeNull();
  });
});
