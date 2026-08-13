import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { CredentialType, SemanticAnalysisStatus } from '@prisma/client';

import {
  assertSemanticAnalysisStatusIsUsable,
  buildApprovedSemanticSnapshotSummary,
  buildApprovedTemplateSemanticSnapshot,
  buildReviewedApprovedTemplateSemanticSnapshot,
  humanSemanticNotes,
  normalizeTitleForComparison,
  readSubjectStringArray,
  readSubjectText,
  resolveReusableCredentialType,
  resolveTemplateTitleFromCredential,
  toJsonObject,
  type SemanticAnalysisForApprovedSnapshot
} from './issuer-course-templates.helpers';

test('toJsonObject returns an empty object for non-object json values', () => {
  assert.deepEqual(toJsonObject(null), {});
  assert.deepEqual(toJsonObject('string' as never), {});
  assert.deepEqual(toJsonObject([1, 2] as never), {});
  assert.deepEqual(toJsonObject({ achievement_name: 'x' }), {
    achievement_name: 'x'
  });
});

test('readSubjectText trims and returns null for missing/blank/non-string values', () => {
  assert.equal(
    readSubjectText({ platform_name: '  Campus Virtual  ' }, 'platform_name'),
    'Campus Virtual'
  );
  assert.equal(readSubjectText({}, 'platform_name'), null);
  assert.equal(readSubjectText({ platform_name: '   ' }, 'platform_name'), null);
  assert.equal(readSubjectText({ platform_name: 42 }, 'platform_name'), null);
});

test('readSubjectStringArray dedupes case-insensitively and drops empty/non-string entries', () => {
  assert.deepEqual(
    readSubjectStringArray(
      { competencies: ['Python', 'python', '  Data  ', '', 42, null] },
      'competencies'
    ),
    ['Python', 'Data']
  );
  assert.deepEqual(readSubjectStringArray({}, 'competencies'), []);
  assert.deepEqual(
    readSubjectStringArray({ competencies: 'not-an-array' }, 'competencies'),
    []
  );
});

test('resolveTemplateTitleFromCredential prioritizes achievement_name over Credential.title', () => {
  const title = resolveTemplateTitleFromCredential(
    { achievement_name: 'Python para Data Science' },
    'Curso de Python (legacy title)'
  );

  assert.equal(title, 'Python para Data Science');
});

test('resolveTemplateTitleFromCredential falls back to Credential.title when achievement_name is absent', () => {
  const title = resolveTemplateTitleFromCredential({}, 'Curso de Python');
  assert.equal(title, 'Curso de Python');
});

test('resolveTemplateTitleFromCredential rejects when neither source has a usable title', () => {
  assert.throws(
    () => resolveTemplateTitleFromCredential({ achievement_name: '   ' }, '   '),
    BadRequestException
  );
});

test('normalizeTitleForComparison trims, collapses whitespace and lowercases', () => {
  assert.equal(
    normalizeTitleForComparison('  Python   para  Data  '),
    'python para data'
  );
  assert.equal(
    normalizeTitleForComparison('Python para Data'),
    normalizeTitleForComparison('  python   PARA   data ')
  );
});

test('readSubjectText reads certification-only keys the same way', () => {
  assert.equal(
    readSubjectText({ certification_code: '  AWS-CCP  ' }, 'certification_code'),
    'AWS-CCP'
  );
  assert.equal(
    readSubjectText({ expiration_date: '2027-01-01' }, 'expiration_date'),
    '2027-01-01'
  );
  assert.equal(
    readSubjectText({ provider_name: 'Instituto Demo' }, 'provider_name'),
    'Instituto Demo'
  );
  assert.equal(readSubjectText({ level: 'Fundamentos' }, 'level'), 'Fundamentos');
});

test('readSubjectStringArray reads skills the same way as competencies/learning_outcomes', () => {
  assert.deepEqual(
    readSubjectStringArray({ skills: ['Cloud', 'cloud', ''] }, 'skills'),
    ['Cloud']
  );
});

test('resolveReusableCredentialType accepts course and certification', () => {
  assert.equal(
    resolveReusableCredentialType(CredentialType.course),
    CredentialType.course
  );
  assert.equal(
    resolveReusableCredentialType(CredentialType.certification),
    CredentialType.certification
  );
});

test('resolveReusableCredentialType rejects academic_subject and degree', () => {
  assert.throws(
    () => resolveReusableCredentialType(CredentialType.academic_subject),
    BadRequestException
  );
  assert.throws(
    () => resolveReusableCredentialType(CredentialType.degree),
    BadRequestException
  );
});

