import { describe, expect, it, vi } from 'vitest';

import {
  createAcademicSubjectCurricularDraftRequest,
  createCredentialDraftRequest,
  createManualCredentialDraftRequest,
  getIssuerCredentialRequest,
  patchIssuerCredentialDraftRequest,
  resolveHolderRequest,
  searchAcademicProgramsRequest,
  searchCurriculumAcademicSubjectsRequest,
  submitCredentialTextEvidenceRequest,
  uploadCredentialDocumentEvidenceRequest
} from '@/lib/api/credentials-api';
import { ApiError } from '@/lib/errors/api-error';
import type {
  CreateAcademicSubjectCurricularDraftCommand,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

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

  it('creates a curricular academic subject with an exact closed body', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await createAcademicSubjectCurricularDraftRequest(
      requestAuthenticated,
      {
        issuerReference: 'issuer-reference',
        holderReference: 'holder-reference',
        credentialType: 'academic_subject',
        academicCourseReference: '  course-reference  ',
        curriculumReference: '  curriculum-reference  '
      }
    );

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/credentials/draft',
      {
        method: 'POST',
        body: {
          issuerId: 'issuer-reference',
          subjectUserId: 'holder-reference',
          type: 'academic_subject',
          sourceType: 'manual_issuer',
          academicCourseReference: 'course-reference',
          curriculumReference: 'curriculum-reference'
        }
      }
    );
    expect(Object.keys(requestAuthenticated.mock.calls[0][1].body)).toEqual(
      [
        'issuerId',
        'subjectUserId',
        'type',
        'sourceType',
        'academicCourseReference',
        'curriculumReference'
      ]
    );
  });

  it('drops accidental manual and internal fields from curricular create', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });
    const command = {
      issuerReference: 'issuer-reference',
      holderReference: 'holder-reference',
      credentialType: 'academic_subject',
      academicCourseReference: 'course-reference',
      curriculumReference: 'curriculum-reference',
      title: 'must-not-leak',
      description: 'must-not-leak',
      hours: '99',
      achievementName: 'must-not-leak',
      institutionName: 'must-not-leak',
      programName: 'must-not-leak',
      credentialSubject: { mustNotLeak: true },
      metadata: {},
      rawData: {},
      externalCourseId: 'must-not-leak',
      academicCourseId: 'must-not-leak',
      programCourseId: 'must-not-leak',
      curriculumVersionId: 'must-not-leak'
    } as CreateAcademicSubjectCurricularDraftCommand &
      Record<string, unknown>;

    await createAcademicSubjectCurricularDraftRequest(
      requestAuthenticated,
      command
    );

    expect(requestAuthenticated.mock.calls[0][1].body).toEqual({
      issuerId: 'issuer-reference',
      subjectUserId: 'holder-reference',
      type: 'academic_subject',
      sourceType: 'manual_issuer',
      academicCourseReference: 'course-reference',
      curriculumReference: 'curriculum-reference'
    });
  });

  it.each([
    {
      academicCourseReference: 'course-reference',
      curriculumReference: undefined
    },
    {
      academicCourseReference: undefined,
      curriculumReference: 'curriculum-reference'
    },
    { academicCourseReference: '', curriculumReference: 'curriculum' },
    { academicCourseReference: 'course', curriculumReference: '   ' }
  ])(
    'rejects incomplete or empty curricular create references',
    (references) => {
      const requestAuthenticated = vi.fn();

      expect(() =>
        createAcademicSubjectCurricularDraftRequest(
          requestAuthenticated,
          {
            issuerReference: 'issuer-reference',
            holderReference: 'holder-reference',
            credentialType: 'academic_subject',
            ...references
          } as CreateAcademicSubjectCurricularDraftCommand
        )
      ).toThrow(ApiError);
      expect(requestAuthenticated).not.toHaveBeenCalled();
    }
  );

  it('submits normalized text evidence through an encoded JSON endpoint', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await submitCredentialTextEvidenceRequest(requestAuthenticated, {
      issuerReference: ' issuer/reference ',
      credentialReference: ' credential/reference ',
      label: '  Temario\u00A0 institucional  ',
      content: '  Línea uno\r\nLínea dos  '
    });

    expect(requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer%2Freference/credentials/credential%2Freference/evidence/texts',
      {
        method: 'POST',
        body: {
          content: 'Línea uno\nLínea dos',
          label: 'Temario institucional'
        }
      }
    );
  });

  it('maps an empty label to null and drops accidental properties', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

    await submitCredentialTextEvidenceRequest(requestAuthenticated, {
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      label: '   ',
      content: 'Texto válido',
      description: 'must-not-leak',
      skills: ['must-not-leak'],
      sha256: 'must-not-leak',
      documentEvidence: { mustNotLeak: true }
    } as never);

    expect(requestAuthenticated.mock.calls[0][1].body).toEqual({
      content: 'Texto válido',
      label: null
    });
    expect(Object.keys(requestAuthenticated.mock.calls[0][1].body)).toEqual([
      'content',
      'label'
    ]);
  });

  it.each([
    ['', 'credential-reference', 'Texto'],
    ['issuer-reference', '   ', 'Texto'],
    ['issuer-reference', 'credential-reference', '   '],
    ['issuer-reference', 'credential-reference', `Texto\u0000`],
    ['issuer-reference', 'credential-reference', 'a'.repeat(50_001)]
  ])(
    'rejects invalid text evidence without executing a request',
    (issuerReference, credentialReference, content) => {
      const requestAuthenticated = vi.fn();

      expect(() =>
        submitCredentialTextEvidenceRequest(requestAuthenticated, {
          issuerReference,
          credentialReference,
          label: null,
          content
        })
      ).toThrow(ApiError);
      expect(requestAuthenticated).not.toHaveBeenCalled();
    }
  );

  it('rejects a non-academic type at the curricular API boundary', () => {
    const requestAuthenticated = vi.fn();

    expect(() =>
      createAcademicSubjectCurricularDraftRequest(
        requestAuthenticated,
        {
          issuerReference: 'issuer-reference',
          holderReference: 'holder-reference',
          credentialType: 'course',
          academicCourseReference: 'course-reference',
          curriculumReference: 'curriculum-reference'
        } as unknown as CreateAcademicSubjectCurricularDraftCommand
      )
    ).toThrow(ApiError);
    expect(requestAuthenticated).not.toHaveBeenCalled();
  });

  it.each(['course', 'certification', 'degree'] as const)(
    'preserves the manual create body for %s',
    async (credentialType) => {
      const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });

      await createManualCredentialDraftRequest(requestAuthenticated, {
        issuerReference: 'issuer-reference',
        holderReference: 'holder-reference',
        credentialType,
        achievementName: 'Logro institucional',
        institutionName: 'Universidad Contextual'
      });

      expect(requestAuthenticated).toHaveBeenCalledWith(
        '/credentials/draft',
        {
          method: 'POST',
          body: {
            issuerId: 'issuer-reference',
            subjectUserId: 'holder-reference',
            type: credentialType,
            title: 'Logro institucional',
            sourceType: 'manual_issuer',
            credentialSubject: {
              achievement_name: 'Logro institucional',
              institution_name: 'Universidad Contextual'
            }
          }
        }
      );
    }
  );

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

  it('uploads exactly one file through an encoded multipart endpoint', async () => {
    const requestAuthenticated = vi.fn().mockResolvedValue({ ok: true });
    const evidence = new File(['document'], 'programa.pdf', {
      type: 'application/pdf'
    });

    await uploadCredentialDocumentEvidenceRequest(
      requestAuthenticated,
      {
        issuerReference: ' issuer/reference ',
        credentialReference: ' credential/reference ',
        file: evidence
      }
    );

    expect(requestAuthenticated).toHaveBeenCalledOnce();
    const [path, options] = requestAuthenticated.mock.calls[0];
    expect(path).toBe(
      '/issuers/issuer%2Freference/credentials/credential%2Freference/evidence/documents'
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    expect(Array.from((options.body as FormData).entries())).toEqual([
      ['file', evidence]
    ]);
  });

  it.each([
    ['', 'credential-reference', new File(['x'], 'ok.pdf')],
    ['issuer-reference', '   ', new File(['x'], 'ok.pdf')],
    ['issuer-reference', 'credential-reference', 'not-a-file']
  ])(
    'rejects invalid document upload inputs without a request',
    (issuerReference, credentialReference, file) => {
      const requestAuthenticated = vi.fn();

      expect(() =>
        uploadCredentialDocumentEvidenceRequest(requestAuthenticated, {
          issuerReference,
          credentialReference,
          file: file as File
        })
      ).toThrow(ApiError);
      expect(requestAuthenticated).not.toHaveBeenCalled();
    }
  );

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
