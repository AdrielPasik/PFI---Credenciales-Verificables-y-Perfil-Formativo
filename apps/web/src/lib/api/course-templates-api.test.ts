import { describe, expect, it, vi } from 'vitest';

import {
  approveTemplateSemanticAnalysis,
  getTemplateSemanticApprovalCandidate,
  listCourseTemplates,
  saveCourseTemplateFromCredential
} from '@/lib/api/course-templates-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

function courseTemplateResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: null,
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    status: 'active',
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: null,
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides
  };
}

function candidateResponse(overrides: Record<string, unknown> = {}) {
  return {
    semanticAnalysisId: 'analysis-1',
    status: 'completed',
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    sourceCredentialId: 'credential-1',
    summary: {
      schema: 'approved_template_semantic_snapshot_v1',
      status: 'completed',
      areaCount: 2,
      skillCount: 3,
      conceptCount: 1,
      hasHoursDistribution: true,
      warningCount: 0,
      qualityFlagCount: 0
    },
    ...overrides
  };
}

describe('saveCourseTemplateFromCredential', () => {
  it('calls POST /issuers/:issuerId/course-templates/from-credential/:credentialId without a body', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue(courseTemplateResponse());

    await saveCourseTemplateFromCredential(requestAuthenticated, {
      issuerReference: 'issuer selected',
      credentialReference: 'credential-1'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/course-templates/from-credential/credential-1',
      { method: 'POST' }
    );
    // No manda body -- el backend deriva todo de la credencial.
    expect(requestAuthenticated.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('adapts the response into a CourseTemplateSummaryVM', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue(courseTemplateResponse({ credentialType: 'certification' }));

    const result = await saveCourseTemplateFromCredential(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialReference: 'credential-1'
    });

    expect(result.reference).toBe('template-1');
    expect(result.credentialType).toBe('certification');
  });

  it('rejects an incompatible response instead of returning a partial VM', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({});

    await expect(
      saveCourseTemplateFromCredential(requestAuthenticated, {
        issuerReference: 'issuer-1',
        credentialReference: 'credential-1'
      })
    ).rejects.toThrow(IncompatiblePayloadError);
  });

  it('rejects blank issuer or credential references before calling the API', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      saveCourseTemplateFromCredential(requestAuthenticated, {
        issuerReference: '  ',
        credentialReference: 'credential-1'
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it('propagates a 409 duplicate error from the backend untouched', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));

    await expect(
      saveCourseTemplateFromCredential(requestAuthenticated, {
        issuerReference: 'issuer-1',
        credentialReference: 'credential-1'
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('listCourseTemplates', () => {
  it('calls GET /issuers/:issuerId/course-templates with search/status/credentialType', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue([courseTemplateResponse()]);

    await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer selected',
      search: 'python',
      status: 'active',
      credentialType: 'course'
    });

    const [path, options] = requestAuthenticated.mock.calls[0];
    expect(path).toBe(
      '/issuers/issuer%20selected/course-templates?search=python&status=active&credentialType=course'
    );
    expect(options).not.toHaveProperty('body');
  });

  it('omits search/status/credentialType from the query string when not provided', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue([]);

    await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer-1'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-1/course-templates',
      { signal: undefined }
    );
  });

  it('adapts a course template correctly', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue([courseTemplateResponse()]);

    const result = await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialType: 'course'
    });

    expect(result).toHaveLength(1);
    expect(result[0].credentialType).toBe('course');
    expect(result[0].modality).toBe('Online');
  });

  it('adapts a certification template correctly', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue([
      courseTemplateResponse({
        credentialType: 'certification',
        modality: null,
        platformName: null,
        certificationCode: 'AWS-CCP',
        providerName: 'Instituto Demo',
        level: 'Fundamentos',
        skills: ['Cloud']
      })
    ]);

    const result = await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer-1',
      credentialType: 'certification'
    });

    expect(result[0].credentialType).toBe('certification');
    expect(result[0].certificationCode).toBe('AWS-CCP');
    expect(result[0].providerName).toBe('Instituto Demo');
    expect(result[0].skills).toEqual(['Cloud']);
  });

  it('rejects an incompatible response (non-array)', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ items: [] });

    await expect(
      listCourseTemplates(requestAuthenticated, { issuerReference: 'issuer-1' })
    ).rejects.toThrow(IncompatiblePayloadError);
  });

  it('handles an empty response', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue([]);

    const result = await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer-1'
    });

    expect(result).toEqual([]);
  });

  it('never exposes issuerId or createdByUserId even if the backend returned them', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue([
      courseTemplateResponse({
        issuerId: 'must-not-leak',
        createdByUserId: 'must-not-leak'
      })
    ]);

    const result = await listCourseTemplates(requestAuthenticated, {
      issuerReference: 'issuer-1'
    });

    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('rejects a blank issuer reference before calling the API', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      listCourseTemplates(requestAuthenticated, { issuerReference: '  ' })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });
});

