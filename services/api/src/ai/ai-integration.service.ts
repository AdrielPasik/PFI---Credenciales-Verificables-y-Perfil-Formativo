import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { CredentialStatus, type SemanticAnalysis } from '@prisma/client';

import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { validateFormativeProfileResultArtifact } from '../profiles/formative-profile-result-artifact.validator';
import { validateSemanticAnalysisArtifact } from '../semantic/semantic-analysis-artifact.validator';
import { SemanticService } from '../semantic/semantic.service';
import { AiServiceClient } from './ai-service.client';
import { mapAiServiceClientError } from './ai-service-http-error.mapper';
import { type AnalyzePdfWithAiInput } from './ai-service.types';

export interface AnalyzePdfIntegrationInput extends AnalyzePdfWithAiInput {
  credentialId?: string;
}

@Injectable()
export class AiIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiServiceClient,
    private readonly semanticService: SemanticService,
    private readonly formativeProfileService: FormativeProfileService,
    private readonly issuersService: IssuersService
  ) {}

  async analyzePdf(input: AnalyzePdfIntegrationInput) {
    const response = await this.executeAiRequest(() =>
      this.aiClient.analyzePdf(input)
    );
    const artifact = validateSemanticAnalysisArtifact(response);
    let persisted: SemanticAnalysis | null = null;

    if (input.credentialId) {
      persisted = await this.semanticService.persistForCredential(
        input.credentialId,
        artifact
      );
    }

    return {
      artifact,
      persisted
    };
  }

  async analyzeCredentialPdfForIssuerUser(
    userId: string,
    credentialId: string,
    input: AnalyzePdfWithAiInput
  ) {
    const normalizedUserId = this.expectNonEmptyString(userId, 'userId');
    const normalizedCredentialId = this.expectNonEmptyString(
      credentialId,
      'credentialId'
    );
    const credential = await this.prisma.credential.findUnique({
      where: {
        id: normalizedCredentialId
      },
      select: {
        id: true,
        issuerId: true
      }
    });

    if (!credential) {
      throw new NotFoundException(
        `Credential ${normalizedCredentialId} does not exist.`
      );
    }

    await this.issuersService.assertUserCanIssueForIssuer(
      normalizedUserId,
      credential.issuerId
    );

    const result = await this.analyzePdf({
      ...input,
      credentialId: credential.id
    });

    if (!result.persisted) {
      throw new InternalServerErrorException(
        'Semantic analysis was validated but not persisted.'
      );
    }

    return {
      credentialId: credential.id,
      semanticAnalysisId: result.persisted.id,
      analyzedAt: result.persisted.analyzedAt.toISOString(),
      schemaVersion: result.artifact.schemaVersion,
      status: result.artifact.status,
      sourceType: result.artifact.sourceType,
      areasCount: result.artifact.areas.length,
      skillsCount: result.artifact.skills.length,
      conceptsCount: result.artifact.concepts.length,
      confidence: result.artifact.confidence.global,
      warnings: [...result.artifact.warnings],
      qualityFlags: [...result.artifact.qualityFlags]
    };
  }

  async buildProfileForUser(userId: string, credentialIds: unknown) {
    const normalizedUserId = this.expectNonEmptyString(userId, 'userId');
    const normalizedCredentialIds = this.normalizeCredentialIds(credentialIds);
    const credentials = await this.prisma.credential.findMany({
      where: {
        id: {
          in: normalizedCredentialIds
        }
      },
      select: {
        id: true,
        subjectUserId: true,
        status: true,
        semanticAnalyses: {
          orderBy: [
            {
              analyzedAt: 'desc'
            },
            {
              id: 'desc'
            }
          ],
          take: 1,
          select: {
            id: true,
            analysisJson: true
          }
        }
      }
    });
    const credentialsById = new Map(
      credentials.map((credential) => [credential.id, credential])
    );

    const artifacts = normalizedCredentialIds.map((credentialId) => {
      const credential = credentialsById.get(credentialId);
      if (!credential) {
        throw new NotFoundException(
          `Credential ${credentialId} does not exist.`
        );
      }
      if (credential.subjectUserId !== normalizedUserId) {
        throw new ForbiddenException(
          `Credential ${credentialId} does not belong to user ${normalizedUserId}.`
        );
      }
      if (credential.status !== CredentialStatus.issued) {
        throw new BadRequestException(
          `Credential ${credentialId} must be issued to build a profile.`
        );
      }

      const latestAnalysis = credential.semanticAnalyses[0];
      if (!latestAnalysis) {
        throw new BadRequestException(
          `Credential ${credentialId} has no SemanticAnalysis.`
        );
      }

      return this.extractStoredArtifact(
        latestAnalysis.analysisJson,
        credentialId,
        latestAnalysis.id
      );
    });

    const response = await this.executeAiRequest(() =>
      this.aiClient.buildFormativeProfile({
        artifacts
      })
    );
    const artifact = validateFormativeProfileResultArtifact(response);
    const persisted =
      await this.formativeProfileService.persistAiArtifactForUser(
        normalizedUserId,
        artifact
      );

    return {
      artifact,
      persisted,
      credentialIds: normalizedCredentialIds
    };
  }

  private extractStoredArtifact(
    analysisJson: unknown,
    credentialId: string,
    semanticAnalysisId: string
  ) {
    if (
      !analysisJson ||
      typeof analysisJson !== 'object' ||
      Array.isArray(analysisJson) ||
      !('artifact' in analysisJson)
    ) {
      throw new BadRequestException(
        `SemanticAnalysis ${semanticAnalysisId} for credential ${credentialId} does not preserve its source artifact.`
      );
    }

    return validateSemanticAnalysisArtifact(
      (analysisJson as Record<string, unknown>).artifact
    );
  }

  private normalizeCredentialIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException('credentialIds must be an array.');
    }

    const normalized = value.map((entry, index) =>
      this.expectNonEmptyString(entry, `credentialIds[${index}]`)
    );
    const unique = [...new Set(normalized)];
    if (unique.length === 0) {
      throw new BadRequestException(
        'At least one credentialId is required.'
      );
    }

    return unique;
  }

  private expectNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }

  private async executeAiRequest<T>(
    request: () => Promise<T>
  ): Promise<T> {
    try {
      return await request();
    } catch (error: unknown) {
      throw mapAiServiceClientError(error);
    }
  }
}
