import {
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  ProfileEmbeddingComponentStatus,
  ProfileEmbeddingCoverageStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION,
  PROFILE_EMBEDDING_DIMENSION,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
  PROFILE_EMBEDDING_MODEL_ID,
  PROFILE_EMBEDDING_MODEL_REVISION,
  PROFILE_EMBEDDING_SOURCE_POLICY_VERSION
} from './profile-embedding.contract';

const NORMALIZATION_TOLERANCE = 1e-4;

type SourceEmbeddingRow = {
  id: string;
  analysisRunSourceId: string;
  sourceSha256: string;
  modelId: string;
  modelRevision: string;
  embeddingDimension: number;
  sourcePolicyVersion: string;
  longTextPolicyVersion: string;
  longTextPolicySha256: string;
  vector: number[];
};

type ResolvedComponent = {
  credentialId: string;
  analysisRunSourceId: string | null;
  sourceEmbeddingId: string | null;
  sourceSha256: string | null;
  status: ProfileEmbeddingComponentStatus;
  reasonCode: string | null;
  vector: number[] | null;
  duplicateIdentity: string | null;
};

export type ProfileEmbeddingCompositionResult = {
  readonly status: 'created' | 'existing';
  readonly formativeProfileEmbeddingId: string;
  readonly coverageStatus: ProfileEmbeddingCoverageStatus;
};

export type ProfileEmbeddingCoverage = {
  readonly coverageStatus: ProfileEmbeddingCoverageStatus;
  readonly totalExpectedSources: number;
  readonly includedSourceCount: number;
  readonly unavailableSourceCount: number;
};

/**
 * The persisted source artifact is independently validated before it can
 * influence an aggregate. `Float[]` data can be corrupted outside application
 * code, therefore V1-E does not trust prior source-generation validation.
 */
export function validateProfileEmbeddingSourceVector(
  vector: readonly number[]
): boolean {
  if (vector.length !== PROFILE_EMBEDDING_DIMENSION) return false;
  let squaredNorm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return false;
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  return Number.isFinite(norm) && norm > 0 && Math.abs(norm - 1) <= NORMALIZATION_TOLERANCE;
}

/** Equal-weight raw mean, followed by one final L2 normalization. */
export function composeProfileEmbeddingVector(
  vectors: readonly (readonly number[])[]
): number[] {
  if (vectors.length === 0) {
    throw new ProfileEmbeddingCompositionError('no_included_source_vectors');
  }

  const mean = new Array<number>(PROFILE_EMBEDDING_DIMENSION).fill(0);
  for (const vector of vectors) {
    if (!validateProfileEmbeddingSourceVector(vector)) {
      throw new ProfileEmbeddingCompositionError('invalid_included_source_vector');
    }
    for (let index = 0; index < PROFILE_EMBEDDING_DIMENSION; index += 1) {
      mean[index] += vector[index] as number;
    }
  }
  for (let index = 0; index < PROFILE_EMBEDDING_DIMENSION; index += 1) {
    mean[index] /= vectors.length;
  }

  const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    // Do not manufacture an arbitrary direction when valid source vectors
    // cancel exactly. The caller handles this as a best-effort failure.
    throw new ProfileEmbeddingCompositionError('aggregate_zero_norm');
  }
  const result = mean.map((value) => value / norm);
  if (!validateProfileEmbeddingSourceVector(result)) {
    throw new ProfileEmbeddingCompositionError('invalid_composed_vector');
  }
  return result;
}

/**
 * Duplicates represent the same original frozen source under the exact frozen
 * representation policy. It intentionally excludes credential/run identity:
 * those may differ while the formative source is the same.
 */
export function profileEmbeddingDuplicateIdentity(sourceSha256: string): string {
  return [
    sourceSha256.toLowerCase(),
    PROFILE_EMBEDDING_MODEL_ID,
    PROFILE_EMBEDDING_MODEL_REVISION,
    PROFILE_EMBEDDING_DIMENSION,
    PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
    PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
    PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256
  ].join('|');
}

