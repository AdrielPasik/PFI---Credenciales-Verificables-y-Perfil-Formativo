import assert from 'node:assert/strict';
import test from 'node:test';

import { UnprocessableEntityException } from '@nestjs/common';

import {
  approvalRevisionMatches,
  assertTemplateApprovalIsComplete,
  computeApprovalDriftStatus,
  computeDestinationCompatibility,
  computeTemplateContentStatus,
  toApprovalRevision,
  toComparableCredentialContent,
  toComparableTemplateContent,
  type CompleteTemplateApprovalFields,
  type TemplateApprovalFields
} from './reusable-semantic-interpretation.helpers';

const APPROVED_AT = new Date('2026-08-14T10:00:00.000Z');

function completeApproval(
  overrides: Partial<CompleteTemplateApprovalFields> = {}
): CompleteTemplateApprovalFields {
  return {
    approvedSemanticSnapshot: { schema: 'approved_template_semantic_snapshot_v2' },
    approvedSemanticAnalysisId: 'semantic-1',
    approvedSemanticSourceCredentialId: 'credential-source',
    approvedSemanticApprovedByUserId: 'user-approver',
    approvedSemanticApprovedAt: APPROVED_AT,
    approvedSemanticPipelineVersion: 'pipeline-v1',
    approvedSemanticTaxonomyVersion: 'taxonomy-v1',
    ...overrides
  };
}

test('assertTemplateApprovalIsComplete accepts a fully populated approval', () => {
  assert.doesNotThrow(() => assertTemplateApprovalIsComplete(completeApproval()));
});

test('assertTemplateApprovalIsComplete rejects a template missing any of the 6 provenance fields', () => {
  const fields: Array<keyof TemplateApprovalFields> = [
    'approvedSemanticSnapshot',
    'approvedSemanticAnalysisId',
    'approvedSemanticSourceCredentialId',
    'approvedSemanticApprovedByUserId',
    'approvedSemanticApprovedAt',
    'approvedSemanticPipelineVersion',
    'approvedSemanticTaxonomyVersion'
  ];

  for (const field of fields) {
    const incomplete = { ...completeApproval(), [field]: null };
    assert.throws(
      () => assertTemplateApprovalIsComplete(incomplete),
      UnprocessableEntityException,
      `expected rejection when ${field} is null`
    );
  }
});

test('toApprovalRevision/approvalRevisionMatches: exact equality only, never > comparisons', () => {
  const revision = toApprovalRevision(APPROVED_AT);
  assert.equal(revision, APPROVED_AT.toISOString());
  assert.ok(approvalRevisionMatches(APPROVED_AT, revision));
  assert.ok(!approvalRevisionMatches(new Date('2026-08-14T10:00:00.001Z'), revision));
  assert.ok(!approvalRevisionMatches(new Date('2026-08-13T10:00:00.000Z'), revision));
});

test('computeApprovalDriftStatus: none_applied when there is no active row', () => {
  const status = computeApprovalDriftStatus(null, {
    approvedSemanticAnalysisId: 'semantic-1',
    approvedSemanticApprovedAt: APPROVED_AT
  });
  assert.equal(status, 'none_applied');
});

test('computeApprovalDriftStatus: up_to_date when identity matches exactly', () => {
  const status = computeApprovalDriftStatus(
    { sourceSemanticAnalysisId: 'semantic-1', sourceApprovedAt: APPROVED_AT },
    { approvedSemanticAnalysisId: 'semantic-1', approvedSemanticApprovedAt: APPROVED_AT }
  );
  assert.equal(status, 'up_to_date');
});

test('computeApprovalDriftStatus: different_approval_available when the template was re-approved (same analysis, different timestamp)', () => {
  const status = computeApprovalDriftStatus(
    { sourceSemanticAnalysisId: 'semantic-1', sourceApprovedAt: APPROVED_AT },
    {
      approvedSemanticAnalysisId: 'semantic-1',
      approvedSemanticApprovedAt: new Date('2026-08-15T10:00:00.000Z')
    }
  );
  assert.equal(status, 'different_approval_available');
});

test('computeApprovalDriftStatus: different_approval_available when the underlying semantic analysis itself changed', () => {
  const status = computeApprovalDriftStatus(
    { sourceSemanticAnalysisId: 'semantic-1', sourceApprovedAt: APPROVED_AT },
    { approvedSemanticAnalysisId: 'semantic-2', approvedSemanticApprovedAt: APPROVED_AT }
  );
  assert.equal(status, 'different_approval_available');
});

test('toComparableCredentialContent prefers credentialSubject.achievement_name over Credential.title', () => {
  const content = toComparableCredentialContent({
    title: 'Credential title',
    description: '  Some description  ',
    hours: 40,
    credentialSubject: {
      achievement_name: 'Achievement name',
      competencies: ['SQL', ' sql ', 'Python'],
      learning_outcomes: ['Outcome A'],
      skills: []
    }
  });

  assert.equal(content.title, 'Achievement name');
  assert.equal(content.description, 'Some description');
  assert.deepEqual(content.competencies, ['SQL', 'Python']);
  assert.deepEqual(content.learningOutcomes, ['Outcome A']);
  assert.equal(content.hours, 40);
});

test('toComparableCredentialContent falls back to Credential.title when achievement_name is absent', () => {
  const content = toComparableCredentialContent({
    title: 'Credential title',
    description: null,
    hours: null,
    credentialSubject: {}
  });
  assert.equal(content.title, 'Credential title');
  assert.equal(content.description, null);
  assert.equal(content.hours, null);
});

