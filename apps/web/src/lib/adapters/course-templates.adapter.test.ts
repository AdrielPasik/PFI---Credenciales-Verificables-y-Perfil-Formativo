import { describe, expect, it } from 'vitest';

import { adaptCourseTemplateSummary } from '@/lib/adapters/course-templates.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function courseTemplatePayload(overrides?: Record<string, unknown>) {
  return {
    id: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: 'Introducción a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: ['Programación'],
    learningOutcomes: ['Escribir scripts básicos'],
    status: 'active',
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:05:00.000Z',
    ...overrides
  };
}

describe('adaptCourseTemplateSummary', () => {
  it('adapts a course template response', () => {
    const result = adaptCourseTemplateSummary(courseTemplatePayload());

    expect(result).toEqual({
      reference: 'template-1',
      credentialType: 'course',
      title: 'Curso de Python',
      description: 'Introducción a Python',
      hours: '22.00',
      modality: 'Online',
      platformName: 'Plataforma de Cursos Demo',
      externalUrl: 'https://plataforma-demo.example.com/curso/python',
      certificationCode: null,
      expirationDate: null,
      providerName: null,
      level: null,
      skills: [],
      competencies: ['Programación'],
      learningOutcomes: ['Escribir scripts básicos'],
      status: 'active',
      createdFromCredentialId: 'credential-1',
      lastSemanticAnalysisId: 'analysis-1',
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-11T10:05:00.000Z'
    });
  });

  it('adapts a certification template response with its own fields', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        credentialType: 'certification',
        title: 'Certificación AWS Cloud Practitioner',
        modality: null,
        platformName: null,
        certificationCode: 'AWS-CCP',
        expirationDate: '2027-01-01',
        providerName: 'Instituto Demo',
        level: 'Fundamentos',
        skills: ['Cloud'],
        learningOutcomes: []
      })
    );

    expect(result.credentialType).toBe('certification');
    expect(result.certificationCode).toBe('AWS-CCP');
    expect(result.expirationDate).toBe('2027-01-01');
    expect(result.providerName).toBe('Instituto Demo');
    expect(result.level).toBe('Fundamentos');
    expect(result.skills).toEqual(['Cloud']);
  });

  it('tolerates optional nulls', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        description: null,
        hours: null,
        modality: null,
        platformName: null,
        externalUrl: null,
        createdFromCredentialId: null,
        lastSemanticAnalysisId: null
      })
    );

    expect(result.description).toBeNull();
    expect(result.hours).toBeNull();
    expect(result.modality).toBeNull();
    expect(result.platformName).toBeNull();
    expect(result.externalUrl).toBeNull();
    expect(result.createdFromCredentialId).toBeNull();
    expect(result.lastSemanticAnalysisId).toBeNull();
  });

  it('never exposes issuerId or createdByUserId even if present in the payload', () => {
    const result = adaptCourseTemplateSummary(
      courseTemplatePayload({
        issuerId: 'must-not-leak',
        createdByUserId: 'must-not-leak'
      })
    );

    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('rejects an incompatible payload', () => {
    expect(() => adaptCourseTemplateSummary(null)).toThrow(
      IncompatiblePayloadError
    );
    expect(() => adaptCourseTemplateSummary({})).toThrow(
      IncompatiblePayloadError
    );
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({ credentialType: 'academic_subject' })
      )
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(courseTemplatePayload({ status: 'deleted' }))
    ).toThrow(IncompatiblePayloadError);
    expect(() =>
      adaptCourseTemplateSummary(
        courseTemplatePayload({ competencies: 'not-an-array' })
      )
    ).toThrow(IncompatiblePayloadError);
  });
});
