import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { CredentialSourceType, CredentialType } from '@prisma/client';

import { validateCreateCredentialDraftCurricularSelection } from './create-credential-draft.validator';
import { type CreateCredentialDraftDto } from './dto/create-credential-draft.dto';

const validPayload = {
  issuerId: 'issuer-1',
  subjectUserId: 'holder-1',
  type: CredentialType.academic_subject,
  sourceType: CredentialSourceType.manual_issuer,
  academicCourseReference: ' academic-course-1 ',
  curriculumReference: ' curriculum-1 '
} satisfies CreateCredentialDraftDto;

test('create draft validator trims and accepts a complete curricular reference pair', () => {
  assert.deepEqual(
    validateCreateCredentialDraftCurricularSelection(validPayload),
    {
      academicCourseReference: 'academic-course-1',
      curriculumReference: 'curriculum-1'
    }
  );
});

test('create draft validator preserves the manual path without curricular references', () => {
  assert.equal(
    validateCreateCredentialDraftCurricularSelection({
      issuerId: 'issuer-1',
      subjectUserId: 'holder-1',
      type: CredentialType.course,
      title: 'Curso manual',
      sourceType: CredentialSourceType.manual_issuer,
      credentialSubject: {
        achievement_name: 'Curso manual',
        institution_name: 'Demo University'
      }
    }),
    null
  );
});

test('create draft validator rejects incomplete or empty curricular references', () => {
  const basePayload = {
    issuerId: validPayload.issuerId,
    subjectUserId: validPayload.subjectUserId,
    type: validPayload.type,
    sourceType: validPayload.sourceType
  };
  const invalidPayloads = [
    { academicCourseReference: 'course-1' },
    { curriculumReference: 'curriculum-1' },
    {
      academicCourseReference: '',
      curriculumReference: 'curriculum-1'
    },
    {
      academicCourseReference: 'course-1',
      curriculumReference: '   '
    }
  ];

  for (const invalid of invalidPayloads) {
    assert.throws(
      () =>
        validateCreateCredentialDraftCurricularSelection({
          ...basePayload,
          ...invalid
        } as CreateCredentialDraftDto),
      BadRequestException
    );
  }
});

test('create draft validator rejects internal ids and relational objects', () => {
  for (const field of [
    'academicCourseId',
    'programCourseId',
    'curriculumVersionId',
    'academicCourse',
    'programCourse',
    'curriculum',
    'program'
  ]) {
    assert.throws(
      () =>
        validateCreateCredentialDraftCurricularSelection({
          ...validPayload,
          [field]: field.endsWith('Id') ? 'internal-id' : {}
        } as CreateCredentialDraftDto),
      BadRequestException,
      field
    );
  }
});

test('create draft validator applies an exact curricular top-level allowlist by property presence', () => {
  const forbiddenEntries: Array<[string, unknown]> = [
    ['title', undefined],
    ['description', null],
    ['hours', ''],
    ['achievementName', 'manual value'],
    ['institutionName', 'manual value'],
    ['programName', 'manual value'],
    ['credentialSubject', {}],
    ['credentialSubject', { skills: ['SQL'] }],
    ['credentialSubject', { competencies: ['analisis'] }],
    ['credentialSubject', { grade: '9' }],
    ['credentialSubject', { completion_date: '2026-07-01' }],
    ['credentialSubject', { academic_period: '2026-1' }],
    ['credentialSubject', { learning_outcomes: [] }],
    ['metadata', {}],
    ['rawData', {}],
    ['externalCourseId', ''],
    ['unknownField', undefined]
  ];

  for (const [field, value] of forbiddenEntries) {
    assert.throws(
      () =>
        validateCreateCredentialDraftCurricularSelection({
          ...validPayload,
          [field]: value
        } as CreateCredentialDraftDto),
      BadRequestException,
      `${field}: ${JSON.stringify(value)}`
    );
  }
});

test('create draft validator requires manual_issuer for curriculum creation', () => {
  for (const sourceType of [
    CredentialSourceType.academic_pdf,
    CredentialSourceType.course_dataset,
    CredentialSourceType.institutional_system,
    CredentialSourceType.external_import
  ]) {
    assert.throws(
      () =>
        validateCreateCredentialDraftCurricularSelection({
          ...validPayload,
          sourceType
        }),
      BadRequestException,
      sourceType
    );
  }
});

test('create draft validator rejects curriculum selection for course, certification and degree', () => {
  for (const type of [
    CredentialType.course,
    CredentialType.certification,
    CredentialType.degree
  ]) {
    assert.throws(
      () =>
        validateCreateCredentialDraftCurricularSelection({
          ...validPayload,
          type
        }),
      BadRequestException,
      type
    );
  }
});
