import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentAnalysisSection } from '@/features/credentials/document-analysis-section';
import type { DocumentAnalysisState } from '@/features/credentials/use-issuer-document-analysis';
import type { IssuerAnalysisRunVM } from '@/models/analysis-runs';
import type { DocumentEvidenceVM } from '@/models/credentials';
import type { CredentialStatus } from '@/models/credentials';

const pdf: DocumentEvidenceVM = {
  evidenceReference: 'document-private-reference',
  kind: 'pdf',
  status: 'current',
  originalFileName: 'fixture.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  sizeLabel: '10 bytes',
  sha256: 'a'.repeat(64),
  sha256Short: 'aaaaaaaaaaaa…aaaaaaaa',
  uploadedAt: '2026-08-05T11:00:00.000Z',
  uploadedAtLabel: '5 ago 2026, 08:00'
};

function runFixture(
  overrides: Partial<IssuerAnalysisRunVM> = {}
): IssuerAnalysisRunVM {
  return {
    analysisRunReference: 'run-private-reference',
    credentialReference: 'credential-private-reference',
    status: 'completed',
    statusLabel: 'Análisis completado',
    inputMode: 'document',
    inputModeLabel: 'Documento',
    trigger: 'manual',
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    sourceCount: 1,
    sourceTypes: ['document_evidence'],
    sourceLabels: ['Evidencia documental'],
    createdAt: '2026-08-05T12:00:00.000Z',
    createdAtLabel: '5 ago 2026, 09:00',
    startedAt: '2026-08-05T12:00:01.000Z',
    startedAtLabel: '5 ago 2026, 09:00',
    completedAt: '2026-08-05T12:00:08.000Z',
    completedAtLabel: '5 ago 2026, 09:00',
    failedAt: null,
    failedAtLabel: null,
    errorCode: null,
    errorMessage: null,
    semanticAnalysis: {
      semanticAnalysisReference: 'semantic-private-reference',
      status: 'completed',
      pipelineVersion: 'pipeline-v1',
      taxonomyVersion: 'taxonomy-v1',
      confidence: 0.75,
      confidenceLabel: '75 %',
      areasCount: 2,
      skillsCount: 6,
      conceptsCount: 9,
      qualityFlags: ['low_coverage'],
      qualityFlagLabels: ['Cobertura limitada'],
      analyzedAt: '2026-08-05T12:00:08.000Z',
      analyzedAtLabel: '5 ago 2026, 09:00'
    },
    ...overrides
  };
}

function state(
  overrides: Partial<DocumentAnalysisState> = {}
): DocumentAnalysisState {
  return {
    latestStatus: 'ready',
    currentRun: null,
    latestError: null,
    triggering: false,
    refreshing: false,
    actionError: null,
    successMessage: null,
    ...overrides
  };
}

function renderSection({
  credentialStatus = 'draft',
  currentDocument = pdf as DocumentEvidenceVM | null,
  currentState = state(),
  onRetry = vi.fn(async () => undefined)
}: {
  credentialStatus?: CredentialStatus;
  currentDocument?: DocumentEvidenceVM | null;
  currentState?: DocumentAnalysisState;
  onRetry?: () => Promise<void>;
} = {}) {
  render(
    <DocumentAnalysisSection
      credentialStatus={credentialStatus}
      currentDocument={currentDocument}
      state={currentState}
      onRetry={onRetry}
    />
  );
  return { onRetry };
}

