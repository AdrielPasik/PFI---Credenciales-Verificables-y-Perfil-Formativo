import { describe, expect, it } from 'vitest';

import {
  applyCredentialTypeChange,
  buildAcademicPeriodInput,
  buildDraftUpdateCommand,
  credentialDraftFieldsByType,
  detailToDraftEditorState,
  getIncompatiblePopulatedFields,
  linesToStringArray,
  parseAcademicPeriodInput,
  sanitizeAcademicGradeInput,
  sanitizeAcademicYearInput,
  validateDraftEditorState
} from '@/features/credentials/credential-draft-editor';
import type { IssuerCredentialDetailVM } from '@/models/credentials';

function detailFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-reference',
    title: 'Arquitectura de Software',
    description: 'Descripción vigente',
    hours: '24.00',
    type: 'course',
    typeLabel: 'Curso',
    status: 'draft',
    statusLabel: 'Borrador',
    issuedAt: null,
    issuedAtLabel: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    issuer: {
      displayName: 'Universidad Demo',
      did: null
    },
    credentialSubject: {
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Demo',
      completionDate: '2026-07-20',
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: 'Instituto Demo',
      platformName: 'Campus Virtual',
      modality: 'Híbrida',
      level: 'Intermedio',
      certificationCode: null,
      expirationDate: null,
      externalUrl: null,
      skills: ['Arquitectura', 'Testing'],
      competencies: ['Diseño'],
      learningOutcomes: ['Documentar decisiones']
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: null
    },
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T13:00:00.000Z',
    ...overrides
  };
}