// ---------------------------------------------------------------------------
// C4a.1: buildApprovedTemplateSemanticSnapshot / summary / usability guard.
// ---------------------------------------------------------------------------

function baseSemanticAnalysis(
  overrides: Partial<SemanticAnalysisForApprovedSnapshot> = {}
): SemanticAnalysisForApprovedSnapshot {
  return {
    schemaVersion: 'semantic_analysis_v1',
    status: 'completed',
    areas: [{ id: 'area-1', label: 'Programacion', confidence: 0.9 }],
    skills: [{ id: 'skill-1', label: 'Python', confidence: 0.8 }],
    concepts: [{ id: 'concept-1', label: 'POO', confidence: 0.7 }],
    qualityFlags: ['low_evidence_volume'],
    confidence: 0.85,
    analysisJson: {
      hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
      warnings: ['online_course_catalog_not_completion_evidence']
    },
    ...overrides
  };
}

test('assertSemanticAnalysisStatusIsUsable accepts completed and partial', () => {
  assert.doesNotThrow(() =>
    assertSemanticAnalysisStatusIsUsable(SemanticAnalysisStatus.completed)
  );
  assert.doesNotThrow(() =>
    assertSemanticAnalysisStatusIsUsable(SemanticAnalysisStatus.partial)
  );
});

test('assertSemanticAnalysisStatusIsUsable rejects any other status value', () => {
  assert.throws(
    () =>
      assertSemanticAnalysisStatusIsUsable(
        'failed' as unknown as SemanticAnalysisStatus
      ),
    BadRequestException
  );
});

test('buildApprovedTemplateSemanticSnapshot copies schema/status/allowlisted fields for a completed analysis', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(baseSemanticAnalysis());

  assert.equal(snapshot.schema, 'approved_template_semantic_snapshot_v1');
  assert.equal(snapshot.semanticAnalysisSchema, 'semantic_analysis_v1');
  assert.equal(snapshot.status, 'completed');
  assert.deepEqual(snapshot.areas, [
    { id: 'area-1', label: 'Programacion', confidence: 0.9 }
  ]);
  assert.deepEqual(snapshot.skills, [
    { id: 'skill-1', label: 'Python', confidence: 0.8 }
  ]);
  assert.deepEqual(snapshot.concepts, [
    { id: 'concept-1', label: 'POO', confidence: 0.7 }
  ]);
  assert.deepEqual(snapshot.hoursDistribution, [{ areaId: 'area-1', hours: 12 }]);
  assert.deepEqual(snapshot.warnings, [
    'online_course_catalog_not_completion_evidence'
  ]);
  assert.deepEqual(snapshot.qualityFlags, ['low_evidence_volume']);
  assert.equal(snapshot.confidence, 0.85);
});

test('buildApprovedTemplateSemanticSnapshot approves a partial analysis the same way as completed', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ status: 'partial' })
  );

  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.areas.length, 1);
});

test('buildApprovedTemplateSemanticSnapshot drops malformed descriptor entries silently', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({
      areas: [
        { id: 'area-1', label: 'Programacion', confidence: 0.9 },
        { id: 'area-2' },
        'not-a-record',
        null,
        42
      ] as never
    })
  );

  assert.deepEqual(snapshot.areas, [
    { id: 'area-1', label: 'Programacion', confidence: 0.9 }
  ]);
});

test('buildApprovedTemplateSemanticSnapshot falls back to label as id when id is missing', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({
      skills: [{ label: 'Python', confidence: 0.5 }] as never
    })
  );

  assert.deepEqual(snapshot.skills, [
    { id: 'Python', label: 'Python', confidence: 0.5 }
  ]);
});

test('buildApprovedTemplateSemanticSnapshot reads hoursDistribution from the legacy mapped.metadata fallback path', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({
      analysisJson: {
        mapped: { metadata: { hoursDistribution: [{ areaId: 'area-2', hours: 5 }] } }
      }
    })
  );

  assert.deepEqual(snapshot.hoursDistribution, [{ areaId: 'area-2', hours: 5 }]);
});

test('buildApprovedTemplateSemanticSnapshot tolerates a null analysisJson', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ analysisJson: null })
  );

  assert.deepEqual(snapshot.hoursDistribution, []);
  assert.deepEqual(snapshot.warnings, []);
});

test('buildApprovedTemplateSemanticSnapshot reads a Decimal-like confidence and clamps out-of-range values to null', () => {
  const withDecimalLike = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ confidence: { toString: () => '0.42' } })
  );
  assert.equal(withDecimalLike.confidence, 0.42);

  const outOfRange = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ confidence: 1.5 })
  );
  assert.equal(outOfRange.confidence, null);

  const missing = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ confidence: null })
  );
  assert.equal(missing.confidence, null);
});