export function determineProfileEmbeddingCoverage(
  components: readonly Pick<ResolvedComponent, 'status'>[]
): ProfileEmbeddingCoverage {
  const includedSourceCount = components.filter(
    (component) => component.status === ProfileEmbeddingComponentStatus.INCLUDED
  ).length;
  // DUPLICATE is already represented by the earlier INCLUDED component and is
  // therefore intentionally excluded from expected/unavailable counts.
  const unavailableStatuses = new Set<ProfileEmbeddingComponentStatus>([
    ProfileEmbeddingComponentStatus.UNAVAILABLE,
    ProfileEmbeddingComponentStatus.INVALID,
    ProfileEmbeddingComponentStatus.INCOMPATIBLE
  ]);
  const unavailableSourceCount = components.filter((component) =>
    unavailableStatuses.has(component.status)
  ).length;
  const totalExpectedSources = includedSourceCount + unavailableSourceCount;
  const coverageStatus =
    includedSourceCount === 0
      ? ProfileEmbeddingCoverageStatus.UNAVAILABLE
      : unavailableSourceCount === 0
        ? ProfileEmbeddingCoverageStatus.COMPLETE
        : ProfileEmbeddingCoverageStatus.PARTIAL;

  return {
    coverageStatus,
    totalExpectedSources,
    includedSourceCount,
    unavailableSourceCount
  };
}

function compareNullableStrings(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

export function sortProfileEmbeddingComponents(
  components: readonly ResolvedComponent[]
): ResolvedComponent[] {
  return [...components].sort((left, right) => {
    const credential = compareNullableStrings(left.credentialId, right.credentialId);
    if (credential !== 0) return credential;
    const sourceSha = compareNullableStrings(left.sourceSha256, right.sourceSha256);
    if (sourceSha !== 0) return sourceSha;
    return compareNullableStrings(left.analysisRunSourceId, right.analysisRunSourceId);
  });
}

function isCompatibleSourceEmbedding(row: SourceEmbeddingRow): boolean {
  return (
    row.modelId === PROFILE_EMBEDDING_MODEL_ID &&
    row.modelRevision === PROFILE_EMBEDDING_MODEL_REVISION &&
    row.embeddingDimension === PROFILE_EMBEDDING_DIMENSION &&
    row.sourcePolicyVersion === PROFILE_EMBEDDING_SOURCE_POLICY_VERSION &&
    row.longTextPolicyVersion === PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION &&
    row.longTextPolicySha256 === PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256
  );
}

function readSnapshotCredentialIds(profileJson: unknown): string[] {
  if (!isRecord(profileJson) || !isRecord(profileJson.generatedFrom)) return [];
  return uniqueStrings(profileJson.generatedFrom.credentialIds);
}

function readSnapshotSemanticAnalysisIds(profileJson: unknown): string[] {
  if (!isRecord(profileJson) || !isRecord(profileJson.generatedFrom)) return [];
  return uniqueStrings(profileJson.generatedFrom.semanticAnalysisIds);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))]
    .sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Composition never reads source text or calls a model. Its source identity is
 * frozen by `FormativeProfile.profileJson.generatedFrom`:
 *
 * - each snapshot credential is expected once;
 * - an ai-inferred credential must have exactly one stored selected
 *   SemanticAnalysis ID, which must point to exactly one AnalysisRunSource;
 * - a credential represented only by an issuer-reviewed semantic snapshot is
 *   UNAVAILABLE. That snapshot deliberately does not retain a credential-local
 *   original source identity, and choosing a current/latest source would make
 *   the historical profile ambiguous.
 */
