import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CredentialStatus, type SemanticAnalysis } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { validateFormativeProfileResultArtifact } from '../profiles/formative-profile-result-artifact.validator';
import { validateSemanticAnalysisArtifact } from '../semantic/semantic-analysis-artifact.validator';
import { SemanticService } from '../semantic/semantic.service';
import { AiServiceClient } from './ai-service.client';
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
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  async analyzePdf(input: AnalyzePdfIntegrationInput) {
    const response = await this.aiClient.analyzePdf(input);
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

  async buildProfileForUser(userId: string, credentialIds: string[]) {
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

    const response = await this.aiClient.buildFormativeProfile({
      artifacts
    });
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

  private normalizeCredentialIds(value: string[]): string[] {
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
}