test('buildApprovedTemplateSemanticSnapshot never exposes competencies or learningOutcomes keys', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(baseSemanticAnalysis());

  assert.equal('competencies' in snapshot, false);
  assert.equal('learningOutcomes' in snapshot, false);
});

// CRITICO (allowlist estricta): el snapshot NUNCA debe filtrar claves de
// evidencia cruda/interna aunque esten presentes en analysisJson.
test('buildApprovedTemplateSemanticSnapshot never leaks raw/internal keys present in analysisJson', () => {
  const pollutedAnalysisJson = {
    hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
    warnings: ['some_warning'],
    sourceRefs: { documentEvidenceId: 'doc-1', textEvidenceId: 'text-1' },
    evidenceMap: { 'area-1': ['doc-1'] },
    textForEmbedding: 'contenido crudo del pdf...',
    raw: { some: 'thing' },
    debug: { trace: 'x' },
    audit: { actor: 'ai-service' },
    storageKey: 's3://bucket/key',
    path: '/tmp/uploads/file.pdf',
    token: 'secret-token',
    blockchain: { txHash: '0xabc' }
  };

  const snapshot = buildApprovedTemplateSemanticSnapshot(
    baseSemanticAnalysis({ analysisJson: pollutedAnalysisJson })
  );

  const serialized = JSON.stringify(snapshot);
  const forbiddenKeys = [
    'sourceRefs',
    'evidenceMap',
    'textForEmbedding',
    'raw',
    'debug',
    'audit',
    'documentEvidenceId',
    'textEvidenceId',
    'storageKey',
    'path',
    'token',
    'blockchain'
  ];

  for (const key of forbiddenKeys) {
    assert.equal(
      serialized.includes(key),
      false,
      `El snapshot no debe contener la clave prohibida "${key}"`
    );
  }
});

test('C5 builds a v2 issuer-reviewed snapshot without mutating the source analysis', () => {
  const source = baseSemanticAnalysis();
  const snapshot = buildReviewedApprovedTemplateSemanticSnapshot('analysis-1', source, {
    reviewedAreas: [{ label: '  Gestión de proyectos  ' }],
    reviewedSkills: [{ label: 'Scrum' }, { label: 'scrum' }, { label: 'Kanban' }],
    reviewedConcepts: [{ label: 'backlog' }],
    reviewNote: '  Revisión institucional.  '
  });
  assert.equal(snapshot.schema, 'approved_template_semantic_snapshot_v2');
  assert.deepEqual(snapshot.areas.map((item) => item.label), ['Gestión de proyectos']);
  assert.deepEqual(snapshot.skills.map((item) => item.label), ['Scrum', 'Kanban']);
  assert.equal(snapshot.review.note, 'Revisión institucional.');
  assert.deepEqual(source.skills, [{ id: 'skill-1', label: 'Python', confidence: 0.8 }]);
});

test('C5 rejects unsafe reviewed labels and keeps human quality notes free of technical identifiers', () => {
  assert.throws(
    () => buildReviewedApprovedTemplateSemanticSnapshot('analysis-1', baseSemanticAnalysis(), { reviewedAreas: [{ label: '<script>' }] }),
    BadRequestException
  );
  assert.deepEqual(humanSemanticNotes(['area_assignment_low_confidence', 'future_internal_flag']), [
    'La asignación de área tiene confianza baja.',
    'El análisis incluye observaciones técnicas que requieren revisión.'
  ]);
});

test('buildApprovedSemanticSnapshotSummary computes counts from a valid snapshot', () => {
  const snapshot = buildApprovedTemplateSemanticSnapshot(baseSemanticAnalysis());
  const summary = buildApprovedSemanticSnapshotSummary(snapshot);

  assert.deepEqual(summary, {
    schema: 'approved_template_semantic_snapshot_v1',
    status: 'completed',
    areaCount: 1,
    skillCount: 1,
    conceptCount: 1,
    hasHoursDistribution: true,
    warningCount: 1,
    qualityFlagCount: 1
  });
});

test('buildApprovedSemanticSnapshotSummary returns null for null/malformed snapshots', () => {
  assert.equal(buildApprovedSemanticSnapshotSummary(null), null);
  assert.equal(buildApprovedSemanticSnapshotSummary(undefined), null);
  assert.equal(buildApprovedSemanticSnapshotSummary('not-an-object'), null);
  assert.equal(buildApprovedSemanticSnapshotSummary({ schema: 'x' }), null);
});
