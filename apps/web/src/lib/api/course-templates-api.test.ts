import { describe, expect, it, vi } from 'vitest';

import { saveCourseTemplateFromCredential } from '@/lib/api/course-templates-api';
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
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
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
