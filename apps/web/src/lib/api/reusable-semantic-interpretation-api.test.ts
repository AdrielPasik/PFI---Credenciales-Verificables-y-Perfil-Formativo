import { describe, expect, it, vi } from 'vitest';

import {
  applyReusableSemanticInterpretation,
  getReusableSemanticInterpretation,
  getReusableSemanticInterpretationCandidate
} from '@/lib/api/reusable-semantic-interpretation-api';
import { ApiError } from '@/lib/errors/api-error';

function snapshotSummaryResponse() {
  return {
    schema: 'approved_template_semantic_snapshot_v2',
    status: 'completed',
    areaCount: 0,
    skillCount: 0,
    conceptCount: 0,
    hasHoursDistribution: false,
    warningCount: 0,
    qualityFlagCount: 0
  };
}

function appliedSummaryResponse(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary: snapshotSummaryResponse(),
    appliedAt: '2026-08-14T11:00:00.000Z',
    appliedByDisplayLabel: 'Ana Aprobadora',
    approvalDriftStatus: 'up_to_date',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    ...overrides
  };
}

function candidateResponse(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary: snapshotSummaryResponse(),
    approvedAt: '2026-08-14T10:00:00.000Z',
    approvedByDisplayLabel: 'Ana Aprobadora',
    approvalRevision: '2026-08-14T10:00:00.000Z',
    approvalDriftStatus: 'none_applied',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    currentApplication: null,
    ...overrides
  };
}

describe('getReusableSemanticInterpretation', () => {
  it('calls GET .../reusable-semantic-interpretation and adapts a null body as null', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(null);

    const result = await getReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer selected',
      credentialReference: 'credential-1'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/credentials/credential-1/reusable-semantic-interpretation',
      { signal: undefined }
    );
    expect(result).toBeNull();
  });

  it('adapts an existing applied summary', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue(appliedSummaryResponse());

    const result = await getReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1'
    });

    expect(result?.templateReference).toBe('template-1');
  });

  it('rejects an empty issuer/credential reference before calling the transport', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      getReusableSemanticInterpretation(requestAuthenticated, {
        issuerReference: '  ',
        credentialReference: 'credential-1'
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });
});

describe('getReusableSemanticInterpretationCandidate', () => {
  it('calls GET .../candidate?templateId=... with the template reference URL-encoded', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(candidateResponse());

    await getReusableSemanticInterpretationCandidate(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1',
      templateReference: 'template with spaces'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-1/credentials/credential-1/reusable-semantic-interpretation/candidate?templateId=template+with+spaces',
      { signal: undefined }
    );
  });

  it('adapts the candidate response, including a null currentApplication', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(candidateResponse());

    const result = await getReusableSemanticInterpretationCandidate(
      requestAuthenticated,
      {
        issuerReference: 'issuer-1',
        credentialReference: 'credential-1',
        templateReference: 'template-1'
      }
    );

    expect(result.templateReference).toBe('template-1');
    expect(result.currentApplication).toBeNull();
  });

  it('rejects an empty template reference before calling the transport', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      getReusableSemanticInterpretationCandidate(requestAuthenticated, {
        issuerReference: 'issuer-1',
        credentialReference: 'credential-1',
        templateReference: '  '
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });
});

describe('applyReusableSemanticInterpretation', () => {
  it('POSTs exactly templateId/approvalRevision, never acknowledgeDestinationDrift when compatible', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedSummaryResponse()
    });

    await applyReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1',
      templateReference: 'template-1',
      approvalRevision: '2026-08-14T10:00:00.000Z'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-1/credentials/credential-1/reusable-semantic-interpretation/apply',
      {
        method: 'POST',
        body: {
          templateId: 'template-1',
          approvalRevision: '2026-08-14T10:00:00.000Z'
        }
      }
    );
  });

  it('includes acknowledgeDestinationDrift: true only when explicitly set', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedSummaryResponse()
    });

    await applyReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1',
      templateReference: 'template-1',
      approvalRevision: '2026-08-14T10:00:00.000Z',
      acknowledgeDestinationDrift: true
    });

    expect(requestAuthenticated.mock.calls[0][1]).toMatchObject({
      body: {
        templateId: 'template-1',
        approvalRevision: '2026-08-14T10:00:00.000Z',
        acknowledgeDestinationDrift: true
      }
    });
  });

  it('never sends approvedSnapshot/source*/destinationCompatibility -- always recomputed server-side', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedSummaryResponse()
    });

    await applyReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1',
      templateReference: 'template-1',
      approvalRevision: '2026-08-14T10:00:00.000Z'
    });

    const body = requestAuthenticated.mock.calls[0][1].body;
    expect(Object.keys(body).sort()).toEqual(['approvalRevision', 'templateId']);
  });

  it('adapts the apply result', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({
      changed: false,
      supersededPreviousApplication: false,
      application: appliedSummaryResponse()
    });

    const result = await applyReusableSemanticInterpretation(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1',
      templateReference: 'template-1',
      approvalRevision: '2026-08-14T10:00:00.000Z'
    });

    expect(result.changed).toBe(false);
    expect(result.application.templateReference).toBe('template-1');
  });

  it('rejects an empty approvalRevision before calling the transport', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      applyReusableSemanticInterpretation(requestAuthenticated, {
        issuerReference: 'issuer-1',
        credentialReference: 'credential-1',
        templateReference: 'template-1',
        approvalRevision: '  '
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });
});