test('toComparableTemplateContent reads scalar array columns directly, never through credentialSubject', () => {
  const content = toComparableTemplateContent({
    title: 'Template title',
    description: null,
    hours: '10.00',
    competencies: ['A', 'B'],
    learningOutcomes: ['C'],
    skills: ['D']
  });
  assert.equal(content.title, 'Template title');
  assert.deepEqual(content.competencies, ['A', 'B']);
  assert.deepEqual(content.learningOutcomes, ['C']);
  assert.deepEqual(content.skills, ['D']);
  assert.equal(content.hours, 10);
});

test('computeTemplateContentStatus: unknown when the source credential cannot be resolved', () => {
  const status = computeTemplateContentStatus(
    { title: 'X', description: null, competencies: [], learningOutcomes: [], skills: [], hours: null },
    null,
    'course'
  );
  assert.equal(status, 'unknown');
});

test('computeTemplateContentStatus: matches_approved_source when template content equals the source credential', () => {
  const content = {
    title: 'Introducción a UX',
    description: 'Descripción original',
    competencies: ['Investigación de usuarios'],
    learningOutcomes: ['Diseñar wireframes'],
    skills: [],
    hours: 20
  };
  const status = computeTemplateContentStatus(content, content, 'course');
  assert.equal(status, 'matches_approved_source');
});

test('computeTemplateContentStatus: differs_from_approved_source when the template drifted from its own approved source (the introduction scenario)', () => {
  const source = {
    title: 'Introducción a UX',
    description: 'Descripción original de UX',
    competencies: ['Investigación de usuarios'],
    learningOutcomes: [],
    skills: [],
    hours: 20
  };
  const templateNow = {
    ...source,
    title: 'Marketing digital',
    description: 'Descripción de marketing'
  };
  const status = computeTemplateContentStatus(templateNow, source, 'course');
  assert.equal(status, 'differs_from_approved_source');
});

test('computeDestinationCompatibility: unknown when the source credential cannot be resolved (never invents compatible)', () => {
  const result = computeDestinationCompatibility(
    { title: 'X', description: null, competencies: [], learningOutcomes: [], skills: [], hours: null },
    null,
    'course'
  );
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.changedFields, []);
});

test('computeDestinationCompatibility: THE bug fixed in C4b.0.2 -- matching the CURRENT template must never substitute for matching the real source credential', () => {
  // Escenario obligatorio: fuente = "Introducción a UX"; el template
  // actual (no usado aca) fue editado a "Marketing digital" sin
  // re-aprobar; la credencial destino tambien dice "Marketing digital"
  // (coincide con el template actual, pero NO con la fuente real).
  const source = {
    title: 'Introducción a UX',
    description: 'Descripción de UX',
    competencies: ['Investigación de usuarios'],
    learningOutcomes: [],
    skills: [],
    hours: 20
  };
  const destination = {
    title: 'Marketing digital',
    description: 'Descripción de marketing',
    competencies: ['SEO'],
    learningOutcomes: [],
    skills: [],
    hours: 20
  };

  const result = computeDestinationCompatibility(destination, source, 'course');

  assert.equal(result.status, 'modified');
  assert.ok(result.changedFields.includes('title'));
  assert.ok(result.changedFields.includes('description'));
  assert.ok(result.changedFields.includes('competencies'));
});

test('computeDestinationCompatibility: compatible when destination matches the real source, regardless of hours drift alone', () => {
  const source = {
    title: 'Curso de Python',
    description: 'Desc',
    competencies: ['Python'],
    learningOutcomes: ['Loops'],
    skills: [],
    hours: 20
  };
  const destination = { ...source, hours: 25 };

  const result = computeDestinationCompatibility(destination, source, 'course');

  assert.equal(result.status, 'compatible');
  assert.deepEqual(result.changedFields, ['hours']);
});

test('computeDestinationCompatibility: certification compares skills, never learningOutcomes', () => {
  const source = {
    title: 'Certificación AWS',
    description: 'Desc',
    competencies: ['Cloud'],
    learningOutcomes: ['nunca comparado para certification'],
    skills: ['EC2', 'S3'],
    hours: null
  };
  const destination = {
    ...source,
    learningOutcomes: ['algo completamente distinto'],
    skills: ['EC2']
  };

  const result = computeDestinationCompatibility(destination, source, 'certification');

  assert.equal(result.status, 'modified');
  assert.deepEqual(result.changedFields, ['skills']);
});

test('changedFields never includes excluded fields (modality/certificationCode/providerName/level/platformName/externalUrl)', () => {
  const source = {
    title: 'X',
    description: null,
    competencies: [],
    learningOutcomes: [],
    skills: [],
    hours: null
  };
  const destination = { ...source, title: 'Y' };
  const result = computeDestinationCompatibility(destination, source, 'course');
  const allowlist = ['title', 'description', 'competencies', 'learningOutcomes', 'skills', 'hours'];
  for (const field of result.changedFields) {
    assert.ok(allowlist.includes(field));
  }
});

test('sets comparisons are order-independent and case/whitespace-insensitive', () => {
  const source = {
    title: 'X',
    description: null,
    competencies: ['Scrum', 'Kanban'],
    learningOutcomes: [],
    skills: [],
    hours: null
  };
  const destination = {
    ...source,
    competencies: ['  kanban ', 'SCRUM']
  };
  const result = computeDestinationCompatibility(destination, source, 'course');
  assert.equal(result.status, 'compatible');
});
