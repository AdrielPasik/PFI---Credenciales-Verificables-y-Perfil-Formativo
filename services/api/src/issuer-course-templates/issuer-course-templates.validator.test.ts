import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { CourseTemplateStatus, CredentialType } from '@prisma/client';

import {
  validateCreateCourseTemplatePayload,
  validatePatchCourseTemplatePayload
} from './issuer-course-templates.validator';

test('create rejects a non-object payload and a missing/empty title', () => {
  for (const payload of [null, [], 'invalid', 42]) {
    assert.throws(
      () => validateCreateCourseTemplatePayload(payload),
      BadRequestException
    );
  }

  assert.throws(
    () => validateCreateCourseTemplatePayload({}),
    BadRequestException
  );
  assert.throws(
    () => validateCreateCourseTemplatePayload({ title: '   ' }),
    BadRequestException
  );
  assert.throws(
    () => validateCreateCourseTemplatePayload({ title: 42 }),
    BadRequestException
  );
});

test('create defaults credentialType to course when omitted', () => {
  const result = validateCreateCourseTemplatePayload({ title: 'Curso de Python' });
  assert.equal(result.credentialType, CredentialType.course);
});

test('create accepts a minimal payload and defaults optional fields', () => {
  const result = validateCreateCourseTemplatePayload({ title: '  Python  para  Data  ' });

  assert.equal(result.title, 'Python para Data');
  assert.equal(result.description, null);
  assert.equal(result.hours, null);
  assert.equal(result.modality, null);
  assert.equal(result.platformName, null);
  assert.equal(result.externalUrl, null);
  assert.equal(result.certificationCode, null);
  assert.equal(result.expirationDate, null);
  assert.equal(result.providerName, null);
  assert.equal(result.level, null);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.competencies, []);
  assert.deepEqual(result.learningOutcomes, []);
});

test('create accepts a full course payload with hours as a JSON number', () => {
  const result = validateCreateCourseTemplatePayload({
    credentialType: CredentialType.course,
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: 22,
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    competencies: ['Programacion', 'Programacion', '  '],
    learningOutcomes: ['Escribir scripts basicos']
  });

  assert.equal(result.credentialType, CredentialType.course);
  assert.equal(result.description, 'Introduccion a Python');
  assert.equal(result.hours?.toFixed(2), '22.00');
  assert.equal(result.modality, 'Online');
  assert.equal(result.platformName, 'Plataforma de Cursos Demo');
  assert.equal(result.externalUrl, 'https://plataforma-demo.example.com/curso/python');
  assert.deepEqual(result.competencies, ['Programacion']);
  assert.deepEqual(result.learningOutcomes, ['Escribir scripts basicos']);
});

test('create accepts a full certification payload', () => {
  const result = validateCreateCourseTemplatePayload({
    credentialType: CredentialType.certification,
    title: 'Certificacion AWS Cloud Practitioner',
    description: 'Certificacion de fundamentos de cloud',
    hours: 10,
    certificationCode: 'AWS-CCP',
    expirationDate: '2027-01-01',
    externalUrl: 'https://certificaciones-demo.example.com/aws-ccp',
    providerName: 'Instituto Demo',
    level: 'Fundamentos',
    skills: ['Cloud', 'Cloud', '  '],
    competencies: ['Fundamentos de nube']
  });

  assert.equal(result.credentialType, CredentialType.certification);
  assert.equal(result.certificationCode, 'AWS-CCP');
  assert.equal(result.expirationDate, '2027-01-01');
  assert.equal(result.providerName, 'Instituto Demo');
  assert.equal(result.level, 'Fundamentos');
  assert.deepEqual(result.skills, ['Cloud']);
  assert.deepEqual(result.competencies, ['Fundamentos de nube']);
});

test('create rejects credentialType outside course/certification', () => {
  for (const credentialType of [
    CredentialType.academic_subject,
    CredentialType.degree,
    'invalid'
  ]) {
    assert.throws(
      () => validateCreateCourseTemplatePayload({ title: 'x', credentialType }),
      BadRequestException
    );
  }
});

test('create rejects certification-only fields for a course template', () => {
  for (const field of ['certificationCode', 'expirationDate', 'providerName', 'level', 'skills']) {
    assert.throws(
      () =>
        validateCreateCourseTemplatePayload({
          credentialType: CredentialType.course,
          title: 'Curso',
          [field]: field === 'skills' ? ['x'] : field === 'expirationDate' ? '2027-01-01' : 'x'
        }),
      BadRequestException,
      `expected rejection for course + ${field}`
    );
  }
});

test('create rejects course-only fields for a certification template', () => {
  for (const field of ['modality', 'platformName', 'learningOutcomes']) {
    assert.throws(
      () =>
        validateCreateCourseTemplatePayload({
          credentialType: CredentialType.certification,
          title: 'Certificacion',
          [field]: field === 'learningOutcomes' ? ['x'] : field === 'modality' ? 'Online' : 'x'
        }),
      BadRequestException,
      `expected rejection for certification + ${field}`
    );
  }
});

test('create rejects modality outside Presencial/Online/Asincrónica', () => {
  assert.throws(
    () => validateCreateCourseTemplatePayload({ title: 'Curso', modality: 'Remoto' }),
    BadRequestException
  );
});

