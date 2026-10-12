import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AiServiceClient } from '../ai/ai-service.client';
import { AiServiceClientError } from '../ai/ai-service.types';
import { canonicalJson } from '../source-extraction/canonical-json';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import {
  isProductNormalizedText,
  productNormalizeText
} from '../text-evidence/product-text-normalization';
import {
  PROFILE_EMBEDDING_DEPENDENCY_FINGERPRINT_VERSION,
  PROFILE_EMBEDDING_DIMENSION,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256,
  PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
  PROFILE_EMBEDDING_MAX_SOURCE_CHARACTERS,
  PROFILE_EMBEDDING_MODEL_ID,
  PROFILE_EMBEDDING_MODEL_REVISION,
  PROFILE_EMBEDDING_REQUEST_SCHEMA_VERSION,
  PROFILE_EMBEDDING_SOURCE_POLICY_VERSION
} from './profile-embedding.contract';
import { PrismaService } from '../prisma/prisma.service';

export type SourceEmbeddingGenerationStatus =
  | 'disabled'
  | 'reused'
  | 'generated'
  | 'unavailable';

export type SourceEmbeddingGenerationResult = {
  readonly status: SourceEmbeddingGenerationStatus;
  readonly analysisRunSourceId: string;
  readonly dependencyFingerprintSha256: string | null;
  readonly reasonCode: string | null;
};

type SourceForEmbedding = {
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly sourceArtifactBlobSha256: string | null;
};

const SOURCE_SELECT = {
  id: true,
  sourceType: true,
  documentEvidenceId: true,
  textEvidenceId: true,
  sourceSha256: true,
  extractionArtifactCanonicalJson: true,
  artifactBlobSha256: true,
  extractionDerivationTrust: true,
  documentEvidence: { select: { id: true, sha256: true } },
  textEvidence: { select: { id: true, content: true, sha256: true } }
} as const;

const SOURCE_EMBEDDING_SELECT = {
  id: true,
  analysisRunSourceId: true,
  sourceSha256: true,
  sourceArtifactBlobSha256: true,
  dependencyFingerprintSha256: true,
  modelId: true,
  modelRevision: true,
  embeddingDimension: true,
  sourcePolicyVersion: true,
  longTextPolicyVersion: true,
  longTextPolicySha256: true,
  vector: true
} as const;

