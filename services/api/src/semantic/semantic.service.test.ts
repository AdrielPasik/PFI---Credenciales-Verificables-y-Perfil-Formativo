import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  createAcademicPdfCompletedArtifact,
  createAcademicPdfPartialArtifact
} from './__fixtures__/semantic-analysis-artifact.fixtures';
import { SemanticService } from './semantic.service';

function createSemanticServiceTestContext(options?: {
  credentialExists?: boolean;
  artifactCreateResult?: Record<string, unknown>;
}) {
  const calls = {
    credentialFindUnique: [] as Array<Record<string, unknown>>,
    semanticAnalysisCreate: [] as Array<Record<string, unknown>>,
    credentialUpdate: 0,
    blockchainRecordCreate: 0
  };

  const prisma = {
    credential: {
      findUnique: async (args: Record<string, unknown>) => {
        calls.credentialFindUnique.push(args);
        if (options?.credentialExists === false) {
          return null;
        }

        const where = args.where as { id?: string } | undefined;
        return { id: where?.id ?? 'cred-123' };
      },
      update: async () => {
        calls.credentialUpdate += 1;
        return null;
      }
    },
    semanticAnalysis: {
      create: async (args: Record<string, unknown>) => {
        calls.semanticAnalysisCreate.push(args);
        if (options?.artifactCreateResult) {
          return options.artifactCreateResult;
        }

        return {
          id: 'semantic-123',
          ...(args.data as Record<string, unknown>)
        };
      }
    },
    blockchainRecord: {
      create: async () => {
        calls.blockchainRecordCreate += 1;
        return null;
      }
    }
  };

  const service = new SemanticService(prisma as never);

  return {
    service,
    calls
  };
}

test('persistForCredential validates, maps and persists a valid artifact', async () => {
  const { service, calls } = createSemanticServiceTestContext();

  const result = await service.persistForCredential(
    'cred-123',
    createAcademicPdfCompletedArtifact()
  );

  assert.equal(calls.credentialFindUnique.length, 1);
  assert.equal(calls.semanticAnalysisCreate.length, 1);
  assert.equal(result.id, 'semantic-123');

  const createArgs = calls.semanticAnalysisCreate[0] as {
    data: Record<string, unknown>;
  };

  assert.equal(createArgs.data.credentialId, 'cred-123');
  assert.equal(createArgs.data.schemaVersion, 'semantic_analysis_v1');
  assert.equal(createArgs.data.status, 'completed');
  assert.equal(createArgs.data.pipelineVersion, 'unversioned_current');
  assert.equal(createArgs.data.taxonomyVersion, 'unversioned_current');
  assert.equal(createArgs.data.textForEmbedding, 'BASE DE DATOS I. SQL y modelo relacional.');
});

test('persistForCredential fails when credential does not exist', async () => {
  const { service, calls } = createSemanticServiceTestContext({
    credentialExists: false
  });

  await assert.rejects(
    () =>
      service.persistForCredential(
        'cred-missing',
        createAcademicPdfCompletedArtifact()
      ),
    NotFoundException
  );

  assert.equal(calls.semanticAnalysisCreate.length, 0);
});

test('persistForCredential uses credentialId received externally and ignores artifact extras', async () => {
  const { service, calls } = createSemanticServiceTestContext();
  const artifact = {
    ...createAcademicPdfCompletedArtifact(),
    credentialId: 'artifact-credential-should-be-ignored'
  };

  await service.persistForCredential('cred-external', artifact);

  const createArgs = calls.semanticAnalysisCreate[0] as {
    data: Record<string, unknown>;
  };

  assert.equal(createArgs.data.credentialId, 'cred-external');
  assert.notEqual(createArgs.data.credentialId, artifact.credentialId);
});

test('persistForCredential does not modify Credential or create BlockchainRecord', async () => {
  const { service, calls } = createSemanticServiceTestContext();

  await service.persistForCredential(
    'cred-123',
    createAcademicPdfCompletedArtifact()
  );

  assert.equal(calls.credentialUpdate, 0);
  assert.equal(calls.blockchainRecordCreate, 0);
});

test('persistForCredential does not generate canonical hash fields', async () => {
  const { service, calls } = createSemanticServiceTestContext();

  await service.persistForCredential(
    'cred-123',
    createAcademicPdfCompletedArtifact()
  );

  const createArgs = calls.semanticAnalysisCreate[0] as {
    data: Record<string, unknown>;
  };

  assert.equal(hasOwn(createArgs.data, 'canonicalHash'), false);
  assert.equal(hasOwn(createArgs.data, 'canonicalizationVersion'), false);
});

test('persistForCredential stores warnings, partialReasons, sourceRefs, hoursDistribution and full confidence in analysisJson', async () => {
  const { service, calls } = createSemanticServiceTestContext();

  await service.persistForCredential(
    'cred-123',
    createAcademicPdfPartialArtifact()
  );

  const createArgs = calls.semanticAnalysisCreate[0] as {
    data: Record<string, unknown>;
  };
  const analysisJson = createArgs.data.analysisJson as Record<string, unknown>;

  assert.deepEqual(analysisJson.sourceRefs, {
    documentId: '3.3.152',
    fileName: '3.3.152_NEGOCIACION_Y_LIDERAZGO.pdf'
  });
  assert.deepEqual(analysisJson.hoursDistribution, []);
  assert.deepEqual(analysisJson.warnings, [
    'area_could_not_be_confidently_resolved'
  ]);
  assert.deepEqual(analysisJson.partialReasons, [
    'kbs_area_assignment_status_unresolved_domain_candidate'
  ]);
  assert.deepEqual(analysisJson.confidence, {
    global: null,
    globalMethod: 'unavailable',
    coverage: null,
    coverageMethod: 'unavailable'
  });
});

test('persistForCredential rejects invalid artifacts through the existing validator', async () => {
  const { service, calls } = createSemanticServiceTestContext();
  const invalidArtifact = {
    ...createAcademicPdfCompletedArtifact(),
    schemaVersion: 'credential_candidate_v1'
  };

  await assert.rejects(
    () => service.persistForCredential('cred-123', invalidArtifact),
    BadRequestException
  );

  assert.equal(calls.credentialFindUnique.length, 0);
  assert.equal(calls.semanticAnalysisCreate.length, 0);
});

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
