import assert from 'node:assert/strict';
import test from 'node:test';

import { CourseTemplateStatus, CredentialType } from '@prisma/client';

import { mapCourseTemplateResponse } from './issuer-course-templates.mapper';

function decimalLike(value: string) {
  return { toFixed: (fractionDigits?: number) => Number(value).toFixed(fractionDigits) };
}

test('mapCourseTemplateResponse serializes Decimal hours as a string, never a raw object, for a course template', () => {
  const response = mapCourseTemplateResponse({
    id: 'template-1',
    credentialType: CredentialType.course,
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: decimalLike('22'),
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: ['Programacion'],
    learningOutcomes: ['Escribir scripts basicos'],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    approvedSemanticAnalysisId: null,
    approvedSemanticSnapshot: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:05:00.000Z')
  });

  assert.equal(response.hours, '22.00');
  assert.equal(typeof response.hours, 'string');
  assert.equal(response.credentialType, CredentialType.course);
  assert.deepEqual(response, {
    id: 'template-1',
    credentialType: CredentialType.course,
    title: 'Curso de Python',
    description: 'Introduccion a Python',
    hours: '22.00',
    modality: 'Online',
    platformName: 'Plataforma de Cursos Demo',
    externalUrl: 'https://plataforma-demo.example.com/curso/python',
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: ['Programacion'],
    learningOutcomes: ['Escribir scripts basicos'],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: 'analysis-1',
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:05:00.000Z'
  });
  assert.equal(JSON.stringify(response).includes('issuerId'), false);
  assert.equal(JSON.stringify(response).includes('createdByUserId'), false);
});

test('mapCourseTemplateResponse exposes certification-only fields and credentialType=certification', () => {
  const response = mapCourseTemplateResponse({
    id: 'template-2',
    credentialType: CredentialType.certification,
    title: 'Certificacion AWS Cloud Practitioner',
    description: null,
    hours: decimalLike('10'),
    modality: null,
    platformName: null,
    externalUrl: 'https://certificaciones-demo.example.com/aws-ccp',
    certificationCode: 'AWS-CCP',
    expirationDate: '2027-01-01',
    providerName: 'Instituto Demo',
    level: 'Fundamentos',
    skills: ['Cloud'],
    competencies: ['Fundamentos de nube'],
    learningOutcomes: [],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-2',
    lastSemanticAnalysisId: null,
    approvedSemanticAnalysisId: null,
    approvedSemanticSnapshot: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z')
  });

  assert.equal(response.credentialType, CredentialType.certification);
  assert.equal(response.certificationCode, 'AWS-CCP');
  assert.equal(response.expirationDate, '2027-01-01');
  assert.equal(response.providerName, 'Instituto Demo');
  assert.equal(response.level, 'Fundamentos');
  assert.deepEqual(response.skills, ['Cloud']);
  assert.equal(response.modality, null);
  assert.equal(response.platformName, null);
});

test('mapCourseTemplateResponse maps null hours and null optional fields safely', () => {
  const response = mapCourseTemplateResponse({
    id: 'template-3',
    credentialType: CredentialType.course,
    title: 'Curso manual',
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    status: CourseTemplateStatus.archived,
    createdFromCredentialId: null,
    lastSemanticAnalysisId: null,
    approvedSemanticAnalysisId: null,
    approvedSemanticSnapshot: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z')
  });

  assert.equal(response.hours, null);
  assert.equal(response.createdFromCredentialId, null);
  assert.equal(response.lastSemanticAnalysisId, null);
  assert.equal(response.status, CourseTemplateStatus.archived);
  assert.equal(response.approvedSemanticSnapshotSummary, null);
});

test('mapCourseTemplateResponse exposes approval metadata and a safe snapshot summary, never the raw snapshot', () => {
  const approvedAt = new Date('2026-08-11T12:00:00.000Z');
  const rawSnapshot = {
    schema: 'approved_template_semantic_snapshot_v1',
    semanticAnalysisSchema: 'semantic_analysis_v1',
    status: 'completed',
    areas: [{ id: 'area-1', label: 'Programacion', confidence: 0.9 }],
    skills: [{ id: 'skill-1', label: 'Python', confidence: 0.8 }],
    concepts: [],
    hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
    confidence: 0.85,
    warnings: ['w1'],
    qualityFlags: ['q1', 'q2'],
    // Si esta clave estuviera presente en el snapshot persistido seria un
    // bug del helper -- se agrega aca solo para confirmar que el mapper
    // tampoco la reexpone al calcular el resumen.
    sourceRefs: { documentEvidenceId: 'doc-1' }
  };

  const response = mapCourseTemplateResponse({
    id: 'template-4',
    credentialType: CredentialType.course,
    title: 'Curso de Python',
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: 'credential-4',
    lastSemanticAnalysisId: 'analysis-4',
    approvedSemanticAnalysisId: 'analysis-4',
    approvedSemanticSnapshot: rawSnapshot,
    approvedSemanticApprovedAt: approvedAt,
    approvedSemanticPipelineVersion: 'pipeline-v1',
    approvedSemanticTaxonomyVersion: 'taxonomy-v1',
    approvedSemanticSourceCredentialId: 'credential-4',
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z')
  });

  assert.equal(response.approvedSemanticAnalysisId, 'analysis-4');
  assert.equal(response.approvedSemanticApprovedAt, approvedAt.toISOString());
  assert.equal(response.approvedSemanticPipelineVersion, 'pipeline-v1');
  assert.equal(response.approvedSemanticTaxonomyVersion, 'taxonomy-v1');
  assert.equal(response.approvedSemanticSourceCredentialId, 'credential-4');
  assert.deepEqual(response.approvedSemanticSnapshotSummary, {
    schema: 'approved_template_semantic_snapshot_v1',
    status: 'completed',
    areaCount: 1,
    skillCount: 1,
    conceptCount: 0,
    hasHoursDistribution: true,
    warningCount: 1,
    qualityFlagCount: 2
  });

  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('sourceRefs'), false);
  assert.equal(serialized.includes('documentEvidenceId'), false);
  assert.equal(serialized.includes('hoursDistribution'), false);
});
