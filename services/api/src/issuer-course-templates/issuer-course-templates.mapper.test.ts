import assert from 'node:assert/strict';
import test from 'node:test';

import { CourseTemplateStatus } from '@prisma/client';

import { mapCourseTemplateResponse } from './issuer-course-templates.mapper';

function decimalLike(value: string) {
  return { toFixed: (fractionDigits?: number) => Number(value).toFixed(fractionDigits) };
}

test('mapCourseTemplateResponse serializes Decimal hours as a string, never a raw object', () => {
  const response = mapCourseTemplateResponse({
    id: 'template-1',
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: decimalLike('22'),
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    competencies: ['Programacion'],
    learningOutcomes: ['Escribir scripts basicos'],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:05:00.000Z')
  });

  assert.equal(response.hours, '22.00');
  assert.equal(typeof response.hours, 'string');
  assert.equal(response.createdAt, '2026-08-11T10:00:00.000Z');
  assert.equal(response.updatedAt, '2026-08-11T10:05:00.000Z');
  assert.deepEqual(response, {
    id: 'template-1',
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    competencies: ['Programacion'],
    learningOutcomes: ['Escribir scripts basicos'],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:05:00.000Z'
  });
  assert.equal(JSON.stringify(response).includes('issuerId'), false);
  assert.equal(JSON.stringify(response).includes('createdByUserId'), false);
});

test('mapCourseTemplateResponse maps null hours and null optional fields safely', () => {
  const response = mapCourseTemplateResponse({
    id: 'template-2',
    title: 'Curso manual',
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null,
    competencies: [],
    learningOutcomes: [],
    status: CourseTemplateStatus.archived,
    createdFromCredentialId: null,
    lastSemanticAnalysisId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z')
  });

  assert.equal(response.hours, null);
  assert.equal(response.createdFromCredentialId, null);
  assert.equal(response.lastSemanticAnalysisId, null);
  assert.equal(response.status, CourseTemplateStatus.archived);
});
