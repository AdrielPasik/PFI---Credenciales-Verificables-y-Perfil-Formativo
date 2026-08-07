import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalServerErrorException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  Prisma,
  SemanticAnalysisStatus
} from '@prisma/client';

import {
  issuerAnalysisRunReadSelect,
  mapIssuerAnalysisRunReadModel
} from './issuer-analysis-run-read.mapper';

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    credentialId: 'credential-1',
    status: AnalysisRunStatus.pending,
    inputMode: AnalysisRunInputMode.document,
    trigger: AnalysisRunTrigger.manual,
    requestedPipelineVersion: 'pipeline-v1',
    requestedTaxonomyVersion: 'taxonomy-v1',
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    sources: [{ sourceType: AnalysisRunSourceType.document_evidence }],
    semanticAnalyses: [],
    ...overrides
  } as never;
}

function semantic(overrides: Record<string, unknown> = {}) {
  return {
    id: 'semantic-1',
    status: SemanticAnalysisStatus.completed,
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    confidence: new Prisma.Decimal('0.75'),
    areas: [{ id: 'area-1' }],
    skills: [{ id: 'skill-1' }, { id: 'skill-2' }],
    concepts: [{ id: 'concept-1' }, { id: 'concept-2' }, { id: 'concept-3' }],
    qualityFlags: ['low_coverage'],
    analyzedAt: new Date('2026-08-05T12:05:00.000Z'),
    ...overrides
  };
}

test('select is an explicit allowlist without raw semantic or evidence fields', () => {
  const serialized = JSON.stringify(issuerAnalysisRunReadSelect);
  for (const forbidden of [
    'analysisJson',
    'textForEmbedding',
    'evidenceMap',
    'sourceLabel',
    'documentEvidence',
    'textEvidence',
    'storageKey',
    'storageProvider',
    'requestedBy',
    'errorMessage'
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(
    issuerAnalysisRunReadSelect.semanticAnalyses.orderBy,
    [{ analyzedAt: 'desc' }, { id: 'desc' }]
  );
  assert.equal(issuerAnalysisRunReadSelect.semanticAnalyses.take, 1);
});

test('pending and running runs map timestamps without semantic result', () => {
  const pending = mapIssuerAnalysisRunReadModel(run());
  assert.equal(pending.status, AnalysisRunStatus.pending);
  assert.equal(pending.startedAt, null);
  assert.equal(pending.semanticAnalysis, null);

  const running = mapIssuerAnalysisRunReadModel(run({
    status: AnalysisRunStatus.running,
    startedAt: new Date('2026-08-05T12:01:00.000Z')
  }));
  assert.equal(running.startedAt, '2026-08-05T12:01:00.000Z');
  assert.equal(running.completedAt, null);
  assert.equal(running.semanticAnalysis, null);
});

test('completed run exposes only a derived semantic summary including partial', () => {
  const mapped = mapIssuerAnalysisRunReadModel(run({
    status: AnalysisRunStatus.completed,
    startedAt: new Date('2026-08-05T12:01:00.000Z'),
    completedAt: new Date('2026-08-05T12:05:00.000Z'),
    semanticAnalyses: [semantic({ status: SemanticAnalysisStatus.partial })]
  }));

  assert.equal(mapped.status, AnalysisRunStatus.completed);
  assert.deepEqual(mapped.semanticAnalysis, {
    semanticAnalysisId: 'semantic-1',
    status: SemanticAnalysisStatus.partial,
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    confidence: 0.75,
    areasCount: 1,
    skillsCount: 2,
    conceptsCount: 3,
    qualityFlags: ['low_coverage'],
    analyzedAt: '2026-08-05T12:05:00.000Z'
  });
  const serialized = JSON.stringify(mapped);
  assert.equal(serialized.includes('analysisJson'), false);
  assert.equal(serialized.includes('textForEmbedding'), false);
  assert.equal(serialized.includes('evidenceMap'), false);
});

test('failed runs expose only allowlisted static error details', () => {
  const known = mapIssuerAnalysisRunReadModel(run({
    status: AnalysisRunStatus.failed,
    errorCode: 'ai_timeout',
    errorMessage: 'raw upstream secret URL stack'
  }));
  assert.equal(known.errorCode, 'ai_timeout');
  assert.equal(
    known.errorMessage,
    'El servicio de analisis excedio el tiempo disponible.'
  );

  const unknown = mapIssuerAnalysisRunReadModel(run({
    status: AnalysisRunStatus.failed,
    errorCode: 'raw_internal_code',
    errorMessage: 'raw storage key and token'
  }));
  assert.equal(unknown.errorCode, 'analysis_failed');
  assert.equal(unknown.errorMessage, 'No se pudo completar el analisis.');
  assert.equal(JSON.stringify(unknown).includes('raw'), false);
});

test('new AI failure codes expose allowlisted diagnostic messages only', () => {
  const cases: Array<[string, string]> = [
    ['ai_input_rejected', 'La evidencia no pudo procesarse automaticamente.'],
    ['ai_endpoint_not_found', 'El servicio de analisis no respondio en la ruta esperada.'],
    ['ai_version_conflict', 'El servicio de analisis no esta alineado con la version solicitada.'],
    ['ai_input_too_large', 'La evidencia supera el tamano permitido para analisis.'],
    ['ai_dependency_unavailable', 'El servicio de analisis no tiene disponible una dependencia necesaria.'],
    ['ai_invalid_response', 'El servicio de analisis devolvio una respuesta no valida.'],
    ['ai_invalid_configuration', 'La configuracion del servicio de analisis no es valida.'],
    ['ai_network_unreachable', 'No se pudo conectar con el servicio de analisis.']
  ];

  for (const [errorCode, errorMessage] of cases) {
    const mapped = mapIssuerAnalysisRunReadModel(run({
      status: AnalysisRunStatus.failed,
      errorCode,
      errorMessage: 'https://internal.example/path token=secret storageKey=private'
    }));
    assert.equal(mapped.errorCode, errorCode);
    assert.equal(mapped.errorMessage, errorMessage);
    assert.equal(JSON.stringify(mapped).includes('internal.example'), false);
    assert.equal(JSON.stringify(mapped).includes('secret'), false);
    assert.equal(JSON.stringify(mapped).includes('storageKey'), false);
  }
});

test('non-failed runs never expose stale persisted error fields', () => {
  const mapped = mapIssuerAnalysisRunReadModel(run({
    status: AnalysisRunStatus.completed,
    errorCode: 'ai_timeout',
    errorMessage: 'stale error'
  }));
  assert.equal(mapped.errorCode, null);
  assert.equal(mapped.errorMessage, null);
});

test('invalid semantic arrays, flags or confidence fail safely', () => {
  for (const invalidSemantic of [
    semantic({ areas: { secret: true } }),
    semantic({ qualityFlags: ['valid', { raw: true }] }),
    semantic({ confidence: new Prisma.Decimal('1.5') })
  ]) {
    assert.throws(
      () => mapIssuerAnalysisRunReadModel(run({
        status: AnalysisRunStatus.completed,
        semanticAnalyses: [invalidSemantic]
      })),
      (error: unknown) => {
        assert.ok(error instanceof InternalServerErrorException);
        assert.equal(
          JSON.stringify(error.getResponse()).includes('secret'),
          false
        );
        return true;
      }
    );
  }
});
