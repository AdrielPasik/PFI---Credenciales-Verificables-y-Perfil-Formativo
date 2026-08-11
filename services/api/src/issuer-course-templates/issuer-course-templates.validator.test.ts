import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { CourseTemplateStatus } from '@prisma/client';

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

test('create accepts a minimal payload and defaults optional fields', () => {
  const result = validateCreateCourseTemplatePayload({ title: '  Python  para  Data  ' });

  assert.equal(result.title, 'Python para Data');
  assert.equal(result.description, null);
  assert.equal(result.hours, null);
  assert.equal(result.modality, null);
  assert.equal(result.platformName, null);
  assert.equal(result.externalUrl, null);
  assert.deepEqual(result.competencies, []);
  assert.deepEqual(result.learningOutcomes, []);
});

test('create accepts a full payload with hours as a JSON number', () => {
  const result = validateCreateCourseTemplatePayload({
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: 22,
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    competencies: ['Programacion', 'Programacion', '  '],
    learningOutcomes: ['Escribir scripts basicos']
  });

  assert.equal(result.description, 'Introduccion a Python');
  assert.equal(result.hours?.toFixed(2), '22.00');
  assert.equal(result.modality, 'Online');
  assert.equal(result.platformName, 'Plataforma de Cursos Demo');
  assert.equal(result.externalUrl, 'https://plataforma-demo.example.com/curso/python');
  assert.deepEqual(result.competencies, ['Programacion']);
  assert.deepEqual(result.learningOutcomes, ['Escribir scripts basicos']);
});

test('create rejects modality outside Presencial/Online/Asincrónica', () => {
  assert.throws(
    () => validateCreateCourseTemplatePayload({ title: 'Curso', modality: 'Remoto' }),
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

test('create ignores/rejects skills, providerName, level and other credential-only fields', () => {
  for (const field of [
    'skills',
    'providerName',
    'level',
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
          [field]: field === 'skills' ? ['x'] : 'x'
        }),
      BadRequestException,
      `expected rejection for field ${field}`
    );
  }
});

test('patch requires at least one field and rejects unknown fields', () => {
  assert.throws(
    () => validatePatchCourseTemplatePayload({}),
    BadRequestException
  );

  for (const field of [
    'skills',
    'providerName',
    'level',
    'issuerId',
    'createdByUserId',
    'createdFromCredentialId',
    'lastSemanticAnalysisId'
  ]) {
    assert.throws(
      () =>
        validatePatchCourseTemplatePayload({
          [field]: field === 'skills' ? ['x'] : 'x'
        }),
      BadRequestException,
      `expected rejection for field ${field}`
    );
  }
});

test('patch only marks provided fields and preserves omitted ones as not-provided', () => {
  const result = validatePatchCourseTemplatePayload({ title: 'Nuevo titulo' });

  assert.deepEqual(result.title, { provided: true, value: 'Nuevo titulo' });
  assert.deepEqual(result.description, { provided: false });
  assert.deepEqual(result.hours, { provided: false });
  assert.deepEqual(result.status, { provided: false });
});

test('patch accepts status active/archived and rejects any other value', () => {
  assert.deepEqual(
    validatePatchCourseTemplatePayload({ status: CourseTemplateStatus.archived })
      .status,
    { provided: true, value: CourseTemplateStatus.archived }
  );
  assert.deepEqual(
    validatePatchCourseTemplatePayload({ status: CourseTemplateStatus.active })
      .status,
    { provided: true, value: CourseTemplateStatus.active }
  );
  assert.throws(
    () => validatePatchCourseTemplatePayload({ status: 'deleted' }),
    BadRequestException
  );
});

test('patch rejects an empty title and an invalid modality', () => {
  assert.throws(
    () => validatePatchCourseTemplatePayload({ title: '   ' }),
    BadRequestException
  );
  assert.throws(
    () => validatePatchCourseTemplatePayload({ modality: 'Remoto' }),
    BadRequestException
  );
});

test('patch allows clearing nullable fields with null', () => {
  const result = validatePatchCourseTemplatePayload({
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null
  });

  assert.deepEqual(result.description, { provided: true, value: null });
  assert.deepEqual(result.hours, { provided: true, value: null });
  assert.deepEqual(result.modality, { provided: true, value: null });
  assert.deepEqual(result.platformName, { provided: true, value: null });
  assert.deepEqual(result.externalUrl, { provided: true, value: null });
});
