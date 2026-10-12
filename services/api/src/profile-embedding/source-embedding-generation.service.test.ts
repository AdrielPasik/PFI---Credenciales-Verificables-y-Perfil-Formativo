import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import {
  PROFILE_EMBEDDING_DIMENSION,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
  PROFILE_EMBEDDING_MODEL_ID,
  PROFILE_EMBEDDING_MODEL_REVISION,
  PROFILE_EMBEDDING_SOURCE_POLICY_VERSION
} from './profile-embedding.contract';
import {
  buildProfileEmbeddingDependencyFingerprint,
  SourceEmbeddingGenerationService
} from './source-embedding-generation.service';

const SHA = 'a'.repeat(64);
const BLOB_SHA = 'b'.repeat(64);
const vector = [1, ...Array.from({ length: 383 }, () => 0)];

test('dependency fingerprint is deterministic and sensitive to every frozen dependency', () => {
  const base = dependencies();
  const baseline = buildProfileEmbeddingDependencyFingerprint(base);
  assert.equal(baseline, buildProfileEmbeddingDependencyFingerprint({ ...base }));

  for (const field of [
    'sourceSha256',
    'sourceArtifactBlobSha256',
    'modelId',
    'modelRevision',
    'embeddingDimension',
    'sourcePolicyVersion',
    'longTextPolicyVersion',
    'longTextPolicySha256'
  ] as const) {
    const changed = {
      ...base,
      [field]:
        field === 'embeddingDimension'
          ? 385
          : field === 'sourceArtifactBlobSha256'
            ? 'c'.repeat(64)
            : `${base[field]}-changed`
    };
    assert.notEqual(baseline, buildProfileEmbeddingDependencyFingerprint(changed), field);
  }
});

test('disabled feature has no source, database, or AI side effects', async (context) => {
  setFlag(context, 'false');
  const harness = createHarness();
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.equal(result.status, 'disabled');
  assert.equal(harness.calls.sourceReads, 0);
  assert.equal(harness.calls.ai, 0);
  assert.equal(harness.calls.create, 0);
});

test('TextEvidence source verifies canonical SHA, creates exactly one immutable embedding', async (context) => {
  setFlag(context, 'true');
  const content = 'Objetivos formativos\nContenido original';
  const harness = createHarness({ textContent: content });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');

  assert.equal(result.status, 'generated');
  assert.equal(harness.calls.ai, 1);
  assert.equal(harness.calls.create, 1);
  assert.equal(harness.calls.embeddingSource, content);
  assert.equal((harness.created?.vector as number[] | undefined)?.length, 384);
  assert.equal(harness.created?.sourceArtifactBlobSha256, null);
  assert.equal(harness.created?.sourcePolicyVersion, PROFILE_EMBEDDING_SOURCE_POLICY_VERSION);
  assert.equal('sourceText' in (harness.created ?? {}), false);
  assert.equal('embeddingSource' in (harness.created ?? {}), false);
});

test('TextEvidence SHA mismatch never calls AI or persists a vector', async (context) => {
  setFlag(context, 'true');
  const harness = createHarness({ textEvidenceSha: 'c'.repeat(64) });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.deepEqual(result, {
    status: 'unavailable', analysisRunSourceId: 'ars-1', dependencyFingerprintSha256: null,
    reasonCode: 'source_sha_mismatch'
  });
  assert.equal(harness.calls.ai, 0);
  assert.equal(harness.calls.create, 0);
});

test('oversized source is not truncated, encoded, or persisted', async (context) => {
  setFlag(context, 'true');
  const harness = createHarness({ textContent: 'x'.repeat(30_001) });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reasonCode, 'source_too_large');
  assert.equal(harness.calls.ai, 0);
  assert.equal(harness.calls.create, 0);
});

test('existing embedding is reused without an AI call', async (context) => {
  setFlag(context, 'true');
  const existing = { ...persistedEmbedding(), sourceSha256: sha('Contenido canónico') };
  const harness = createHarness({ existing });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.equal(result.status, 'reused');
  assert.equal(harness.calls.ai, 0);
  assert.equal(harness.calls.create, 0);
});

test('unique race rereads immutable existing embedding instead of mutating it', async (context) => {
  setFlag(context, 'true');
  const harness = createHarness({
    createError: { code: 'P2002' },
    raced: { ...persistedEmbedding(), sourceSha256: sha('Contenido canónico') }
  });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.equal(result.status, 'reused');
  assert.equal(harness.calls.ai, 1);
  assert.equal(harness.calls.create, 1);
  assert.equal(harness.calls.update, 0);
});

test('AI failure persists no placeholder or zero vector', async (context) => {
  setFlag(context, 'true');
  const harness = createHarness({ aiError: new Error('unavailable') });
  const result = await harness.service.generateForAnalysisRunSource('ars-1');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reasonCode, 'ai_unavailable');
  assert.equal(harness.calls.create, 0);
});

