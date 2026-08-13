import { describe, expect, it } from 'vitest';

import {
  adaptDocumentAnalysisTriggerResponse,
  adaptIssuerAnalysisRunResponse,
  adaptLatestIssuerAnalysisRunResponse
} from '@/lib/adapters/analysis-runs.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function runResponse(overrides: Record<string, unknown> = {}) {
  return {
    analysisRunId: 'run-private-reference',
    credentialId: 'credential-private-reference',
    status: 'completed',
    inputMode: 'document',
    trigger: 'manual',
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    sourceCount: 1,
    sourceTypes: ['document_evidence'],
    createdAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    completedAt: '2026-08-05T12:00:08.000Z',
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    semanticAnalysis: {
      semanticAnalysisId: 'semantic-private-reference',
      status: 'completed',
      pipelineVersion: 'pipeline-v1',
      taxonomyVersion: 'taxonomy-v1',
      confidence: 0.75,
      areasCount: 1,
      skillsCount: 3,
      conceptsCount: 5,
      qualityFlags: ['low_coverage'],
      analyzedAt: '2026-08-05T12:00:08.000Z'
    },
    ...overrides
  };
}

describe('analysis run adapters', () => {
  it('accepts latest null', () => {
    expect(adaptLatestIssuerAnalysisRunResponse(null)).toBeNull();
  });

  it.each(['pending', 'running', 'canceled'] as const)(
    'adapts operational status %s without semantic output',
    (status) => {
      const result = adaptIssuerAnalysisRunResponse(
        runResponse({
          status,
          startedAt: status === 'pending' ? null : '2026-08-05T12:00:01.000Z',
          completedAt: null,
          semanticAnalysis: null
        })
      );

      expect(result.status).toBe(status);
      expect(result.semanticAnalysis).toBeNull();
    }
  );

  it('accepts a partial semantic result with zero counts, null confidence and no flags', () => {
    const result = adaptIssuerAnalysisRunResponse(
      runResponse({
        semanticAnalysis: {
          semanticAnalysisId: 'semantic-private-reference',
          status: 'partial',
          pipelineVersion: 'pipeline-v1',
          taxonomyVersion: 'taxonomy-v1',
          confidence: null,
          areasCount: 0,
          skillsCount: 0,
          conceptsCount: 0,
          qualityFlags: [],
          analyzedAt: '2026-08-05T12:00:08.000Z'
        }
      })
    );

    expect(result.semanticAnalysis).toMatchObject({
      status: 'partial',
      confidence: null,
      confidenceLabel: 'No informada',
      areasCount: 0,
      skillsCount: 0,
      conceptsCount: 0,
      qualityFlags: [],
      qualityFlagLabels: []
    });
  });

  it.each([0, 1])('accepts confidence boundary %d', (confidence) => {
    const result = adaptIssuerAnalysisRunResponse(
      runResponse({
        semanticAnalysis: {
          ...(runResponse().semanticAnalysis as object),
          confidence
        }
      })
    );
    expect(result.semanticAnalysis?.confidence).toBe(confidence);
  });

  it('maps failed runs only with safe failure fields', () => {
    const result = adaptIssuerAnalysisRunResponse(
      runResponse({
        status: 'failed',
        completedAt: null,
        failedAt: '2026-08-05T12:00:08.000Z',
        errorCode: 'analysis_failed',
        errorMessage: 'No se pudo completar el análisis.',
        semanticAnalysis: null
      })
    );
    expect(result.errorMessage).toBe('No se pudo completar el análisis.');
  });

  it.each([
    { status: 'unknown' },
    { sourceCount: 2 },
    { createdAt: 'not-a-date' },
    { semanticAnalysis: { ...(runResponse().semanticAnalysis as object), confidence: 2 } },
    { semanticAnalysis: { ...(runResponse().semanticAnalysis as object), skillsCount: -1 } },
    { semanticAnalysis: { ...(runResponse().semanticAnalysis as object), qualityFlags: ['bad\nflag'] } },
    { status: 'failed', errorCode: null, errorMessage: null }
  ])('rejects an incompatible run payload', (override) => {
    expect(() =>
      adaptIssuerAnalysisRunResponse(runResponse(override))
    ).toThrow(IncompatiblePayloadError);
  });

  it('humanizes known and future quality flags and drops forbidden extras', () => {
    const result = adaptIssuerAnalysisRunResponse({
      ...runResponse(),
      analysisJson: { secret: true },
      textForEmbedding: 'private',
      evidenceMap: { private: true },
      storageKey: 'private',
      semanticAnalysis: {
        ...(runResponse().semanticAnalysis as object),
        qualityFlags: ['low_coverage', 'future_flag']
      }
    });

    expect(result.semanticAnalysis?.qualityFlagLabels).toEqual([
      'Cobertura limitada',
      'El análisis incluye observaciones técnicas que requieren revisión.'
    ]);
    expect(result.semanticAnalysis?.qualityFlagLabels.join(' ')).not.toContain(
      'future_flag'
    );
    expect(JSON.stringify(result)).not.toMatch(
      /analysisJson|textForEmbedding|evidenceMap|storageKey/
    );
  });

  it('adapts a minimal completed trigger and drops extra fields', () => {
    const result = adaptDocumentAnalysisTriggerResponse({
      analysisRunId: 'run-private-reference',
      credentialId: 'credential-private-reference',
      status: 'completed',
      semanticAnalysisId: 'semantic-private-reference',
      artifactStatus: 'partial',
      sourceCount: 1,
      completedAt: '2026-08-05T12:00:08.000Z',
      artifact: { private: true }
    });

    expect(result.artifactStatus).toBe('partial');
    expect(Object.prototype.hasOwnProperty.call(result, 'artifact')).toBe(false);
  });

  it.each([
    { status: 'running' },
    { sourceCount: 0 },
    { artifactStatus: 'unknown' },
    { completedAt: 'invalid' }
  ])('rejects an invalid trigger response', (override) => {
    expect(() =>
      adaptDocumentAnalysisTriggerResponse({
        analysisRunId: 'run-private-reference',
        credentialId: 'credential-private-reference',
        status: 'completed',
        semanticAnalysisId: 'semantic-private-reference',
        artifactStatus: 'completed',
        sourceCount: 1,
        completedAt: '2026-08-05T12:00:08.000Z',
        ...override
      })
    ).toThrow(IncompatiblePayloadError);
  });
});
