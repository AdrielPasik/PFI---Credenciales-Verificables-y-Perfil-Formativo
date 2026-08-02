import { describe, expect, it, vi } from 'vitest';

import {
  createCredentialDraftRequest,
  getIssuerCredentialRequest,
  patchIssuerCredentialDraftRequest,
  resolveHolderRequest,
  searchAcademicProgramsRequest,
  searchCurriculumAcademicSubjectsRequest
} from '@/lib/api/credentials-api';
import { ApiError } from '@/lib/errors/api-error';
import type { UpdateIssuerCredentialDraftCommand } from '@/models/credentials';

describe('credentials API', () => {
  it('resolves a holder by exact email within the selected issuer path', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await resolveHolderRequest(requestAuthenticated, {
      issuerReference: 'issuer selected',
      email: 'holder@example.com'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected/holders/resolve',
      {
        method: 'POST',
        body: { email: 'holder@example.com' }
      }
    );
  });

  it('builds the draft command only from internal references and known fields', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await createCredentialDraftRequest(requestAuthenticated, {
      issuerReference: 'issuer-internal-reference',
      holderReference: 'holder-internal-reference',
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Contextual',
      credentialType: 'course'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/draft',
      {
        method: 'POST',
        body: {
          issuerId: 'issuer-internal-reference',
          subjectUserId: 'holder-internal-reference',
          type: 'course',
          title: 'Arquitectura de Software',
          sourceType: 'manual_issuer',
          credentialSubject: {
            achievement_name: 'Arquitectura de Software',
            institution_name: 'Universidad Contextual'
          }
        }
      }
    );
  });

  it('sends certification without replacing it with a hardcoded type', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await createCredentialDraftRequest(requestAuthenticated, {
      issuerReference: 'issuer-internal-reference',
      holderReference: 'holder-internal-reference',
      achievementName: 'Certificación Profesional',
      institutionName: 'Universidad Contextual',
      credentialType: 'certification'
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/draft',
      expect.objectContaining({
        body: expect.objectContaining({
          type: 'certification'
        })
      })
    );
  });

  it('loads detail by encoded resource reference using the authenticated boundary', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await getIssuerCredentialRequest(
      requestAuthenticated,
      'issuer selected reference',
      'credential internal reference'
    );

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%20reference/credentials/credential%20internal%20reference'
    );
    expect(requestAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('searches programs with encoded issuer, query and limit', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ items: [] });
    const signal = new AbortController().signal;

    await searchAcademicProgramsRequest(requestAuthenticated, {
      issuerReference: 'issuer selected/reference',
      query: ' Informática 1621 ',
      limit: 20,
      signal
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%2Freference/catalog/academic-programs?query=Inform%C3%A1tica+1621&limit=20',
      { signal }
    );
  });

  it('searches subjects only inside the encoded curriculum path', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ items: [] });
    const signal = new AbortController().signal;

    await searchCurriculumAcademicSubjectsRequest(
      requestAuthenticated,
      {
        issuerReference: 'issuer/reference',
        curriculumReference: 'curriculum/reference',
        query: ' Datos II ',
        limit: 12,
        signal
      }
    );

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%2Freference/catalog/curriculum-versions/curriculum%2Freference/academic-subjects?query=Datos+II&limit=12',
      { signal }
    );
  });

  it('sends the valid curricular selection with its editable achievement fields', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });
    const command: UpdateIssuerCredentialDraftCommand = {
      issuerReference: 'issuer selected reference',
      credentialReference: 'credential internal reference',
      expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
      academicCourseReference: ' course-reference ',
      curriculumReference: ' curriculum-reference ',
      completionDate: '2026-07-30',
      academicPeriod: '2026-1',
      grade: '9',
      skills: ['Modelado'],
      competencies: ['Análisis']
    };

    await patchIssuerCredentialDraftRequest(requestAuthenticated, command);

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%20reference/credentials/credential%20internal%20reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          academicCourseReference: 'course-reference',
          curriculumReference: 'curriculum-reference',
          completionDate: '2026-07-30',
          academicPeriod: '2026-1',
          grade: '9',
          skills: ['Modelado'],
          competencies: ['Análisis']
        }
      }
    );
  });

  it('omits fields derived from a curricular selection even if a caller adds them', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await patchIssuerCredentialDraftRequest(requestAuthenticated, {
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
      academicCourseReference: 'course-reference',
      curriculumReference: 'curriculum-reference',
      achievementName: 'Ambiguous achievement',
      description: 'Ambiguous description',
      hours: '99',
      programName: 'Ambiguous program',
      completionDate: null
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-reference/credentials/credential-reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          academicCourseReference: 'course-reference',
          curriculumReference: 'curriculum-reference',
          completionDate: null
        }
      }
    );
    const body = requestAuthenticated.mock.calls[0]?.[1]?.body;
    expect(body).not.toHaveProperty('achievementName');
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('hours');
    expect(body).not.toHaveProperty('programName');
  });

  it('rejects an academic course reference without a curriculum reference', () => {
    const requestAuthenticated = vi.fn();

    expect(() =>
      patchIssuerCredentialDraftRequest(requestAuthenticated, {
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference',
        expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
        academicCourseReference: 'course-reference'
      })
    ).toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it('rejects a curriculum reference without an academic course reference', () => {
    const requestAuthenticated = vi.fn();

    expect(() =>
      patchIssuerCredentialDraftRequest(requestAuthenticated, {
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference',
        expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
        curriculumReference: 'curriculum-reference'
      })
    ).toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'curriculum-reference'],
    ['course-reference', '   '],
    ['  ', '  ']
  ])(
    'rejects empty curricular references without executing a request',
    (academicCourseReference, curriculumReference) => {
      const requestAuthenticated = vi.fn();

      expect(() =>
        patchIssuerCredentialDraftRequest(requestAuthenticated, {
          issuerReference: 'issuer-reference',
          credentialReference: 'credential-reference',
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          academicCourseReference,
          curriculumReference
        })
      ).toThrow(ApiError);
      expect(requestAuthenticated).not.toHaveBeenCalled();
    }
  );

  it('keeps the existing allowlisted body for a manual patch', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });
    const command: UpdateIssuerCredentialDraftCommand & {
      credentialSubject: { forbidden: boolean };
    } = {
      issuerReference: 'issuer selected reference',
      credentialReference: 'credential internal reference',
      expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
      achievementName: 'Arquitectura Aplicada',
      description: 'Diseño manual',
      hours: '48',
      programName: 'Programa manual',
      providerName: 'Instituto Demo',
      skills: [],
      credentialSubject: { forbidden: true }
    };

    await patchIssuerCredentialDraftRequest(requestAuthenticated, command);

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%20selected%20reference/credentials/credential%20internal%20reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          achievementName: 'Arquitectura Aplicada',
          description: 'Diseño manual',
          hours: '48',
          programName: 'Programa manual',
          providerName: 'Instituto Demo',
          skills: []
        }
      }
    );
    const body = requestAuthenticated.mock.calls[0]?.[1]?.body;
    expect(body).not.toHaveProperty('issuerReference');
    expect(body).not.toHaveProperty('credentialReference');
    expect(body).not.toHaveProperty('issuerId');
    expect(body).not.toHaveProperty('subjectUserId');
    expect(body).not.toHaveProperty('credentialSubject');
    expect(body).not.toHaveProperty('academicCourseId');
    expect(body).not.toHaveProperty('programId');
    expect(body).not.toHaveProperty('academicCourse');
  });
});
