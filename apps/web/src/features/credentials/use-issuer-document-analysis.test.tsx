import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useIssuerDocumentAnalysis } from '@/features/credentials/use-issuer-document-analysis';
import { ApiError } from '@/lib/errors/api-error';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function runResponse(status = 'completed') {
  return {
    analysisRunId: 'new-run-private-reference',
    credentialId: 'credential-reference',
    status,
    inputMode: 'document',
    trigger: 'manual',
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    sourceCount: 1,
    sourceTypes: ['document_evidence'],
    createdAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    completedAt: status === 'completed' ? '2026-08-05T12:00:08.000Z' : null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    semanticAnalysis:
      status === 'completed'
        ? {
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
        : null
  };
}

const triggerResponse = {
  analysisRunId: 'new-run-private-reference',
  credentialId: 'credential-reference',
  status: 'completed',
  semanticAnalysisId: 'semantic-private-reference',
  artifactStatus: 'partial',
  sourceCount: 1,
  completedAt: '2026-08-05T12:00:08.000Z'
};

describe('useIssuerDocumentAnalysis', () => {
  it('loads latest independently', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useIssuerDocumentAnalysis({
        requestAuthenticated,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    );

    await waitFor(() => expect(result.current.state.latestStatus).toBe('ready'));
    expect(result.current.state.currentRun).toBeNull();
    expect(requestAuthenticated).toHaveBeenCalledOnce();
  });

  it('posts once, then reads the exact run by id', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(triggerResponse)
      .mockResolvedValueOnce(runResponse());
    const { result } = renderHook(() =>
      useIssuerDocumentAnalysis({
        requestAuthenticated,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    );
    await waitFor(() => expect(result.current.state.latestStatus).toBe('ready'));

    await act(async () => {
      await Promise.all([result.current.trigger(), result.current.trigger()]);
    });

    expect(requestAuthenticated).toHaveBeenCalledTimes(3);
    expect(requestAuthenticated.mock.calls[1]).toEqual([
      '/issuers/issuer-reference/credentials/credential-reference/analysis-runs/document',
      { method: 'POST' }
    ]);
    expect(requestAuthenticated.mock.calls[2][0]).toBe(
      '/issuers/issuer-reference/credentials/credential-reference/analysis-runs/new-run-private-reference'
    );
    expect(result.current.state.currentRun?.status).toBe('completed');
  });

  it('does not let a slow initial latest overwrite the exact post-trigger run', async () => {
    const slowLatest = deferred<null>();
    const requestAuthenticated = vi
      .fn()
      .mockReturnValueOnce(slowLatest.promise)
      .mockResolvedValueOnce(triggerResponse)
      .mockResolvedValueOnce(runResponse());
    const { result } = renderHook(() =>
      useIssuerDocumentAnalysis({
        requestAuthenticated,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    );

    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.state.currentRun?.analysisRunReference).toBe(
      'new-run-private-reference'
    );

    await act(async () => slowLatest.resolve(null));
    expect(result.current.state.currentRun?.analysisRunReference).toBe(
      'new-run-private-reference'
    );
  });

  it('preserves the visible run when refresh fails', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValueOnce(runResponse())
      .mockRejectedValueOnce(new ApiError('private', 'network'));
    const { result } = renderHook(() =>
      useIssuerDocumentAnalysis({
        requestAuthenticated,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    );
    await waitFor(() => expect(result.current.state.currentRun).not.toBeNull());

    await act(async () => result.current.refresh());

    expect(result.current.state.currentRun?.status).toBe('completed');
    expect(result.current.state.latestError).toContain(
      'No pudimos conectarnos'
    );
  });

  it('invalidates an old credential request when references change', async () => {
    const oldRequest = deferred<null>();
    const requestAuthenticated = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({
        ...runResponse('running'),
        credentialId: 'new-credential'
      });
    const { result, rerender } = renderHook(
      ({ credentialReference }) =>
        useIssuerDocumentAnalysis({
          requestAuthenticated,
          issuerReference: 'issuer-reference',
          credentialReference
        }),
      { initialProps: { credentialReference: 'old-credential' } }
    );

    rerender({ credentialReference: 'new-credential' });
    await waitFor(() => expect(result.current.state.currentRun?.status).toBe('running'));
    await act(async () => oldRequest.resolve(null));
    expect(result.current.state.currentRun?.status).toBe('running');
  });
});