function sameSha(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sha256Utf8(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

/** Number of Unicode code points, matching Python's request length accounting. */
function sourceCharacterCount(value: string): number {
  return Array.from(value).length;
}

export interface ProfileEmbeddingFingerprintDependencies {
  readonly analysisRunSourceId: string;
  readonly sourceSha256: string;
  readonly sourceArtifactBlobSha256: string | null;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly embeddingDimension: number;
  readonly sourcePolicyVersion: string;
  readonly longTextPolicyVersion: string;
  readonly longTextPolicySha256: string;
}

/**
 * Pure, versioned dependency identity. `canonicalJson` fixes member ordering,
 * UTF-8 bytes and null representation across locales and platforms.
 */
export function buildProfileEmbeddingDependencyFingerprint(
  input: ProfileEmbeddingFingerprintDependencies
): string {
  const preimage = canonicalJson({
    version: PROFILE_EMBEDDING_DEPENDENCY_FINGERPRINT_VERSION,
    analysisRunSourceId: input.analysisRunSourceId,
    sourceSha256: input.sourceSha256,
    sourceArtifactBlobSha256: input.sourceArtifactBlobSha256,
    modelId: input.modelId,
    modelRevision: input.modelRevision,
    embeddingDimension: input.embeddingDimension,
    sourcePolicyVersion: input.sourcePolicyVersion,
    longTextPolicyVersion: input.longTextPolicyVersion,
    longTextPolicySha256: input.longTextPolicySha256
  });
  return sha256Utf8(preimage);
}

/**
 * Generates only immutable, successful source artifacts. It is intentionally
 * unaware of FormativeProfile composition and receives only AnalysisRunSource
 * identity, so it cannot consume semantic output or profile-derived text.
 */
@Injectable()
export class SourceEmbeddingGenerationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiServiceClient,
    private readonly extractionSlots: SourceExtractionSlotService
  ) {}

  public async generateForAnalysisRunSource(
    analysisRunSourceId: string
  ): Promise<SourceEmbeddingGenerationResult> {
    if (!this.isEnabled()) {
      return this.result('disabled', analysisRunSourceId, null, 'disabled');
    }

    let source: SourceForEmbedding;
    try {
      const resolved = await this.resolveAuthoritativeSource(analysisRunSourceId);
      if (!resolved) {
        return this.result('unavailable', analysisRunSourceId, null, 'source_unavailable');
      }
      source = resolved;
    } catch (error) {
      return this.result(
        'unavailable',
        analysisRunSourceId,
        null,
        this.safeSourceResolutionReason(error)
      );
    }

    if (sourceCharacterCount(source.sourceText) > PROFILE_EMBEDDING_MAX_SOURCE_CHARACTERS) {
      return this.result('unavailable', analysisRunSourceId, null, 'source_too_large');
    }

    const dependencyFingerprintSha256 = this.dependencyFingerprint({
      analysisRunSourceId,
      sourceSha256: source.sourceSha256,
      sourceArtifactBlobSha256: source.sourceArtifactBlobSha256
    });

    const existing = await this.prisma.sourceEmbedding.findUnique({
      where: { dependencyFingerprintSha256 },
      select: SOURCE_EMBEDDING_SELECT
    });
    if (existing) {
      this.assertExistingIdentity(existing, analysisRunSourceId, source);
      return this.result('reused', analysisRunSourceId, dependencyFingerprintSha256, null);
    }

    let encoded;
    try {
      encoded = await this.aiClient.encodeProfileEmbeddingSource({
        schemaVersion: PROFILE_EMBEDDING_REQUEST_SCHEMA_VERSION,
        embeddingSource: source.sourceText
      });
    } catch (error) {
      return this.result(
        'unavailable',
        analysisRunSourceId,
        dependencyFingerprintSha256,
        error instanceof AiServiceClientError && error.code === 'invalid_response'
          ? 'invalid_ai_response'
          : 'ai_unavailable'
      );
    }

    try {
      await this.prisma.sourceEmbedding.create({
        data: {
          analysisRunSourceId,
          sourceSha256: source.sourceSha256,
          sourceArtifactBlobSha256: source.sourceArtifactBlobSha256,
          dependencyFingerprintSha256,
          modelId: encoded.modelId,
          modelRevision: encoded.modelRevision,
          embeddingDimension: encoded.embeddingDimension,
          sourcePolicyVersion: encoded.sourcePolicyVersion,
          longTextPolicyVersion: encoded.longTextPolicyVersion,
          longTextPolicySha256: encoded.longTextPolicySha256,
          vector: [...encoded.vector]
        }
      });
      return this.result('generated', analysisRunSourceId, dependencyFingerprintSha256, null);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const raced = await this.prisma.sourceEmbedding.findUnique({
          where: { dependencyFingerprintSha256 },
          select: SOURCE_EMBEDDING_SELECT
        });
        if (raced) {
          this.assertExistingIdentity(raced, analysisRunSourceId, source);
          return this.result('reused', analysisRunSourceId, dependencyFingerprintSha256, null);
        }
      }
      return this.result(
        'unavailable',
        analysisRunSourceId,
        dependencyFingerprintSha256,
        'persistence_failure'
      );
    }
  }

  /** Deterministic UTF-8 SHA-256 over explicitly versioned canonical JSON. */
  public dependencyFingerprint(input: {
    analysisRunSourceId: string;
    sourceSha256: string;
    sourceArtifactBlobSha256: string | null;
  }): string {
    return buildProfileEmbeddingDependencyFingerprint({
      analysisRunSourceId: input.analysisRunSourceId,
      sourceSha256: input.sourceSha256,
      // `null` is the frozen canonical marker; no omitted field or empty string.
      sourceArtifactBlobSha256: input.sourceArtifactBlobSha256,
      modelId: PROFILE_EMBEDDING_MODEL_ID,
      modelRevision: PROFILE_EMBEDDING_MODEL_REVISION,
      embeddingDimension: PROFILE_EMBEDDING_DIMENSION,
      sourcePolicyVersion: PROFILE_EMBEDDING_SOURCE_POLICY_VERSION,
      longTextPolicyVersion: PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION,
      longTextPolicySha256: PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256
    });
  }

  private async resolveAuthoritativeSource(
    analysisRunSourceId: string
  ): Promise<SourceForEmbedding | null> {
    const source = await this.prisma.analysisRunSource.findUnique({
      where: { id: analysisRunSourceId },
      select: SOURCE_SELECT
    });
    if (!source) return null;

    if (source.sourceType === 'text_evidence') {
      if (
        !source.textEvidenceId ||
        source.documentEvidenceId ||
        !source.textEvidence ||
        source.textEvidence.id !== source.textEvidenceId
      ) {
        throw new SourceEmbeddingSourceError('unsupported_source');
      }
      const canonical = productNormalizeText(source.textEvidence.content);
      if (
        !canonical ||
        !isProductNormalizedText(source.textEvidence.content) ||
        !sameSha(sha256Utf8(canonical), source.textEvidence.sha256) ||
        !sameSha(source.textEvidence.sha256, source.sourceSha256)
      ) {
        throw new SourceEmbeddingSourceError('source_sha_mismatch');
      }
      return {
        sourceText: canonical,
        sourceSha256: source.sourceSha256,
        sourceArtifactBlobSha256: null
      };
    }

    if (source.sourceType !== 'document_evidence') {
      throw new SourceEmbeddingSourceError('unsupported_source');
    }
    if (
      !source.documentEvidenceId ||
      source.textEvidenceId ||
      !source.documentEvidence ||
      source.documentEvidence.id !== source.documentEvidenceId ||
      !sameSha(source.documentEvidence.sha256, source.sourceSha256)
    ) {
      throw new SourceEmbeddingSourceError('source_sha_mismatch');
    }

    const extraction = this.extractionSlots.verifyReadExtractionSlot(analysisRunSourceId, {
      extractionArtifactCanonicalJson: source.extractionArtifactCanonicalJson,
      artifactBlobSha256: source.artifactBlobSha256,
      extractionDerivationTrust: source.extractionDerivationTrust
    });
    if (!extraction) {
      throw new SourceEmbeddingSourceError('extraction_unavailable');
    }
    const artifact = extraction.artifact;
    if (
      artifact.sourceType !== 'PDF_DOCUMENT' ||
      artifact.source.documentEvidenceId !== source.documentEvidenceId ||
      !sameSha(artifact.source.sourceSha256, source.sourceSha256) ||
      !artifact.documentCanonicalText
    ) {
      throw new SourceEmbeddingSourceError('extraction_unavailable');
    }

    return {
      sourceText: artifact.documentCanonicalText,
      sourceSha256: source.sourceSha256,
      sourceArtifactBlobSha256: extraction.artifactBlobSha256
    };
  }

  private isEnabled(): boolean {
    const configured = process.env.PROFILE_EMBEDDINGS_ENABLED;
    if (configured === undefined || configured.trim() === '') return false;
    return configured.trim().toLowerCase() === 'true';
  }

  private assertExistingIdentity(
    row: {
      analysisRunSourceId: string;
      sourceSha256: string;
      sourceArtifactBlobSha256: string | null;
      modelId: string;
      modelRevision: string;
      embeddingDimension: number;
      sourcePolicyVersion: string;
      longTextPolicyVersion: string;
      longTextPolicySha256: string;
      vector: number[];
    },
    analysisRunSourceId: string,
    source: SourceForEmbedding
  ): void {
    if (
      row.analysisRunSourceId !== analysisRunSourceId ||
      !sameSha(row.sourceSha256, source.sourceSha256) ||
      row.sourceArtifactBlobSha256 !== source.sourceArtifactBlobSha256 ||
      row.modelId !== PROFILE_EMBEDDING_MODEL_ID ||
      row.modelRevision !== PROFILE_EMBEDDING_MODEL_REVISION ||
      row.embeddingDimension !== PROFILE_EMBEDDING_DIMENSION ||
      row.sourcePolicyVersion !== PROFILE_EMBEDDING_SOURCE_POLICY_VERSION ||
      row.longTextPolicyVersion !== PROFILE_EMBEDDING_LONG_TEXT_POLICY_VERSION ||
      row.longTextPolicySha256 !== PROFILE_EMBEDDING_LONG_TEXT_POLICY_SHA256 ||
      row.vector.length !== PROFILE_EMBEDDING_DIMENSION ||
      !row.vector.every(Number.isFinite)
    ) {
      throw new SourceEmbeddingSourceError('persistence_failure');
    }
  }

  private isUniqueConflict(error: unknown): boolean {
    // Estructural a proposito: los tests y los adapters de persistencia pueden
    // preservar el codigo Prisma sin transportar la misma instancia de clase.
    return (error as { code?: unknown } | null)?.code === 'P2002';
  }

  private safeSourceResolutionReason(error: unknown): string {
    if (error instanceof SourceEmbeddingSourceError) return error.reasonCode;
    return 'source_unavailable';
  }

  private result(
    status: SourceEmbeddingGenerationStatus,
    analysisRunSourceId: string,
    dependencyFingerprintSha256: string | null,
    reasonCode: string | null
  ): SourceEmbeddingGenerationResult {
    return { status, analysisRunSourceId, dependencyFingerprintSha256, reasonCode };
  }
}

class SourceEmbeddingSourceError extends Error {
  public constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'SourceEmbeddingSourceError';
  }
}