describe('credential draft editor helpers', () => {
  it('keeps one exact field matrix for every supported type', () => {
    expect(credentialDraftFieldsByType).toEqual({
      academic_subject: [
        'completionDate',
        'academicPeriod',
        'grade',
        'skills',
        'competencies'
      ],
      course: [
        'completionDate',
        'providerName',
        'platformName',
        'modality',
        'level',
        'skills',
        'competencies',
        'learningOutcomes'
      ],
      certification: [
        'completionDate',
        'certificationCode',
        'expirationDate',
        'externalUrl',
        'providerName',
        'level',
        'skills',
        'competencies'
      ],
      degree: [
        'completionDate',
        'programName',
        'level',
        'grade',
        'competencies',
        'learningOutcomes'
      ]
    });
  });

  it('converts arrays to editable lines and back without inventing values', () => {
    const state = detailToDraftEditorState(detailFixture());

    expect(state.skills).toBe('Arquitectura\nTesting');
    expect(linesToStringArray(' Arquitectura \n\n Testing ')).toEqual([
      'Arquitectura',
      'Testing'
    ]);
  });

  it('parses, builds and clears the structured academic period', () => {
    expect(parseAcademicPeriodInput('2026-2')).toEqual({
      year: '2026',
      term: '2'
    });
    expect(buildAcademicPeriodInput('2026', '1')).toBe('2026-1');
    expect(buildAcademicPeriodInput('2026', '')).toBe('2026-');
    expect(buildAcademicPeriodInput('', '2')).toBe('-2');
    expect(buildAcademicPeriodInput('', '')).toBe('');
    expect(sanitizeAcademicYearInput('20a26')).toBe('2026');
  });

  it('keeps only unsigned decimal grade characters with at most two decimals', () => {
    expect(sanitizeAcademicGradeInput('')).toBe('');
    expect(sanitizeAcademicGradeInput('0')).toBe('0');
    expect(sanitizeAcademicGradeInput('8')).toBe('8');
    expect(sanitizeAcademicGradeInput('8.5')).toBe('8.5');
    expect(sanitizeAcademicGradeInput('8,5')).toBe('8.5');
    expect(sanitizeAcademicGradeInput('10')).toBe('10');
    expect(sanitizeAcademicGradeInput('10.')).toBe('10.');
    expect(sanitizeAcademicGradeInput('-8')).toBe('8');
    expect(sanitizeAcademicGradeInput('--8')).toBe('8');
    expect(sanitizeAcademicGradeInput('+8')).toBe('8');
    expect(sanitizeAcademicGradeInput('abc8.5xyz')).toBe('8.5');
    expect(sanitizeAcademicGradeInput('8e2')).toBe('82');
    expect(sanitizeAcademicGradeInput('8E2')).toBe('82');
    expect(sanitizeAcademicGradeInput('8a.567')).toBe('8.56');
    expect(sanitizeAcademicGradeInput('texto')).toBe('');
  });

  it('sanitizes an academic grade again when building the PATCH command', () => {
    const detail = detailFixture({
      type: 'academic_subject',
      credentialSubject: {
        ...detailFixture().credentialSubject,
        grade: null
      }
    });
    const state = {
      ...detailToDraftEditorState(detail),
      grade: '-8'
    };

    const command = buildDraftUpdateCommand({
      detail,
      state,
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference'
    });

    expect(command).toMatchObject({ grade: '8' });
    expect(command?.grade).not.toMatch(/^-/);
  });

  it('returns no command when the form has no semantic changes', () => {
    const detail = detailFixture();

    expect(
      buildDraftUpdateCommand({
        detail,
        state: detailToDraftEditorState(detail),
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toBeNull();
  });

  it('builds a sparse command with expectedUpdatedAt and changed fields only', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      achievementName: '  Arquitectura Aplicada  ',
      description: '',
      skills: 'Arquitectura\nObservabilidad'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      achievementName: 'Arquitectura Aplicada',
      description: null,
      skills: ['Arquitectura', 'Observabilidad']
    });
  });

  it('builds a curricular academic subject command without ambiguous manual fields', () => {
    const detail = detailFixture({
      type: 'academic_subject',
      typeLabel: 'Asignatura académica',
      academicCourse: null
    });
    const state = {
      ...detailToDraftEditorState(detail),
      achievementName: 'Nombre manual que no debe salir',
      description: 'Descripción manual que no debe salir',
      hours: '80',
      programName: 'Carrera manual que no debe salir',
      completionDate: '2026-07-30',
      academicPeriod: '2026-2',
      grade: '9'
    };

    const command = buildDraftUpdateCommand({
      detail,
      state,
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      pendingAcademicSelection: {
        academicCourseReference: 'course-reference',
        code: '3.4.213',
        name: 'Ingeniería de Datos II',
        description: null,
        hours: null,
        programReference: 'program-reference',
        programCode: '1621',
        programName: 'Ingeniería en Informática',
        curriculumReference: 'curriculum-reference',
        curriculumCode: '2026'
      }
    });

    expect(command).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      academicCourseReference: 'course-reference',
      curriculumReference: 'curriculum-reference',
      completionDate: '2026-07-30',
      academicPeriod: '2026-2',
      grade: '9'
    });
    expect(command).not.toHaveProperty('achievementName');
    expect(command).not.toHaveProperty('description');
    expect(command).not.toHaveProperty('hours');
    expect(command).not.toHaveProperty('programName');
  });

  it('uses null for cleared nullable strings and [] for cleared arrays', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      providerName: '   ',
      competencies: ''
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toMatchObject({
      providerName: null,
      competencies: []
    });
  });

  it('sends null when an optional academic grade is cleared', () => {
    const detail = detailFixture({
      type: 'academic_subject',
      credentialSubject: {
        ...detailFixture().credentialSubject,
        grade: '8.5'
      }
    });
    const state = {
      ...detailToDraftEditorState(detail),
      grade: ''
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toMatchObject({ grade: null });
  });

  it('includes changed certification dates in the sparse command', () => {
    const current = detailFixture();
    const detail = detailFixture({
      type: 'certification',
      typeLabel: 'Certificación',
      credentialSubject: {
        ...current.credentialSubject,
        platformName: null,
        modality: null,
        learningOutcomes: []
      }
    });
    const state = {
      ...detailToDraftEditorState(detail),
      completionDate: '2026-07-30',
      expirationDate: '2027-07-30'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toMatchObject({
      completionDate: '2026-07-30',
      expirationDate: '2027-07-30'
    });
  });

  it('detects incompatible populated fields before changing type', () => {
    const state = detailToDraftEditorState(detailFixture());

    expect(
      getIncompatiblePopulatedFields(state, 'certification')
    ).toEqual(['platformName', 'modality', 'learningOutcomes']);
  });

  it('clears only incompatible local fields and preserves compatible values', () => {
    const detail = detailFixture();
    const changed = applyCredentialTypeChange(
      detailToDraftEditorState(detail),
      'certification'
    );

    expect(changed).toMatchObject({
      type: 'certification',
      providerName: 'Instituto Demo',
      level: 'Intermedio',
      skills: 'Arquitectura\nTesting',
      competencies: 'Diseño',
      platformName: '',
      modality: '',
      learningOutcomes: ''
    });
  });

  it('sends the new type without hidden incompatible fields', () => {
    const detail = detailFixture();
    const state = applyCredentialTypeChange(
      detailToDraftEditorState(detail),
      'certification'
    );
    const command = buildDraftUpdateCommand({
      detail,
      state,
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference'
    });

    expect(command).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      type: 'certification'
    });
    expect(command).not.toHaveProperty('platformName');
    expect(command).not.toHaveProperty('modality');
    expect(command).not.toHaveProperty('learningOutcomes');
  });

  it('does not preserve curricular references when changing to a manual type', () => {
    const detail = detailFixture({
      type: 'academic_subject',
      typeLabel: 'Asignatura académica',
      academicCourse: {
        academicCourseReference: 'course-reference',
        code: '3.4.213',
        name: 'Ingeniería de Datos II',
        description: null,
        hours: null,
        program: {
          programReference: 'program-reference',
          programCode: '1621',
          programName: 'Ingeniería en Informática',
          curriculumReference: 'curriculum-reference',
          curriculumCode: '2026'
        }
      }
    });
    const state = applyCredentialTypeChange(
      detailToDraftEditorState(detail),
      'course'
    );
    const command = buildDraftUpdateCommand({
      detail,
      state,
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference'
    });

    expect(command).toEqual({
      issuerReference: 'issuer-reference',
      credentialReference: 'credential-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      type: 'course'
    });
    expect(command).not.toHaveProperty('academicCourseReference');
    expect(command).not.toHaveProperty('curriculumReference');
  });

  it('never sends a populated field that does not apply to the final type', () => {
    const detail = detailFixture();
    const state = {
      ...detailToDraftEditorState(detail),
      certificationCode: 'SHOULD-NOT-BE-SENT'
    };

    expect(
      buildDraftUpdateCommand({
        detail,
        state,
        issuerReference: 'issuer-reference',
        credentialReference: 'credential-reference'
      })
    ).toBeNull();
  });

  it('validates only the basic client-side formats needed for immediate feedback', () => {
    const state = {
      ...detailToDraftEditorState(detailFixture()),
      achievementName: ' ',
      hours: '-2',
      externalUrl: 'ftp://example.com'
    };

    expect(validateDraftEditorState(state)).toEqual({
      achievementName: 'Ingresá el nombre del logro.',
      hours: 'Ingresá un valor positivo con hasta dos decimales.',
      externalUrl: 'Ingresá una URL HTTP o HTTPS válida.'
    });
  });

  it('validates academic grade range and requires both academic period parts', () => {
    const detail = detailFixture({ type: 'academic_subject' });
    const state = {
      ...detailToDraftEditorState(detail),
      grade: '10.01',
      academicPeriod: '2026-'
    };

    expect(validateDraftEditorState(state)).toEqual({
      grade: 'Ingresá una calificación entre 0 y 10 con hasta dos decimales.',
      academicPeriod:
        'Completá el año de cuatro dígitos y el período académico.'
    });

    expect(
      validateDraftEditorState({
        ...state,
        grade: '8.5',
        academicPeriod: '2026-1'
      })
    ).toEqual({});

    expect(
      validateDraftEditorState({
        ...state,
        grade: '',
        academicPeriod: ''
      })
    ).toEqual({});
  });
});
