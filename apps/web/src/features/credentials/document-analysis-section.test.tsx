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
  onRefresh = vi.fn(async () => undefined),
  onTrigger = vi.fn(async () => undefined)
}: {
  credentialStatus?: CredentialStatus;
  currentDocument?: DocumentEvidenceVM | null;
  currentState?: DocumentAnalysisState;
  onRefresh?: () => Promise<void>;
  onTrigger?: () => Promise<void>;
} = {}) {
  render(
    <DocumentAnalysisSection
      credentialStatus={credentialStatus}
      currentDocument={currentDocument}
      state={currentState}
      onRefresh={onRefresh}
      onTrigger={onTrigger}
    />
  );
  return { onRefresh, onTrigger };
}

describe('DocumentAnalysisSection', () => {
  it('renders initial loading and an honest empty state', () => {
    const { unmount } = render(
      <DocumentAnalysisSection
        credentialStatus="draft"
        currentDocument={pdf}
        state={state({ latestStatus: 'loading' })}
        onRefresh={vi.fn()}
        onTrigger={vi.fn()}
      />
    );
    expect(screen.getByText('Consultando último análisis…')).toBeTruthy();
    unmount();

    renderSection();
    expect(screen.getByText('Todavía no hay análisis registrados.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Analizar documento' })).toBeTruthy();
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

  it('renders failed safe detail and enables manual retry for a draft PDF', () => {
    renderSection({
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
    expect(screen.getByRole('button', { name: 'Reintentar análisis' })).toBeTruthy();
  });

  it('handles completed without semantic summary', () => {
    renderSection({
      currentState: state({ currentRun: runFixture({ semanticAnalysis: null }) })
    });
    expect(
      screen.getAllByText('Análisis completado sin resumen disponible').length
    ).toBeGreaterThan(0);
  });

  it('blocks trigger without a PDF and explains image and read-only cases', () => {
    const { unmount } = render(
      <DocumentAnalysisSection
        credentialStatus="draft"
        currentDocument={null}
        state={state()}
        onRefresh={vi.fn()}
        onTrigger={vi.fn()}
      />
    );
    expect(screen.getByText(/Primero adjuntá una evidencia documental/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Analizar documento' })).toBeNull();
    unmount();

    renderSection({
      currentDocument: { ...pdf, kind: 'image', mimeType: 'image/png' }
    });
    expect(screen.getByText(/admite únicamente evidencia documental en formato PDF/)).toBeTruthy();
  });

  it.each(['issued', 'revoked'] as const)(
    'keeps %s analysis read-only',
    (credentialStatus) => {
      renderSection({
        credentialStatus,
        currentState: state({ currentRun: runFixture() })
      });
      expect(screen.getByText(/solo se inicia nuevamente mientras la credencial está en borrador/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Volver a analizar' })).toBeNull();
    }
  );

  it('supports manual refresh and keeps visible output with an error', () => {
    const onRefresh = vi.fn(async () => undefined);
    renderSection({
      onRefresh,
      currentState: state({
        currentRun: runFixture(),
        latestStatus: 'error',
        latestError: 'No pudimos conectarnos para consultar el análisis.'
      })
    });
    expect(screen.getByText('Habilidades detectadas')).toBeTruthy();
    expect(screen.getByText(/No pudimos conectarnos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar último análisis' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
