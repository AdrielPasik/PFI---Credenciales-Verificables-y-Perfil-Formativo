import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Prisma, type SemanticAnalysis } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialLatestSemanticAnalysisResponseDto } from './dto/latest-semantic-analysis-response.dto';
import { createSemanticAnalysisArtifactMapping } from './semantic-analysis-artifact.mapper';
import {
  type SemanticAnalysisArtifact,
  type SemanticAnalysisArtifactMappingResult
} from './semantic-analysis-artifact.types';
import { validateSemanticAnalysisArtifact } from './semantic-analysis-artifact.validator';

@Injectable()
export class SemanticService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestForCredential(
    credentialId: string
  ): Promise<CredentialLatestSemanticAnalysisResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      select: {
        id: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    const latestSemanticAnalysis = await this.prisma.semanticAnalysis.findFirst({
      where: {
        credentialId
      },
      orderBy: {
        analyzedAt: 'desc'
      }
    });

    return {
      credentialId: credential.id,
      latestSemanticAnalysis: latestSemanticAnalysis
        ? this.toLatestSemanticAnalysisResponse(latestSemanticAnalysis)
        : null
    };
  }

  async persistForCredential(
    credentialId: string,
    artifact: unknown
  ): Promise<SemanticAnalysis> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const validatedArtifact = validateSemanticAnalysisArtifact(artifact);
    const mappedArtifact =
      createSemanticAnalysisArtifactMapping(validatedArtifact);

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      select: {
        id: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    return this.prisma.semanticAnalysis.create({
      data: this.buildCreateData(
        credential.id,
        validatedArtifact,
        mappedArtifact
      )
    });
  }

  private buildCreateData(
    credentialId: string,
    validatedArtifact: SemanticAnalysisArtifact,
    mappedArtifact: SemanticAnalysisArtifactMappingResult
  ): Prisma.SemanticAnalysisUncheckedCreateInput {
    return {
      credentialId,
      schemaVersion: mappedArtifact.schemaVersion,
      status: mappedArtifact.status,
      pipelineVersion: mappedArtifact.pipelineVersion,
      taxonomyVersion: mappedArtifact.taxonomyVersion,
      analyzedAt: new Date(),
      confidence:
        typeof mappedArtifact.confidence.global === 'number'
          ? new Prisma.Decimal(mappedArtifact.confidence.global)
          : null,
      areas: mappedArtifact.areas as Prisma.InputJsonValue,
      skills: mappedArtifact.skills as Prisma.InputJsonValue,
      concepts: mappedArtifact.concepts as Prisma.InputJsonValue,
      qualityFlags: mappedArtifact.qualityFlags as Prisma.InputJsonValue,
      evidenceMap: mappedArtifact.evidenceMap as Prisma.InputJsonValue,
      textForEmbedding: mappedArtifact.textForEmbedding,
      analysisJson: this.buildAnalysisJson(
        validatedArtifact,
        mappedArtifact
      ) as unknown as Prisma.InputJsonValue
    };
  }

  private buildAnalysisJson(
    validatedArtifact: SemanticAnalysisArtifact,
    mappedArtifact: SemanticAnalysisArtifactMappingResult
  ) {
    return this.cloneJsonLike({
      schemaVersion: mappedArtifact.metadata.schemaVersion,
      pipelineVersion: mappedArtifact.metadata.pipelineVersion,
      taxonomyVersion: mappedArtifact.metadata.taxonomyVersion,
      sourceType: mappedArtifact.metadata.sourceType,
      sourceRefs: mappedArtifact.metadata.sourceRefs,
      hoursDistribution: mappedArtifact.metadata.hoursDistribution,
      confidence: mappedArtifact.confidence,
      qualityFlags: mappedArtifact.qualityFlags,
      warnings: mappedArtifact.warnings,
      partialReasons: mappedArtifact.partialReasons,
      mapped: mappedArtifact,
      artifact: validatedArtifact
    });
  }

  private toLatestSemanticAnalysisResponse(semanticAnalysis: SemanticAnalysis) {
    return {
      id: semanticAnalysis.id,
      schemaVersion: semanticAnalysis.schemaVersion,
      status: semanticAnalysis.status,
      pipelineVersion: semanticAnalysis.pipelineVersion,
      taxonomyVersion: semanticAnalysis.taxonomyVersion,
      confidence: this.toNullableNumber(semanticAnalysis.confidence),
      areas: this.toArray(semanticAnalysis.areas, 'areas'),
      skills: this.toArray(semanticAnalysis.skills, 'skills'),
      concepts: this.toArray(semanticAnalysis.concepts, 'concepts'),
      qualityFlags: this.toStringArray(
        semanticAnalysis.qualityFlags,
        'qualityFlags'
      ),
      evidenceMap: this.toObject(semanticAnalysis.evidenceMap, 'evidenceMap'),
      textForEmbedding: semanticAnalysis.textForEmbedding,
      analysisJson: semanticAnalysis.analysisJson
        ? this.toObject(semanticAnalysis.analysisJson, 'analysisJson')
        : null,
      analyzedAt: semanticAnalysis.analyzedAt.toISOString()
    };
  }

  private assertNonEmptyString(
    value: unknown,
    fieldName: string
  ): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} es requerido.`);
    }
  }

  private cloneJsonLike<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const parsed = Number.parseFloat(value.toString());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new BadRequestException('confidence almacenado no tiene un formato valido.');
  }

  private toArray(value: unknown, fieldName: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return this.cloneJsonLike(value);
  }

  private toStringArray(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return value.map((entry) => {
      if (typeof entry !== 'string') {
        throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
      }

      return entry;
    });
  }

  private toObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return this.cloneJsonLike(value as Record<string, unknown>);
  }
}