test('create rejects an invalid expirationDate', () => {
  assert.throws(
    () =>
      validateCreateCourseTemplatePayload({
        credentialType: CredentialType.certification,
        title: 'Certificacion',
        expirationDate: '2027-13-40'
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      validateCreateCourseTemplatePayload({
        credentialType: CredentialType.certification,
        title: 'Certificacion',
        expirationDate: 'not-a-date'
      }),
    BadRequestException
  );
});

test('create rejects an externalUrl that is not http/https', () => {
  assert.throws(
    () =>
      validateCreateCourseTemplatePayload({
        title: 'Curso',
        externalUrl: 'javascript:alert(1)'
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      validateCreateCourseTemplatePayload({
        title: 'Curso',
        externalUrl: 'not-a-url'
      }),
    BadRequestException
  );
});

test('create rejects a negative hours value', () => {
  assert.throws(
    () => validateCreateCourseTemplatePayload({ title: 'Curso', hours: -1 }),
    BadRequestException
  );
});

test('create accepts zero hours', () => {
  const result = validateCreateCourseTemplatePayload({ title: 'Curso', hours: 0 });
  assert.equal(result.hours?.toFixed(2), '0.00');
});

test('create ignores/rejects providerName and level on a course, and rejects other credential-only fields regardless of type', () => {
  for (const field of [
    'issuerId',
    'createdByUserId',
    'createdFromCredentialId',
    'lastSemanticAnalysisId',
    'status',
    'unexpected'
  ]) {
    assert.throws(
      () =>
        validateCreateCourseTemplatePayload({
          title: 'Curso',
          [field]: 'x'
        }),
      BadRequestException,
      `expected rejection for field ${field}`
    );
  }
});

test('patch requires at least one field and rejects unknown fields', () => {
  assert.throws(
    () => validatePatchCourseTemplatePayload({}, CredentialType.course),
    BadRequestException
  );

  for (const field of [
    'credentialType',
    'issuerId',
    'createdByUserId',
    'createdFromCredentialId',
    'lastSemanticAnalysisId'
  ]) {
    assert.throws(
      () =>
        validatePatchCourseTemplatePayload(
          { [field]: 'x' },
          CredentialType.course
        ),
      BadRequestException,
      `expected rejection for field ${field}`
    );
  }
});

test('patch only marks provided fields and preserves omitted ones as not-provided', () => {
  const result = validatePatchCourseTemplatePayload(
    { title: 'Nuevo titulo' },
    CredentialType.course
  );

  assert.deepEqual(result.title, { provided: true, value: 'Nuevo titulo' });
  assert.deepEqual(result.description, { provided: false });
  assert.deepEqual(result.hours, { provided: false });
  assert.deepEqual(result.status, { provided: false });
});

test('patch rejects certification-only fields when the template is a course', () => {
  assert.throws(
    () =>
      validatePatchCourseTemplatePayload(
        { certificationCode: 'X' },
        CredentialType.course
      ),
    BadRequestException
  );
});

test('patch rejects course-only fields when the template is a certification', () => {
  assert.throws(
    () =>
      validatePatchCourseTemplatePayload(
        { modality: 'Online' },
        CredentialType.certification
      ),
    BadRequestException
  );
});

test('patch accepts certification-only fields when the template is a certification', () => {
  const result = validatePatchCourseTemplatePayload(
    { certificationCode: 'AWS-CCP', level: 'Fundamentos' },
    CredentialType.certification
  );
  assert.deepEqual(result.certificationCode, { provided: true, value: 'AWS-CCP' });
  assert.deepEqual(result.level, { provided: true, value: 'Fundamentos' });
});

test('patch accepts status active/archived and rejects any other value', () => {
  assert.deepEqual(
    validatePatchCourseTemplatePayload(
      { status: CourseTemplateStatus.archived },
      CredentialType.course
    ).status,
    { provided: true, value: CourseTemplateStatus.archived }
  );
  assert.deepEqual(
    validatePatchCourseTemplatePayload(
      { status: CourseTemplateStatus.active },
      CredentialType.course
    ).status,
    { provided: true, value: CourseTemplateStatus.active }
  );
  assert.throws(
    () =>
      validatePatchCourseTemplatePayload({ status: 'deleted' }, CredentialType.course),
    BadRequestException
  );
});

test('patch rejects an empty title and an invalid modality', () => {
  assert.throws(
    () => validatePatchCourseTemplatePayload({ title: '   ' }, CredentialType.course),
    BadRequestException
  );
  assert.throws(
    () =>
      validatePatchCourseTemplatePayload({ modality: 'Remoto' }, CredentialType.course),
    BadRequestException
  );
});

test('patch allows clearing nullable fields with null', () => {
  const result = validatePatchCourseTemplatePayload(
    {
      description: null,
      hours: null,
      modality: null,
      platformName: null,
      externalUrl: null
    },
    CredentialType.course
  );

  assert.deepEqual(result.description, { provided: true, value: null });
  assert.deepEqual(result.hours, { provided: true, value: null });
  assert.deepEqual(result.modality, { provided: true, value: null });
  assert.deepEqual(result.platformName, { provided: true, value: null });
  assert.deepEqual(result.externalUrl, { provided: true, value: null });
});
