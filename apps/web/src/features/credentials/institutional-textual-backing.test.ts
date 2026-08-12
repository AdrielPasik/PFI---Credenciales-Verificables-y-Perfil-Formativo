import { describe, expect, it } from 'vitest';

import { hasInstitutionalTextualBacking } from '@/features/credentials/institutional-textual-backing';

function subject(overrides: Partial<{
  competencies: string[];
  learningOutcomes: string[];
  skills: string[];
}> = {}) {
  return {
    competencies: [],
    learningOutcomes: [],
    skills: [],
    ...overrides
  };
}

describe('hasInstitutionalTextualBacking', () => {
  it('rejects academic_subject and degree regardless of declared data', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'academic_subject',
        description: 'Una descripción larga y sustanciosa para la materia.',
        credentialSubject: subject({ competencies: ['Algo'] })
      })
    ).toBe(false);
    expect(
      hasInstitutionalTextualBacking({
        type: 'degree',
        description: 'Una descripción larga y sustanciosa para el título.',
        credentialSubject: subject({ competencies: ['Algo'] })
      })
    ).toBe(false);
  });

  it('rejects a course with only a title/no substantive data', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: null,
        credentialSubject: subject()
      })
    ).toBe(false);
  });

  it('rejects an empty or very short description alone', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: '   ',
        credentialSubject: subject()
      })
    ).toBe(false);
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: 'Curso corto',
        credentialSubject: subject()
      })
    ).toBe(false);
  });

  it('rejects empty-string entries inside competencies/learningOutcomes/skills', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: null,
        credentialSubject: subject({
          competencies: ['   '],
          learningOutcomes: [''],
          skills: ['  ']
        })
      })
    ).toBe(false);
  });

  it('accepts a course with a substantive description', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description:
          'Introducción a Python orientada a análisis de datos y automatización.',
        credentialSubject: subject()
      })
    ).toBe(true);
  });

  it('accepts a course with at least one real competency', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: null,
        credentialSubject: subject({ competencies: ['Programación en Python'] })
      })
    ).toBe(true);
  });

  it('accepts a course with at least one real "contenido adicional" (learningOutcomes) entry', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'course',
        description: null,
        credentialSubject: subject({
          learningOutcomes: ['Manejo de pandas y numpy']
        })
      })
    ).toBe(true);
  });

  it('accepts a certification with skills/competencies/description suficientes', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'certification',
        description: null,
        credentialSubject: subject({ skills: ['Cloud'] })
      })
    ).toBe(true);
    expect(
      hasInstitutionalTextualBacking({
        type: 'certification',
        description: null,
        credentialSubject: subject({ competencies: ['Fundamentos de nube'] })
      })
    ).toBe(true);
    expect(
      hasInstitutionalTextualBacking({
        type: 'certification',
        description:
          'Certificación de fundamentos de nube orientada a arquitectura básica.',
        credentialSubject: subject()
      })
    ).toBe(true);
  });

  it('rejects a certification with only a title/no substantive data', () => {
    expect(
      hasInstitutionalTextualBacking({
        type: 'certification',
        description: null,
        credentialSubject: subject()
      })
    ).toBe(false);
  });
});
