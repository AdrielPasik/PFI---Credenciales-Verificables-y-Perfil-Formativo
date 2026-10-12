import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProfileEmbeddingComponentStatus,
  ProfileEmbeddingCoverageStatus
} from '@prisma/client';

import {
  composeProfileEmbeddingVector,
  determineProfileEmbeddingCoverage,
  ProfileEmbeddingCompositionError,
  ProfileEmbeddingCompositionService,
  sortProfileEmbeddingComponents,
  validateProfileEmbeddingSourceVector
} from './profile-embedding-composition.service';
import {
  PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION,
  PROFILE_EMBEDDING_DIMENSION,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
  PROFILE_EMBEDDING_MODEL_ID,
  PROFILE_EMBEDDING_MODEL_REVISION,
  PROFILE_EMBEDDING_SOURCE_POLICY_VERSION
} from './profile-embedding.contract';

function unitVector(index = 0): number[] {
  const vector = new Array<number>(PROFILE_EMBEDDING_DIMENSION).fill(0);
  vector[index] = 1;
  return vector;
}

function sourceEmbedding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'embedding-1',
    analysisRunSourceId: 'source-1',
    sourceSha256: 'a'.repeat(64),
    modelId: PROFILE_EMBEDDING_MODEL_ID,
    modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
    embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
    sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
    longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
    longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
    vector: unitVector(),
    ...overrides
  };
}

function persistedEmbedding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-embedding-1',
    formativeProfileId: 'profile-1',
    modelId: PROFILE_EMBEDDING_MODEL_ID,
    modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
    embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
    sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
    longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
    longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
    compositionPolicyVersion: PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION,
    vector: unitVector(),
    coverageStatus: ProfileEmbeddingCoverageStatus.COMPLETE,
    totalExpectedSources: 1,
    includedSourceCount: 1,
    unavailableSourceCount: 0,
    ...overrides
  };
}

function profileJson(credentialIds = ['credential-1'], semanticAnalysisIds = ['analysis-1']) {
  return { generatedFrom: { credentialIds, semanticAnalysisIds } };
}

function setupComposition(options: {
  profileJson?: unknown;
  analyses?: Array<Record<string, unknown>>;
  sources?: Array<Record<string, unknown>>;
  existing?: Record<string, unknown> | null;
} = {}) {
  const creates: Array<Record<string, unknown>> = [];
  let existing = options.existing ?? null;
  const prisma = {
    formativeProfileEmbedding: {
      async findUnique() {
        return existing;
      }
    },
    formativeProfile: {
      async findUnique() {
        return { id: 'profile-1', profileJson: options.profileJson ?? profileJson() };
      }
    },
    semanticAnalysis: {
      async findMany(args: { where?: { id?: { in?: string[] } } }) {
        const rows = options.analyses ?? [
          { id: 'analysis-1', credentialId: 'credential-1', analysisRunId: 'run-1' }
        ];
        const ids = args.where?.id?.in;
        return ids ? rows.filter((row) => ids.includes(row.id as string)) : rows;
      }
    },
    analysisRunSource: {
      async findMany() {
        return options.sources ?? [
          {
            id: 'source-1',
            analysisRunId: 'run-1',
            sourceSha256: 'a'.repeat(64),
            sourceEmbeddings: [sourceEmbedding()]
          }
        ];
      }
    },
    async $transaction(callback: (transaction: unknown) => Promise<unknown>) {
      return callback({
        formativeProfileEmbedding: {
          async findUnique() {
            return existing;
          },
          async create(args: { data: Record<string, unknown> }) {
            creates.push(args);
            existing = persistedEmbedding({
              id: 'profile-embedding-created',
              coverageStatus: args.data.coverageStatus,
              vector: args.data.vector,
              includedSourceCount: args.data.includedSourceCount
            });
            return existing;
          }
        }
      });
    }
  };
  return {
    service: new ProfileEmbeddingCompositionService(prisma as never),
    creates
  };
}

test('composition of one normalized source keeps its direction and normalization', () => {
  const result = composeProfileEmbeddingVector([unitVector(7)]);
  assert.deepEqual(result, unitVector(7));
  assert.equal(validateProfileEmbeddingSourceVector(result), true);
});

