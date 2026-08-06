import { describe, expect, it, vi } from 'vitest';

import {
  getIssuerAnalysisRunByIdRequest,
  getLatestIssuerAnalysisRunRequest,
  triggerIssuerDocumentAnalysisRequest
} from '@/lib/api/analysis-runs-api';
import { ApiError } from '@/lib/errors/api-error';

const runResponse = {
  analysisRunId: 'run-reference',
  credentialId: 'credential-reference',
  status: 'pending',
  inputMode: 'document',
  trigger: 'manual',
  requestedPipelineVersion: 'pipeline-v1',
  requestedTaxonomyVersion: 'taxonomy-v1',
  sourceCount: 1,
  sourceTypes: ['document_evidence'],
  createdAt: '2026-08-05T12:00:00.000Z',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  semanticAnalysis: null
};

describe('analysis runs API', () => {
  it('gets encoded latest without body and adapts null', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(null);
    const result = await getLatestIssuerAnalysisRunRequest(
      requestAuthenticated,
      {
        issuerReference: 'issuer selected',
        credentialReference: 'credential/selected'
      }
    );

    expect(result).toBeNull();
    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/credentials/credential%2Fselected/analysis-runs/latest'
    );
  });

  it('gets an exact encoded run without body', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      ...runResponse,
      analysisRunId: 'run/selected',
      credentialId: 'credential selected'
    });
    const result = await getIssuerAnalysisRunByIdRequest(
      requestAuthenticated,
      {
        issuerReference: 'issuer selected',
        credentialReference: 'credential selected',
        analysisRunReference: 'run/selected'
      }
    );

    expect(result.status).toBe('pending');
    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/credentials/credential%20selected/analysis-runs/run%2Fselected'
    );
  });

  it('posts a bodyless trigger and adapts only the safe result', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      analysisRunId: 'run-reference',
      credentialId: 'credential-reference',
      status: 'completed',
      semanticAnalysisId: 'semantic-reference',
      artifactStatus: 'partial',
      sourceCount: 1,
      completedAt: '2026-08-05T12:00:08.000Z'
    });

    const result = await triggerIssuerDocumentAnalysisRequest(
      requestAuthenticated,
      {
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      }
    );

    expect(result.artifactStatus).toBe('partial');
    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-reference/credentials/credential-reference/analysis-runs/document',
      { method: 'POST' }
    );
    const options = requestAuthenticated.mock.calls[0][1];
    expect(options.body).toBeUndefined();
    expect(JSON.stringify(options)).not.toMatch(
      /issuerId|credentialId|inputMode|trigger|pipelineVersion|requestedByUserId/
    );
  });

  it.each([
    { issuerReference: '', credentialReference: 'credential' },
    { issuerReference: 'issuer', credentialReference: '  ' }
  ])('rejects empty references before a request', async (references) => {
    const requestAuthenticated = vi.fn();
    await expect(
      getLatestIssuerAnalysisRunRequest(requestAuthenticated, references)
    ).rejects.toBeInstanceOf(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it('rejects a response associated with another credential', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(runResponse);
    await expect(
      getLatestIssuerAnalysisRunRequest(requestAuthenticated, {
        issuerReference: 'issuer-reference',
        credentialReference: 'another-credential'
      })
    ).rejects.toThrow('no corresponde al recurso solicitado');
  });
});
