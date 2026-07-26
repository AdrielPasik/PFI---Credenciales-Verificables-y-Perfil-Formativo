import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { createFormativeProfileResultArtifact } from '../profiles/__fixtures__/formative-profile-result-artifact.fixture';
import { createAcademicPdfCompletedArtifact } from '../semantic/__fixtures__/semantic-analysis-artifact.fixtures';
import { validateSemanticAnalysisArtifact } from '../semantic/semantic-analysis-artifact.validator';
import { AiIntegrationService } from './ai-integration.service';

test('analyzePdf validates and optionally persists semantic_analysis_v1', async () => {
  const artifact = createAcademicPdfCompletedArtifact();
  const validatedArtifact = validateSemanticAnalysisArtifact(artifact);
  let persistedArtifact: unknown;
  const service = new AiIntegrationService(
    {} as never,
    {
      async analyzePdf() {
        return artifact;
      }
    } as never,
    {
      async persistForCredential(credentialId: string, input: unknown) {
        assert.equal(credentialId, 'credential-1');
        persistedArtifact = input;
        return {
          id: 'analysis-new',
          credentialId,
          analyzedAt: new Date('2026-07-25T12:00:00.000Z')
        };
      }
    } as never,
    {} as never,
    {} as never
  );

  const result = await service.analyzePdf({
    credentialId: 'credential-1',
    filePath: 'source.pdf'
  });

  assert.deepEqual(persistedArtifact, validatedArtifact);
  assert.equal(result.artifact.schemaVersion, 'semantic_analysis_v1');
  assert.equal(result.persisted?.id, 'analysis-new');
});

test('buildProfileForUser validates ownership and uses stored source artifacts', async () => {
  const semanticArtifact = createAcademicPdfCompletedArtifact();
  const validatedSemanticArtifact =
    validateSemanticAnalysisArtifact(semanticArtifact);
  const profileArtifact = createFormativeProfileResultArtifact();
  let sentArtifacts: unknown[] = [];
  let persistedUserId: string | null = null;
  let persistedProfile: unknown;

  const service = new AiIntegrationService(
    {
      credential: {
        async findMany() {
          return [
            {
              id: 'credential-1',
              subjectUserId: 'holder-1',
              status: 'issued',
              semanticAnalyses: [
                {
                  id: 'analysis-1',
                  analysisJson: {
                    artifact: semanticArtifact
                  }
                }
              ]
            }
          ];
        }
      }
    } as never,
    {
      async buildFormativeProfile(input: { artifacts: unknown[] }) {
        sentArtifacts = input.artifacts;
        return profileArtifact;
      }
    } as never,
    {} as never,
    {
      async persistAiArtifactForUser(userId: string, artifact: unknown) {
        persistedUserId = userId;
        persistedProfile = artifact;
        return {
          userId,
          currentProfile: {
            id: 'profile-1'
          }
        };
      }
    } as never,
    {} as never
  );

  const result = await service.buildProfileForUser('holder-1', [
    'credential-1'
  ]);

  assert.deepEqual(sentArtifacts, [validatedSemanticArtifact]);
  assert.equal(persistedUserId, 'holder-1');
  assert.deepEqual(persistedProfile, profileArtifact);
  assert.deepEqual(result.credentialIds, ['credential-1']);
  assert.equal(result.artifact.profileVersion, 'formative_profile_result_v0');
});

test('buildProfileForUser rejects a credential owned by another holder', async () => {
  let aiCalled = false;
  const service = new AiIntegrationService(
    {
      credential: {
        async findMany() {
          return [
            {
              id: 'credential-1',
              subjectUserId: 'other-holder',
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
    ForbiddenException
  );
  assert.equal(aiCalled, false);
});