describe('getTemplateSemanticApprovalCandidate', () => {
  it('calls GET .../course-templates/:templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId without a body', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(candidateResponse());

    await getTemplateSemanticApprovalCandidate(requestAuthenticated, {
      issuerReference: 'issuer selected',
      templateReference: 'template-1',
      semanticAnalysisReference: 'analysis-1'
    });

    const [path, options] = requestAuthenticated.mock.calls[0];
    expect(path).toBe(
      '/issuers/issuer%20selected/course-templates/template-1/approved-analysis/candidate/from-semantic-analysis/analysis-1'
    );
    expect(options).not.toHaveProperty('body');
    expect(options).not.toHaveProperty('method');
  });

  it('adapts the response into a TemplateSemanticApprovalCandidateVM', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue(candidateResponse({ status: 'partial' }));

    const result = await getTemplateSemanticApprovalCandidate(
      requestAuthenticated,
      {
        issuerReference: 'issuer-1',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      }
    );

    expect(result.semanticAnalysisReference).toBe('analysis-1');
    expect(result.status).toBe('partial');
    expect(result.summary.areaCount).toBe(2);
  });

  it('rejects an incompatible response instead of returning a partial VM', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({});

    await expect(
      getTemplateSemanticApprovalCandidate(requestAuthenticated, {
        issuerReference: 'issuer-1',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toThrow(IncompatiblePayloadError);
  });

  it('rejects blank references before calling the API', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      getTemplateSemanticApprovalCandidate(requestAuthenticated, {
        issuerReference: 'issuer-1',
        templateReference: '  ',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it('propagates a 404/400/403 backend error untouched', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockRejectedValue(new ApiError('not usable', 'http', 400));

    await expect(
      getTemplateSemanticApprovalCandidate(requestAuthenticated, {
        issuerReference: 'issuer-1',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('approveTemplateSemanticAnalysis', () => {
  it('calls POST .../course-templates/:templateId/approved-analysis/from-semantic-analysis/:semanticAnalysisId without a body', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockResolvedValue(courseTemplateResponse({ approvedSemanticAnalysisId: 'analysis-1' }));

    await approveTemplateSemanticAnalysis(requestAuthenticated, {
      issuerReference: 'issuer selected',
      templateReference: 'template-1',
      semanticAnalysisReference: 'analysis-1'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/course-templates/template-1/approved-analysis/from-semantic-analysis/analysis-1',
      { method: 'POST' }
    );
    expect(requestAuthenticated.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('adapts the response into a CourseTemplateSummaryVM with approval fields populated', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue(
      courseTemplateResponse({
        approvedSemanticAnalysisId: 'analysis-1',
        approvedSemanticApprovedAt: '2026-08-12T09:00:00.000Z',
        approvedSemanticSnapshotSummary: {
          schema: 'approved_template_semantic_snapshot_v1',
          status: 'completed',
          areaCount: 1,
          skillCount: 1,
          conceptCount: 0,
          hasHoursDistribution: false,
          warningCount: 0,
          qualityFlagCount: 0
        }
      })
    );

    const result = await approveTemplateSemanticAnalysis(requestAuthenticated, {
      issuerReference: 'issuer-1',
      templateReference: 'template-1',
      semanticAnalysisReference: 'analysis-1'
    });

    expect(result.approvedSemanticAnalysisId).toBe('analysis-1');
    expect(result.approvedSemanticApprovedAt).toBe('2026-08-12T09:00:00.000Z');
    expect(result.approvedSemanticSnapshotSummary?.areaCount).toBe(1);
  });

  it('rejects an incompatible response instead of returning a partial VM', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({});

    await expect(
      approveTemplateSemanticAnalysis(requestAuthenticated, {
        issuerReference: 'issuer-1',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toThrow(IncompatiblePayloadError);
  });

  it('rejects blank references before calling the API', async () => {
    const requestAuthenticated = vi.fn();

    await expect(
      approveTemplateSemanticAnalysis(requestAuthenticated, {
        issuerReference: '  ',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it('propagates a 409/400/404 backend error untouched', async () => {
    const requestAuthenticated = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));

    await expect(
      approveTemplateSemanticAnalysis(requestAuthenticated, {
        issuerReference: 'issuer-1',
        templateReference: 'template-1',
        semanticAnalysisReference: 'analysis-1'
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});