test('composition uses the normalized equal-weight raw mean for orthogonal vectors', () => {
  const result = composeProfileEmbeddingVector([unitVector(0), unitVector(1)]);
  assert.ok(Math.abs(result[0]! - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(result[1]! - Math.SQRT1_2) < 1e-12);
  assert.equal(validateProfileEmbeddingSourceVector(result), true);
});

test('composition is arithmetic order invariant for more than two vectors', () => {
  const forward = composeProfileEmbeddingVector([unitVector(0), unitVector(1), unitVector(2)]);
  const reverse = composeProfileEmbeddingVector([unitVector(2), unitVector(1), unitVector(0)]);
  assert.deepEqual(forward, reverse);
});

test('invalid vectors are rejected and a zero aggregate fails closed', () => {
  assert.equal(validateProfileEmbeddingSourceVector([...unitVector(0), 0]), false);
  assert.throws(
    () => composeProfileEmbeddingVector([unitVector(0), unitVector(0).map((value) => -value)]),
    (error: unknown) =>
      error instanceof ProfileEmbeddingCompositionError && error.reasonCode === 'aggregate_zero_norm'
  );
});

test('coverage excludes duplicates from expected and unavailable counts', () => {
  const coverage = determineProfileEmbeddingCoverage([
    { status: ProfileEmbeddingComponentStatus.INCLUDED },
    { status: ProfileEmbeddingComponentStatus.DUPLICATE },
    { status: ProfileEmbeddingComponentStatus.UNAVAILABLE }
  ]);
  assert.deepEqual(coverage, {
    coverageStatus: ProfileEmbeddingCoverageStatus.PARTIAL,
    totalExpectedSources: 2,
    includedSourceCount: 1,
    unavailableSourceCount: 1
  });
  assert.equal(
    determineProfileEmbeddingCoverage([]).coverageStatus,
    ProfileEmbeddingCoverageStatus.UNAVAILABLE
  );
});

test('components use credential, source SHA, and source id ordering with nulls last', () => {
  const ordered = sortProfileEmbeddingComponents([
    { credentialId: 'credential-b', sourceSha256: null, analysisRunSourceId: null },
    { credentialId: 'credential-a', sourceSha256: null, analysisRunSourceId: null },
    { credentialId: 'credential-b', sourceSha256: 'b', analysisRunSourceId: 'source-2' },
    { credentialId: 'credential-b', sourceSha256: 'a', analysisRunSourceId: 'source-1' }
  ] as never);
  assert.deepEqual(
    ordered.map((component) => [component.credentialId, component.sourceSha256, component.analysisRunSourceId]),
    [
      ['credential-a', null, null],
      ['credential-b', 'a', 'source-1'],
      ['credential-b', 'b', 'source-2'],
      ['credential-b', null, null]
    ]
  );
});

test('service persists an exact profile snapshot artifact with one source component', async () => {
  const { service, creates } = setupComposition();
  const result = await service.composeForFormativeProfile('profile-1');

  assert.deepEqual(result, {
    status: 'created',
    formativeProfileEmbeddingId: 'profile-embedding-created',
    coverageStatus: ProfileEmbeddingCoverageStatus.COMPLETE
  });
  assert.equal(creates.length, 1);
  const data = creates[0]!.data as Record<string, unknown>;
  assert.equal(data.formativeProfileId, 'profile-1');
  assert.equal(data.compositionPolicyVersion, 'profile_embedding_composition_v1');
  assert.equal((data.vector as number[]).length, 384);
  const components = (data.components as { create: Array<Record<string, unknown>> }).create;
  assert.deepEqual(components, [
    {
      ordinal: 0,
      credentialId: 'credential-1',
      analysisRunSourceId: 'source-1',
      sourceEmbeddingId: 'embedding-1',
      status: ProfileEmbeddingComponentStatus.INCLUDED,
      reasonCode: null
    }
  ]);
});

test('service uses the semantic analysis frozen in the profile snapshot, not a current credential query', async () => {
  const { service, creates } = setupComposition({
    profileJson: profileJson(['credential-1'], ['analysis-frozen']),
    analyses: [
      { id: 'analysis-frozen', credentialId: 'credential-1', analysisRunId: 'run-frozen' },
      { id: 'analysis-newer', credentialId: 'credential-1', analysisRunId: 'run-newer' }
    ],
    sources: [
      {
        id: 'source-frozen',
        analysisRunId: 'run-frozen',
        sourceSha256: 'b'.repeat(64),
        sourceEmbeddings: [sourceEmbedding({ id: 'embedding-frozen', analysisRunSourceId: 'source-frozen', sourceSha256: 'b'.repeat(64) })]
      }
    ]
  });

  await service.composeForFormativeProfile('profile-1');
  const components = ((creates[0]!.data as Record<string, unknown>).components as {
    create: Array<Record<string, unknown>>;
  }).create;
  assert.equal(components[0]!.analysisRunSourceId, 'source-frozen');
});

test('duplicate canonical sources contribute exactly once while preserving both provenance components', async () => {
  const sha = 'c'.repeat(64);
  const { service, creates } = setupComposition({
    profileJson: profileJson(['credential-b', 'credential-a'], ['analysis-a', 'analysis-b']),
    analyses: [
      { id: 'analysis-a', credentialId: 'credential-a', analysisRunId: 'run-a' },
      { id: 'analysis-b', credentialId: 'credential-b', analysisRunId: 'run-b' }
    ],
    sources: [
      { id: 'source-a', analysisRunId: 'run-a', sourceSha256: sha, sourceEmbeddings: [sourceEmbedding({ id: 'embedding-a', analysisRunSourceId: 'source-a', sourceSha256: sha })] },
      { id: 'source-b', analysisRunId: 'run-b', sourceSha256: sha, sourceEmbeddings: [sourceEmbedding({ id: 'embedding-b', analysisRunSourceId: 'source-b', sourceSha256: sha })] }
    ]
  });

  const result = await service.composeForFormativeProfile('profile-1');
  assert.equal(result.coverageStatus, ProfileEmbeddingCoverageStatus.COMPLETE);
  const data = creates[0]!.data as Record<string, unknown>;
  assert.equal(data.totalExpectedSources, 1);
  assert.equal(data.includedSourceCount, 1);
  assert.equal(data.unavailableSourceCount, 0);
  assert.deepEqual(
    ((data.components as { create: Array<Record<string, unknown>> }).create).map((component) => component.status),
    [ProfileEmbeddingComponentStatus.INCLUDED, ProfileEmbeddingComponentStatus.DUPLICATE]
  );
});

test('missing, incompatible and invalid sources persist explicit partial coverage', async () => {
  const { service, creates } = setupComposition({
    profileJson: profileJson(
      ['credential-a', 'credential-b', 'credential-c', 'credential-d'],
      ['analysis-a', 'analysis-b', 'analysis-c', 'analysis-d']
    ),
    analyses: [
      { id: 'analysis-a', credentialId: 'credential-a', analysisRunId: 'run-a' },
      { id: 'analysis-b', credentialId: 'credential-b', analysisRunId: 'run-b' },
      { id: 'analysis-c', credentialId: 'credential-c', analysisRunId: 'run-c' },
      { id: 'analysis-d', credentialId: 'credential-d', analysisRunId: 'run-d' }
    ],
    sources: [
      { id: 'source-a', analysisRunId: 'run-a', sourceSha256: 'a'.repeat(64), sourceEmbeddings: [sourceEmbedding({ analysisRunSourceId: 'source-a', sourceSha256: 'a'.repeat(64) })] },
      { id: 'source-b', analysisRunId: 'run-b', sourceSha256: 'b'.repeat(64), sourceEmbeddings: [] },
      { id: 'source-c', analysisRunId: 'run-c', sourceSha256: 'c'.repeat(64), sourceEmbeddings: [sourceEmbedding({ analysisRunSourceId: 'source-c', sourceSha256: 'c'.repeat(64), modelId: 'other' })] },
      { id: 'source-d', analysisRunId: 'run-d', sourceSha256: 'd'.repeat(64), sourceEmbeddings: [sourceEmbedding({ analysisRunSourceId: 'source-d', sourceSha256: 'd'.repeat(64), vector: new Array(384).fill(0) })] }
    ]
  });

  const result = await service.composeForFormativeProfile('profile-1');
  assert.equal(result.coverageStatus, ProfileEmbeddingCoverageStatus.PARTIAL);
  const data = creates[0]!.data as Record<string, unknown>;
  assert.equal(data.totalExpectedSources, 4);
  assert.equal(data.includedSourceCount, 1);
  assert.equal(data.unavailableSourceCount, 3);
  assert.deepEqual(
    ((data.components as { create: Array<Record<string, unknown>> }).create).map((component) => component.status),
    [
      ProfileEmbeddingComponentStatus.INCLUDED,
      ProfileEmbeddingComponentStatus.UNAVAILABLE,
      ProfileEmbeddingComponentStatus.INCOMPATIBLE,
      ProfileEmbeddingComponentStatus.INVALID
    ]
  );
});

test('a snapshot credential represented only by reviewed semantics is unavailable rather than guessing an original source', async () => {
  const { service, creates } = setupComposition({
    profileJson: profileJson(['credential-reviewed'], [])
  });
  const result = await service.composeForFormativeProfile('profile-1');
  assert.equal(result.coverageStatus, ProfileEmbeddingCoverageStatus.UNAVAILABLE);
  const data = creates[0]!.data as Record<string, unknown>;
  assert.deepEqual(data.vector, []);
  assert.equal(data.includedSourceCount, 0);
  const component = ((data.components as { create: Array<Record<string, unknown>> }).create)[0]!;
  assert.equal(component.status, ProfileEmbeddingComponentStatus.UNAVAILABLE);
  assert.equal(component.reasonCode, 'no_ai_inferred_semantic_analysis_in_profile_snapshot');
});

test('repeated composition returns a valid existing immutable artifact without creating a replacement', async () => {
  const { service, creates } = setupComposition({ existing: persistedEmbedding() });
  const result = await service.composeForFormativeProfile('profile-1');
  assert.equal(result.status, 'existing');
  assert.equal(creates.length, 0);
});

test('distinct historical profile snapshots receive separate immutable embeddings', async () => {
  const artifacts = new Map<string, Record<string, unknown>>();
  const profileById = new Map([
    ['profile-a', { id: 'profile-a', profileJson: profileJson(['credential-a'], ['analysis-a']) }],
    ['profile-b', { id: 'profile-b', profileJson: profileJson(['credential-b'], ['analysis-b']) }]
  ]);
  const prisma = {
    formativeProfileEmbedding: {
      async findUnique(args: { where: { formativeProfileId: string } }) {
        return artifacts.get(args.where.formativeProfileId) ?? null;
      }
    },
    formativeProfile: {
      async findUnique(args: { where: { id: string } }) {
        return profileById.get(args.where.id) ?? null;
      }
    },
    semanticAnalysis: {
      async findMany(args: { where: { id: { in: string[] } } }) {
        return args.where.id.in.map((id) => ({
          id,
          credentialId: id === 'analysis-a' ? 'credential-a' : 'credential-b',
          analysisRunId: id === 'analysis-a' ? 'run-a' : 'run-b'
        }));
      }
    },
    analysisRunSource: {
      async findMany(args: { where: { analysisRunId: { in: string[] } } }) {
        return args.where.analysisRunId.in.map((runId) => {
          const isA = runId === 'run-a';
          const sourceId = isA ? 'source-a' : 'source-b';
          const sha = isA ? 'a'.repeat(64) : 'b'.repeat(64);
          return {
            id: sourceId,
            analysisRunId: runId,
            sourceSha256: sha,
            sourceEmbeddings: [sourceEmbedding({
              id: `embedding-${isA ? 'a' : 'b'}`,
              analysisRunSourceId: sourceId,
              sourceSha256: sha,
              vector: unitVector(isA ? 0 : 1)
            })]
          };
        });
      }
    },
    async $transaction(callback: (transaction: unknown) => Promise<unknown>) {
      return callback({
        formativeProfileEmbedding: {
          async findUnique(args: { where: { formativeProfileId: string } }) {
            return artifacts.get(args.where.formativeProfileId) ?? null;
          },
          async create(args: { data: Record<string, unknown> }) {
            const data = args.data;
            const profileId = data.formativeProfileId as string;
            const artifact = persistedEmbedding({
              id: `artifact-${profileId}`,
              formativeProfileId: profileId,
              vector: data.vector,
              coverageStatus: data.coverageStatus,
              includedSourceCount: data.includedSourceCount
            });
            artifacts.set(profileId, artifact);
            return artifact;
          }
        }
      });
    }
  };
  const service = new ProfileEmbeddingCompositionService(prisma as never);
  await service.composeForFormativeProfile('profile-a');
  const firstVector = [...(artifacts.get('profile-a')!.vector as number[])];
  await service.composeForFormativeProfile('profile-b');

  assert.deepEqual(artifacts.get('profile-a')!.vector, firstVector);
  assert.deepEqual(artifacts.get('profile-b')!.vector, unitVector(1));
  assert.notEqual(artifacts.get('profile-a')!.id, artifacts.get('profile-b')!.id);
});