@Injectable()
export class ProfileEmbeddingCompositionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async composeForFormativeProfile(
    formativeProfileId: string
  ): Promise<ProfileEmbeddingCompositionResult> {
    const existing = await this.prisma.formativeProfileEmbedding.findUnique({
      where: { formativeProfileId }
    });
    if (existing) {
      this.assertExistingArtifact(existing);
      return {
        status: 'existing',
        formativeProfileEmbeddingId: existing.id,
        coverageStatus: existing.coverageStatus
      };
    }

    const profile = await this.prisma.formativeProfile.findUnique({
      where: { id: formativeProfileId },
      select: { id: true, profileJson: true }
    });
    if (!profile) {
      throw new NotFoundException(`FormativeProfile ${formativeProfileId} not found`);
    }

    const components = await this.resolveComponents(profile.profileJson);
    const ordered = sortProfileEmbeddingComponents(components);
    const seenDuplicateIdentities = new Set<string>();
    for (const component of ordered) {
      if (
        component.status === ProfileEmbeddingComponentStatus.INCLUDED &&
        component.duplicateIdentity
      ) {
        if (seenDuplicateIdentities.has(component.duplicateIdentity)) {
          component.status = ProfileEmbeddingComponentStatus.DUPLICATE;
          component.reasonCode = 'duplicate_canonical_source';
          component.vector = null;
        } else {
          seenDuplicateIdentities.add(component.duplicateIdentity);
        }
      }
    }

    const coverage = determineProfileEmbeddingCoverage(ordered);
    const vector =
      coverage.includedSourceCount === 0
        ? []
        : composeProfileEmbeddingVector(
            ordered
              .filter(
                (component) => component.status === ProfileEmbeddingComponentStatus.INCLUDED
              )
              .map((component) => component.vector as number[])
          );

    const created = await this.createIdempotently({
      formativeProfileId: profile.id,
      vector,
      coverage,
      components: ordered
    });
    return created;
  }

  private async resolveComponents(profileJson: unknown): Promise<ResolvedComponent[]> {
    const credentialIds = readSnapshotCredentialIds(profileJson);
    const semanticAnalysisIds = readSnapshotSemanticAnalysisIds(profileJson);
    if (credentialIds.length === 0) return [];

    const analyses = semanticAnalysisIds.length
      ? await this.prisma.semanticAnalysis.findMany({
          where: { id: { in: semanticAnalysisIds } },
          select: { id: true, credentialId: true, analysisRunId: true }
        })
      : [];
    const analysesByCredential = new Map<string, typeof analyses>();
    for (const analysis of analyses) {
      if (!credentialIds.includes(analysis.credentialId)) continue;
      const entries = analysesByCredential.get(analysis.credentialId) ?? [];
      entries.push(analysis);
      analysesByCredential.set(analysis.credentialId, entries);
    }

    const runIds = [...new Set(analyses.map((analysis) => analysis.analysisRunId).filter(
      (runId): runId is string => typeof runId === 'string'
    ))];
    const sources = runIds.length
      ? await this.prisma.analysisRunSource.findMany({
          where: { analysisRunId: { in: runIds } },
          select: {
            id: true,
            analysisRunId: true,
            sourceSha256: true,
            sourceEmbeddings: {
              select: {
                id: true,
                analysisRunSourceId: true,
                sourceSha256: true,
                modelId: true,
                modelRevision: true,
                embeddingDimension: true,
                sourcePolicyVersion: true,
                longTextPolicyVersion: true,
                longTextPolicySha256: true,
                vector: true
              }
            }
          }
        })
      : [];
    const sourcesByRun = new Map<string, typeof sources>();
    for (const source of sources) {
      const entries = sourcesByRun.get(source.analysisRunId) ?? [];
      entries.push(source);
      sourcesByRun.set(source.analysisRunId, entries);
    }

    return credentialIds.map((credentialId) => {
      const credentialAnalyses = analysesByCredential.get(credentialId) ?? [];
      if (credentialAnalyses.length === 0) {
        return this.unavailable(credentialId, 'no_ai_inferred_semantic_analysis_in_profile_snapshot');
      }
      if (credentialAnalyses.length !== 1) {
        return this.unavailable(credentialId, 'ambiguous_snapshot_semantic_analysis');
      }
      const analysis = credentialAnalyses[0] as (typeof analyses)[number];
      if (!analysis.analysisRunId) {
        return this.unavailable(credentialId, 'semantic_analysis_without_analysis_run');
      }
      const runSources = sourcesByRun.get(analysis.analysisRunId) ?? [];
      if (runSources.length === 0) {
        return this.unavailable(credentialId, 'analysis_run_source_unavailable');
      }
      if (runSources.length !== 1) {
        return this.unavailable(credentialId, 'ambiguous_analysis_run_sources');
      }
      return this.resolveSourceEmbeddingComponent(
        credentialId,
        runSources[0] as (typeof sources)[number]
      );
    });
  }

  private resolveSourceEmbeddingComponent(
    credentialId: string,
    source: {
      id: string;
      sourceSha256: string;
      sourceEmbeddings: SourceEmbeddingRow[];
    }
  ): ResolvedComponent {
    const base = {
      credentialId,
      analysisRunSourceId: source.id,
      sourceSha256: source.sourceSha256,
      duplicateIdentity: null
    };
    const embeddings = source.sourceEmbeddings ?? [];
    if (embeddings.length === 0) {
      return { ...base, sourceEmbeddingId: null, status: ProfileEmbeddingComponentStatus.UNAVAILABLE, reasonCode: 'source_embedding_unavailable', vector: null };
    }
    const compatible = embeddings.filter((embedding) => isCompatibleSourceEmbedding(embedding));
    if (compatible.length === 0) {
      return { ...base, sourceEmbeddingId: null, status: ProfileEmbeddingComponentStatus.INCOMPATIBLE, reasonCode: 'source_embedding_incompatible', vector: null };
    }
    if (compatible.length !== 1) {
      return { ...base, sourceEmbeddingId: null, status: ProfileEmbeddingComponentStatus.INVALID, reasonCode: 'multiple_compatible_source_embeddings', vector: null };
    }
    const embedding = compatible[0] as SourceEmbeddingRow;
    if (
      embedding.analysisRunSourceId !== source.id ||
      embedding.sourceSha256.toLowerCase() !== source.sourceSha256.toLowerCase() ||
      !validateProfileEmbeddingSourceVector(embedding.vector)
    ) {
      return { ...base, sourceEmbeddingId: embedding.id, status: ProfileEmbeddingComponentStatus.INVALID, reasonCode: 'invalid_source_embedding_vector_or_identity', vector: null };
    }
    return {
      ...base,
      sourceEmbeddingId: embedding.id,
      status: ProfileEmbeddingComponentStatus.INCLUDED,
      reasonCode: null,
      vector: [...embedding.vector],
      duplicateIdentity: profileEmbeddingDuplicateIdentity(source.sourceSha256)
    };
  }

  private unavailable(credentialId: string, reasonCode: string): ResolvedComponent {
    return {
      credentialId,
      analysisRunSourceId: null,
      sourceEmbeddingId: null,
      sourceSha256: null,
      status: ProfileEmbeddingComponentStatus.UNAVAILABLE,
      reasonCode,
      vector: null,
      duplicateIdentity: null
    };
  }

  private async createIdempotently(input: {
    formativeProfileId: string;
    vector: number[];
    coverage: ProfileEmbeddingCoverage;
    components: ResolvedComponent[];
  }): Promise<ProfileEmbeddingCompositionResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.formativeProfileEmbedding.findUnique({
          where: { formativeProfileId: input.formativeProfileId }
        });
        if (existing) {
          this.assertExistingArtifact(existing);
          return {
            status: 'existing' as const,
            formativeProfileEmbeddingId: existing.id,
            coverageStatus: existing.coverageStatus
          };
        }
        const created = await transaction.formativeProfileEmbedding.create({
          data: {
            formativeProfileId: input.formativeProfileId,
            modelId: PROFILE_EMBEDDING_MODEL_ID,
            modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
            embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
            sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
            longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
            longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
            compositionPolicyVersion: PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION,
            vector: input.vector,
            coverageStatus: input.coverage.coverageStatus,
            totalExpectedSources: input.coverage.totalExpectedSources,
            includedSourceCount: input.coverage.includedSourceCount,
            unavailableSourceCount: input.coverage.unavailableSourceCount,
            components: {
              create: input.components.map((component, ordinal) => ({
                ordinal,
                credentialId: component.credentialId,
                analysisRunSourceId: component.analysisRunSourceId,
                sourceEmbeddingId: component.sourceEmbeddingId,
                status: component.status,
                reasonCode: component.reasonCode
              }))
            }
          }
        });
        return {
          status: 'created' as const,
          formativeProfileEmbeddingId: created.id,
          coverageStatus: created.coverageStatus
        };
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2002') {
        const existing = await this.prisma.formativeProfileEmbedding.findUnique({
          where: { formativeProfileId: input.formativeProfileId }
        });
        if (existing) {
          this.assertExistingArtifact(existing);
          return {
            status: 'existing',
            formativeProfileEmbeddingId: existing.id,
            coverageStatus: existing.coverageStatus
          };
        }
      }
      throw error;
    }
  }

  private assertExistingArtifact(existing: {
    id: string;
    modelId: string;
    modelRevision: string;
    embeddingDimension: number;
    sourcePolicyVersion: string;
    longTextPolicyVersion: string;
    longTextPolicySha256: string;
    compositionPolicyVersion: string;
    vector: number[];
    coverageStatus: ProfileEmbeddingCoverageStatus;
    includedSourceCount: number;
  }): void {
    const frozenIdentityMatches =
      existing.modelId === PROFILE_EMBEDDING_MODEL_ID &&
      existing.modelRevision === PROFILE_EMBEDDING_MODEL_REVISION &&
      existing.embeddingDimension === PROFILE_EMBEDDING_DIMENSION &&
      existing.sourcePolicyVersion === PROFILE_EMBEDDING_SOURCE_POLICY_VERSION &&
      existing.longTextPolicyVersion === PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION &&
      existing.longTextPolicySha256 === PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256 &&
      existing.compositionPolicyVersion === PROFILE_EMBEDDING_COMPOSITION_POLICY_VERSION;
    const vectorMatchesCoverage =
      existing.coverageStatus === ProfileEmbeddingCoverageStatus.UNAVAILABLE
        ? existing.vector.length === 0 && existing.includedSourceCount === 0
        : existing.includedSourceCount >= 1 && validateProfileEmbeddingSourceVector(existing.vector);
    if (!frozenIdentityMatches || !vectorMatchesCoverage) {
      throw new ProfileEmbeddingCompositionError('existing_profile_embedding_invalid');
    }
  }
}

export class ProfileEmbeddingCompositionError extends Error {
  public constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'ProfileEmbeddingCompositionError';
  }
}