describe('DocumentAnalysisSection', () => {
  it('renders initial loading and an honest empty state', () => {
    const { unmount } = render(
      <DocumentAnalysisSection
        credentialStatus="draft"
        currentDocument={pdf}
        state={state({ latestStatus: 'loading' })}
      />
    );
    expect(screen.getByText('Consultando último análisis…')).toBeTruthy();
    unmount();

    renderSection();
    expect(screen.getByText('Interpretación asistida pendiente')).toBeTruthy();
    expect(
      screen.getByText(
        'Scope generará el análisis automáticamente al emitir la credencial.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /analizar documento/i })).toBeNull();
  });

  it('shows zero metrics, null confidence and empty flags as valid output', () => {
    renderSection({
      currentState: state({
        currentRun: runFixture({
          semanticAnalysis: {
            ...runFixture().semanticAnalysis!,
            status: 'partial',
            confidence: null,
            confidenceLabel: 'No informada',
            areasCount: 0,
            skillsCount: 0,
            conceptsCount: 0,
            qualityFlags: [],
            qualityFlagLabels: []
          }
        })
      })
    });

    expect(screen.getAllByText('Análisis parcial').length).toBeGreaterThan(0);
    expect(screen.getByText('Áreas detectadas').nextSibling?.textContent).toBe('0');
    expect(screen.getByText('Habilidades detectadas').nextSibling?.textContent).toBe('0');
    expect(screen.getByText('Conceptos detectados').nextSibling?.textContent).toBe('0');
    expect(screen.getByText('No informada')).toBeTruthy();
    expect(screen.queryByText('Observaciones de calidad')).toBeNull();
    expect(screen.queryByText(/falló|error técnico/i)).toBeNull();
  });

  it('renders completed metrics, confidence and human quality flags without IDs or raw fields', () => {
    renderSection({ currentState: state({ currentRun: runFixture() }) });

    expect(screen.getByText('Áreas detectadas')).toBeTruthy();
    expect(screen.getByText('Habilidades detectadas')).toBeTruthy();
    expect(screen.getByText('Conceptos detectados')).toBeTruthy();
    expect(screen.getByText('75 %')).toBeTruthy();
    expect(screen.getByText('Cobertura limitada')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /run-private-reference|semantic-private-reference|credential-private-reference|analysisJson|textForEmbedding|evidenceMap|storageKey/
    );
  });

  it.each([
    ['pending', 'Análisis pendiente'],
    ['running', 'Analizando documento'],
    ['canceled', 'Análisis cancelado']
  ] as const)('renders %s operational state', (status, label) => {
    renderSection({
      currentState: state({
        currentRun: runFixture({
          status,
          statusLabel: label,
          semanticAnalysis: null,
          completedAt: null,
          completedAtLabel: null
        })
      })
    });
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    if (status === 'pending' || status === 'running') {
      expect(screen.queryByRole('button', { name: /analizar/i })).toBeNull();
    }
  });

  it('offers a safe retry action for a failed manual run while still a draft', () => {
    const onRetry = vi.fn(async () => undefined);
    renderSection({
      onRetry,
      currentState: state({
        currentRun: runFixture({
          status: 'failed',
          statusLabel: 'No se pudo completar el análisis',
          completedAt: null,
          completedAtLabel: null,
          failedAt: '2026-08-05T12:00:08.000Z',
          failedAtLabel: '5 ago 2026, 09:00',
          errorCode: 'analysis_failed',
          errorMessage: 'No se pudo completar el análisis.',
          semanticAnalysis: null
        })
      })
    });

    expect(screen.getByText('No se pudo completar el análisis.')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Reintentar análisis' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('AnalysisRun');
  });

  it('does not offer retry once a failed run is no longer a draft', () => {
    renderSection({
      credentialStatus: 'issued',
      currentState: state({
        currentRun: runFixture({
          status: 'failed',
          statusLabel: 'No se pudo completar el análisis',
          completedAt: null,
          completedAtLabel: null,
          failedAt: '2026-08-05T12:00:08.000Z',
          failedAtLabel: '5 ago 2026, 09:00',
          errorCode: 'analysis_failed',
          errorMessage: 'No se pudo completar el análisis.',
          semanticAnalysis: null
        })
      })
    });

    expect(
      screen.getByText(
        'Revisá los datos cargados o intentá emitir una nueva versión cuando corresponda.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
  });

  it('handles completed without semantic summary', () => {
    renderSection({
      currentState: state({ currentRun: runFixture({ semanticAnalysis: null }) })
    });
    expect(
      screen.getAllByText('Análisis completado sin resumen disponible').length
    ).toBeGreaterThan(0);
  });

  it('explains automatic-analysis eligibility without exposing a trigger', () => {
    const { unmount } = render(
      <DocumentAnalysisSection
        credentialStatus="draft"
        currentDocument={null}
        state={state()}
      />
    );
    expect(
      screen.getByText(
        /Sin un PDF vigente, la credencial puede emitirse, pero no se generará análisis documental automático\./
      )
    ).toBeTruthy();
    expect(screen.queryByText(/habilitar la emisión/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Analizar documento' })).toBeNull();
    unmount();

    renderSection({
      currentDocument: { ...pdf, kind: 'image', mimeType: 'image/png' }
    });
    expect(screen.getByText(/está disponible como respaldo/)).toBeTruthy();
  });

  it.each(['course', 'certification'] as const)(
    '%s uses declared data without claiming that a PDF is required',
    (credentialType) => {
      render(
        <DocumentAnalysisSection
          credentialStatus="draft"
          credentialType={credentialType}
          currentDocument={null}
          state={state()}
        />
      );

      expect(
        screen.getByRole('heading', { name: 'Análisis inteligente de la credencial' })
      ).toBeTruthy();
      expect(
        screen.getByText(/puede utilizar la información declarada de la credencial/i)
      ).toBeTruthy();
      expect(screen.queryByText(/requiere un PDF|requiere evidencia documental|análisis textual queda pendiente/i)).toBeNull();
    }
  );

  it('describes a running text analysis as declared credential information', () => {
    render(
      <DocumentAnalysisSection
        credentialStatus="issued"
        credentialType="course"
        currentDocument={null}
        state={state({
          currentRun: runFixture({
            status: 'running',
            statusLabel: 'Analizando',
            inputMode: 'text',
            inputModeLabel: 'Información declarada',
            semanticAnalysis: null,
            completedAt: null,
            completedAtLabel: null
          })
        })}
      />
    );

    expect(
      screen.getByText(
        'Scope está procesando la información declarada de la credencial.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Scope está procesando la evidencia documental.')).toBeNull();
  });

  it.each(['issued', 'revoked'] as const)(
    'keeps %s analysis read-only',
    (credentialStatus) => {
      renderSection({
        credentialStatus,
        currentState: state({ currentRun: runFixture() })
      });
      expect(
        screen.getByText(/Scope intentó generar una ejecución automática/)
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Volver a analizar' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Analizar documento' })).toBeNull();
    }
  );

  it('shows the automatic-analysis wait state for issued credentials without a run', () => {
    renderSection({ credentialStatus: 'issued' });

    expect(
      screen.getByText('Todavía no hay una interpretación asistida disponible para revisar.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Consultar último análisis' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Analizar documento' })).toBeNull();
    expect(document.body.textContent).not.toContain('La actualización es manual');
  });

  it('presents a failed system run as secondary warning without a retry control', () => {
    renderSection({
      credentialStatus: 'issued',
      currentState: state({
        currentRun: runFixture({
          status: 'failed',
          statusLabel: 'No se pudo completar el análisis',
          trigger: 'system',
          completedAt: null,
          completedAtLabel: null,
          failedAt: '2026-08-05T12:00:08.000Z',
          failedAtLabel: '5 ago 2026, 09:00',
          errorCode: 'ai_unavailable',
          errorMessage: 'Mensaje interno seguro',
          semanticAnalysis: null
        })
      })
    });

    expect(
      screen.getByText('El análisis automático no pudo completarse')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'La credencial sigue emitida y puede consultarse nuevamente más adelante.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Mensaje interno seguro')).toBeNull();
    expect(screen.queryByRole('button', { name: /analizar|reintentar/i })).toBeNull();
  });

  it('never shows the removed manual refresh control or its copy', () => {
    renderSection({
      currentState: state({
        currentRun: runFixture(),
        latestStatus: 'error',
        latestError: 'No pudimos conectarnos para consultar el análisis.'
      })
    });
    expect(screen.getByText('Habilidades detectadas')).toBeTruthy();
    expect(screen.getByText(/No pudimos conectarnos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Consultar último análisis' })).toBeNull();
    expect(document.body.textContent).not.toContain('La actualización es manual');
  });

  it('disables the retry button and reports a retry error without losing visible context', () => {
    const onRetry = vi.fn(async () => undefined);
    renderSection({
      onRetry,
      currentState: state({
        triggering: true,
        actionError: 'No pudimos reintentar el análisis en este momento.',
        currentRun: runFixture({
          status: 'failed',
          statusLabel: 'No se pudo completar el análisis',
          completedAt: null,
          completedAtLabel: null,
          failedAt: '2026-08-05T12:00:08.000Z',
          failedAtLabel: '5 ago 2026, 09:00',
          errorCode: 'analysis_failed',
          errorMessage: null,
          semanticAnalysis: null
        })
      })
    });

    const retry = screen.getByRole('button', { name: 'Reintentando análisis' });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText('No pudimos reintentar el análisis en este momento.')
    ).toBeTruthy();
  });
});
