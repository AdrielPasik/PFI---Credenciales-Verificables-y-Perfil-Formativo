import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { createFormativeProfileResultArtifact } from './__fixtures__/formative-profile-result-artifact.fixture';
import { FormativeProfileService } from './formative-profile.service';

test('persistAiArtifactForUser uses external userId and creates a new current profile', async () => {
  const updateManyCalls: Array<Record<string, unknown>> = [];
  const createCalls: Array<Record<string, unknown>> = [];
  const transactionOptions: Array<Record<string, unknown>> = [];
  const artifact = createFormativeProfileResultArtifact();

  const service = new FormativeProfileService({
    user: {
      async findUnique(args: Record<string, unknown>) {
        assert.deepEqual(args, {
          where: {
            id: 'holder-1'
          },
          select: {
            id: true
          }
        });
        return {
          id: 'holder-1'
        };
      }
    },
    async $transaction(
      callback: (transaction: {
        formativeProfile: {
          updateMany(args: Record<string, unknown>): Promise<unknown>;
          create(args: Record<string, unknown>): Promise<unknown>;
        };
      }) => Promise<unknown>,
      options: Record<string, unknown>
    ) {
      transactionOptions.push(options);
      return callback({
        formativeProfile: {
          async updateMany(args: Record<string, unknown>) {
            updateManyCalls.push(args);
            return {
              count: 1
            };
          },
          async create(args: Record<string, unknown>) {
            createCalls.push(args);
            const data = args.data as Record<string, unknown>;
            return {
              id: 'profile-ai-1',
              ...data
            };
          }
        }
      });
    }
  } as never);

  const result = await service.persistAiArtifactForUser('holder-1', artifact);

  assert.deepEqual(updateManyCalls, [
    {
      where: {
        userId: 'holder-1',
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    }
  ]);
  assert.equal(createCalls.length, 1);
  assert.equal(transactionOptions[0].isolationLevel, 'Serializable');

  const createData = createCalls[0].data as Record<string, unknown>;
  assert.equal(createData.userId, 'holder-1');
  assert.equal(createData.profileVersion, 'formative_profile_result_v0');
  assert.equal(createData.generationMethod, 'ai_artifact_ingest_v0');
  assert.equal(createData.isCurrent, true);
  assert.equal(createData.credentialsCount, 2);
  assert.deepEqual(createData.profileJson, artifact);
  assert.equal(result.userId, 'holder-1');
  assert.equal(result.currentProfile?.id, 'profile-ai-1');
  assert.equal(result.currentProfile?.isCurrent, true);
});

test('persistAiArtifactForUser fails when the external user does not exist', async () => {
  let transactionCalled = false;
  const service = new FormativeProfileService({
    user: {
      async findUnique() {
        return null;
      }
    },
    async $transaction() {
      transactionCalled = true;
    }
  } as never);

  await assert.rejects(
    () =>
      service.persistAiArtifactForUser(
        'missing-holder',
        createFormativeProfileResultArtifact()
      ),
    NotFoundException
  );
  assert.equal(transactionCalled, false);
});
