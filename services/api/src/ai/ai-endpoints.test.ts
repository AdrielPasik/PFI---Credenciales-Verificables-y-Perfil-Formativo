import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { createFormativeProfileResultArtifact } from '../profiles/__fixtures__/formative-profile-result-artifact.fixture';
import { createAcademicPdfCompletedArtifact } from '../semantic/__fixtures__/semantic-analysis-artifact.fixtures';
import { CredentialAiController } from './credential-ai.controller';
import { AiIntegrationService } from './ai-integration.service';
import { ProfileAiController } from './profile-ai.controller';

const currentIssuerUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin',
  status: UserStatus.active
};

const currentHolder = {
  id: 'holder-1',
  email: 'holder.demo@example.com',
  did: 'did:example:holder',
  status: UserStatus.active
};

test('AI endpoint controllers require AuthGuard', () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, CredentialAiController) as unknown[],
    [AuthGuard]
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, ProfileAiController) as unknown[],
    [AuthGuard]
  );
});

test('CredentialAiController uses current user and URL credential id', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const expectedResponse = {
    credentialId: 'credential-1',
    semanticAnalysisId: 'analysis-1',
    analyzedAt: '2026-07-25T12:00:00.000Z',
    schemaVersion: 'semantic_analysis_v1',
    status: 'completed',
    sourceType: 'academic_pdf',
    areasCount: 1,
    skillsCount: 1,
    conceptsCount: 1,
    confidence: 0.9,
    warnings: [],
    qualityFlags: []
  };
  const controller = new CredentialAiController({
    async analyzeCredentialPdfForIssuerUser(
      userId: string,
      credentialId: string,
      input: Record<string, unknown>
    ) {
      calls.push({
        userId,
        credentialId,
        input
      });
      return expectedResponse;
    }
  } as never);
  const fileBytes = Buffer.from('%PDF-1.4\ncontroller test', 'utf8');

  const result = await controller.analyzePdf(
    'credential-1',
    {
      originalname: 'source.pdf',
      mimetype: 'application/pdf',
      size: fileBytes.byteLength,
      buffer: fileBytes
    },
    {
      documentId: 'document-1'
    },
    currentIssuerUser
  );

  assert.deepEqual(calls, [
    {
      userId: 'issuer-user-1',
      credentialId: 'credential-1',
      input: {
        fileBytes,
        documentId: 'document-1',
        fileName: 'source.pdf',
        pipelineVersion: undefined,
        taxonomyVersion: undefined
      }
    }
  ]);
  assert.deepEqual(result, expectedResponse);
});

test('CredentialAiController rejects a missing PDF before calling integration', () => {
  let integrationCalled = false;
  const controller = new CredentialAiController({
    async analyzeCredentialPdfForIssuerUser() {
      integrationCalled = true;
    }
  } as never);

  assert.throws(
    () =>
      controller.analyzePdf(
        'credential-1',
        undefined,
        {},
        currentIssuerUser
      ),
    BadRequestException
  );
  assert.equal(integrationCalled, false);
});

test('AI credential analysis rejects a user without issuer permission', async () => {
  let aiCalled = false;
  const service = new AiIntegrationService(
    {
      credential: {
        async findUnique() {
          return {
            id: 'credential-1',
            issuerId: 'issuer-1'
          };
        }
      }
    } as never,
    {
      async analyzePdf() {
        aiCalled = true;
      }
    } as never,
    {} as never,
    {} as never,
    {
      async assertUserCanIssueForIssuer() {
        throw new ForbiddenException('membership required');
      }
    } as never
  );

  await assert.rejects(
    () =>
      service.analyzeCredentialPdfForIssuerUser(
        'unauthorized-user',
        'credential-1',
        {
          fileBytes: Buffer.from('%PDF-1.4\npermission test')
        }
      ),
    (error: unknown) =>
      error instanceof ForbiddenException && error.getStatus() === 403
  );
  assert.equal(aiCalled, false);
});

