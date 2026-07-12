import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Prisma, type SemanticAnalysis } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { createSemanticAnalysisArtifactMapping } from './semantic-analysis-artifact.mapper';
import {
  type SemanticAnalysisArtifact,
  type SemanticAnalysisArtifactMappingResult
} from './semantic-analysis-artifact.types';
import { validateSemanticAnalysisArtifact } from './semantic-analysis-artifact.validator';

@Injectable()
export class SemanticService {
  constructor(private readonly prisma: PrismaService) {}

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
}