test('PDF uses only a verified extraction slot; an absent slot is unavailable', async (context) => {
  setFlag(context, 'true');
  const absent = createHarness({ sourceType: 'document_evidence', slot: null });
  const absentResult = await absent.service.generateForAnalysisRunSource('ars-1');
  assert.equal(absentResult.reasonCode, 'extraction_unavailable');
  assert.equal(absent.calls.ai, 0);

  const valid = createHarness({ sourceType: 'document_evidence', slot: 'PDF canonical source' });
  const validResult = await valid.service.generateForAnalysisRunSource('ars-1');
  assert.equal(validResult.status, 'generated');
  assert.equal(valid.calls.embeddingSource, 'PDF canonical source');
  assert.equal(valid.created?.sourceArtifactBlobSha256, BLOB_SHA);
});

function dependencies() {
  return {
    analysisRunSourceId: 'ars-1', sourceSha256: SHA, sourceArtifactBlobSha256: null,
    modelId: PROFILE_EMBEDDING_MODEL_ID, modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
    embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
    sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
    longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
    longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256
  };
}

function persistedEmbedding() {
  return {
    id: 'embedding-1', dependencyFingerprintSha256: 'fingerprint',
    ...dependencies(), vector: [...vector]
  };
}

function createHarness(options: {
  sourceType?: 'text_evidence' | 'document_evidence'; textContent?: string;
  textEvidenceSha?: string; existing?: ReturnType<typeof persistedEmbedding>;
  raced?: ReturnType<typeof persistedEmbedding>; createError?: unknown; aiError?: Error;
  slot?: string | null;
} = {}) {
  const calls = { sourceReads: 0, embeddingReads: 0, ai: 0, create: 0, update: 0, embeddingSource: '' };
  const sourceType = options.sourceType ?? 'text_evidence';
  const content = options.textContent ?? 'Contenido canónico';
  const contentSha = sha(content);
  let existingRead = options.existing;
  let created: Record<string, unknown> | undefined;
  const source = sourceType === 'text_evidence'
    ? {
        id: 'ars-1', sourceType, documentEvidenceId: null, textEvidenceId: 'text-1',
        sourceSha256: SHA === contentSha ? SHA : contentSha,
        extractionArtifactCanonicalJson: null, artifactBlobSha256: null, extractionDerivationTrust: null,
        documentEvidence: null,
        textEvidence: { id: 'text-1', content, sha256: options.textEvidenceSha ?? contentSha }
      }
    : {
        id: 'ars-1', sourceType, documentEvidenceId: 'doc-1', textEvidenceId: null,
        sourceSha256: SHA, extractionArtifactCanonicalJson: options.slot === null ? null : '{}',
        artifactBlobSha256: options.slot === null ? null : BLOB_SHA,
        extractionDerivationTrust: options.slot === null ? null : 'PRODUCER_ASSUMED',
        documentEvidence: { id: 'doc-1', sha256: SHA }, textEvidence: null
      };
  if (sourceType === 'text_evidence') source.sourceSha256 = contentSha;

  const prisma = {
    analysisRunSource: { findUnique: async () => { calls.sourceReads += 1; return source; } },
    sourceEmbedding: {
      findUnique: async () => {
        calls.embeddingReads += 1;
        const next = existingRead;
        existingRead = options.raced;
        return next ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.create += 1;
        if (options.createError) throw options.createError;
        created = data;
        return { id: 'created' };
      }
    }
  };
  const ai = {
    encodeProfileEmbeddingSource: async ({ embeddingSource }: { embeddingSource: string }) => {
      calls.ai += 1;
      calls.embeddingSource = embeddingSource;
      if (options.aiError) throw options.aiError;
      return {
        schemaVersion: 'profile_embedding_source_response_v1' as const, vector,
        modelId: PROFILE_EMBEDDING_MODEL_ID, modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
        embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
        sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
        longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
        longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256
      };
    }
  };
  const slots = {
    verifyReadExtractionSlot: (_id: string, raw: { artifactBlobSha256: string | null }) => {
      if (options.slot === null) return null;
      return {
        artifactBlobSha256: raw.artifactBlobSha256 ?? BLOB_SHA,
        artifact: {
          sourceType: 'PDF_DOCUMENT' as const,
          source: { documentEvidenceId: 'doc-1', sourceSha256: SHA },
          documentCanonicalText: options.slot ?? 'PDF canonical source'
        }
      };
    }
  };
  return {
    service: new SourceEmbeddingGenerationService(prisma as never, ai as never, slots as never),
    calls, get created() { return created; }
  };
}

function sha(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function setFlag(context: TestContext, value: string) {
  const previous = process.env.PROFILE_EMBEDDINGS_ENABLED;
  process.env.PROFILE_EMBEDDINGS_ENABLED = value;
  context.after(() => {
    if (previous === undefined) delete process.env.PROFILE_EMBEDDINGS_ENABLED;
    else process.env.PROFILE_EMBEDDINGS_ENABLED = previous;
  });
}