test('AI credential analysis preserves credential NotFoundException', async () => {
  let aiCalled = false;
  const service = new AiIntegrationService(
    {
      credential: {
        async findUnique() {
          return null;
        }
      }
    } as never,
    {
      async analyzePdf() {
        aiCalled = true;
      }
    } as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    () =>
      service.analyzeCredentialPdfForIssuerUser(
        'issuer-user-1',
        'missing-credential',
        {
          fileBytes: Buffer.from('%PDF-1.4\nnot found test')
        }
      ),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404
  );
  assert.equal(aiCalled, false);
});

test('AI credential analysis persists and returns only a summary', async () => {
  const artifact = createAcademicPdfCompletedArtifact();
  let permissionChecked = false;
  let persistedCredentialId: string | null = null;
  const service = new AiIntegrationService(
    {
      credential: {
        async findUnique() {
          return {
            id: 'credential-1',
            issuerId: 'issuer-1'
          };
        }
      }
    } as never,
    {
      async analyzePdf() {
        return artifact;
      }
    } as never,
    {
      async persistForCredential(credentialId: string) {
        persistedCredentialId = credentialId;
        return {
          id: 'analysis-1',
          analyzedAt: new Date('2026-07-25T12:00:00.000Z')
        };
      }
    } as never,
    {} as never,
    {
      async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
        assert.equal(userId, 'issuer-user-1');
        assert.equal(issuerId, 'issuer-1');
        permissionChecked = true;
      }
    } as never
  );

  const result = await service.analyzeCredentialPdfForIssuerUser(
    'issuer-user-1',
    'credential-1',
    {
      fileBytes: Buffer.from('%PDF-1.4\nsummary test')
    }
  );

  assert.equal(permissionChecked, true);
  assert.equal(persistedCredentialId, 'credential-1');
  assert.equal(result.semanticAnalysisId, 'analysis-1');
  assert.equal(result.schemaVersion, 'semantic_analysis_v1');
  assert.equal('artifact' in result, false);
});

test('ProfileAiController uses token user id and returns current profile', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentProfileResponse = {
    userId: 'holder-1',
    currentProfile: {
      id: 'profile-1',
      profileVersion: 'formative_profile_result_v0',
      isCurrent: true,
      credentialsCount: 2,
      totalHours: 120,
      areasSummary: [],
      skillsSummary: [],
      qualityFlags: [],
      generatedAt: '2026-07-25T12:00:00.000Z',
      profileJson: createFormativeProfileResultArtifact()
    }
  };
  const controller = new ProfileAiController({
    async buildProfileForUser(userId: string, credentialIds: unknown) {
      calls.push({
        userId,
        credentialIds
      });
      return {
        artifact: createFormativeProfileResultArtifact(),
        persisted: currentProfileResponse,
        credentialIds
      };
    }
  } as never);

  const result = await controller.buildFromAi(
    {
      credentialIds: ['credential-1', 'credential-2']
    },
    currentHolder
  );

  assert.deepEqual(calls, [
    {
      userId: 'holder-1',
      credentialIds: ['credential-1', 'credential-2']
    }
  ]);
  assert.deepEqual(result, currentProfileResponse);
});

test('buildProfileForUser rejects missing credentialIds before database access', async () => {
  let databaseCalled = false;
  const service = new AiIntegrationService(
    {
      credential: {
        async findMany() {
          databaseCalled = true;
          return [];
        }
      }
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    () => service.buildProfileForUser('holder-1', undefined),
    BadRequestException
  );
  assert.equal(databaseCalled, false);
});

test('buildProfileForUser preserves missing SemanticAnalysis BadRequestException', async () => {
  let aiCalled = false;
  const service = new AiIntegrationService(
    {
      credential: {
        async findMany() {
          return [
            {
              id: 'credential-1',
              subjectUserId: 'holder-1',
              status: 'issued',
              semanticAnalyses: []
            }
          ];
        }
      }
    } as never,
    {
      async buildFormativeProfile() {
        aiCalled = true;
      }
    } as never,
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    () => service.buildProfileForUser('holder-1', ['credential-1']),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400
  );
  assert.equal(aiCalled, false);
});
