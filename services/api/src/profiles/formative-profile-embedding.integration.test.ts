import assert from 'node:assert/strict';
import test from 'node:test';

import { CredentialType } from '@prisma/client';

import { FormativeProfileService } from './formative-profile.service';

function decimalLike(value: string) {
  return { toString: () => value };
}

function setup(composition: { composeForFormativeProfile(id: string): Promise<unknown> } | undefined) {
  const profile = {
    id: 'profile-new',
    schemaVersion: 'formative_profile_v1',
    userId: 'holder-1',
    generatedAt: new Date('2026-10-12T12:00:00.000Z'),
    credentialsCount: 1,
    totalHours: decimalLike('8'),
    profileVersion: 'backend_formative_profile_snapshot_v0',
    isCurrent: true,
    generationMethod: 'backend_deterministic_aggregation_v0',
    areasSummary: [],
    skillsSummary: [],
    evidenceByArea: [],
    qualityFlags: [],
    profileJson: { generatedFrom: { credentialIds: ['credential-1'], semanticAnalysisIds: [], reusableSemanticInterpretationIds: [] }, summary: { totalHours: 8 } }
  };
  const calls = {
    creates: 0,
    composition: [] as string[],
    lifecycle: [] as string[],
    logs: [] as string[]
  };
  const prisma = {
    credential: {
      async findMany() {
        return [{
          id: 'credential-1',
          type: CredentialType.course,
          hours: decimalLike('8'),
          credentialSubject: {},
          semanticAnalyses: [],
          reusableSemanticInterpretations: []
        }];
      }
    },
    async $transaction(callback: (transaction: unknown) => Promise<unknown>) {
      const result = await callback({
        formativeProfile: {
          async updateMany() { return { count: 0 }; },
          async create() { calls.creates += 1; return profile; }
        }
      });
      calls.lifecycle.push('structured_transaction_committed');
      return result;
    }
  };
  const composer = composition
    ? {
        async composeForFormativeProfile(id: string) {
          calls.composition.push(id);
          return composition.composeForFormativeProfile(id);
        }
      }
    : undefined;
  const service = new FormativeProfileService(prisma as never, composer as never);
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });
  return { service, calls };
}

async function withFlag(value: string | undefined, action: () => Promise<void>): Promise<void> {
  const before = process.env.PROFILE_EMBEDDINGS_ENABLED;
  if (value === undefined) delete process.env.PROFILE_EMBEDDINGS_ENABLED;
  else process.env.PROFILE_EMBEDDINGS_ENABLED = value;
  try {
    await action();
  } finally {
    if (before === undefined) delete process.env.PROFILE_EMBEDDINGS_ENABLED;
    else process.env.PROFILE_EMBEDDINGS_ENABLED = before;
  }
}

test('rebuild with PROFILE_EMBEDDINGS_ENABLED=false preserves the structured response and never composes', async () => {
  const { service, calls } = setup({ async composeForFormativeProfile() {} });
  await withFlag('false', async () => {
    const response = await service.rebuildForUser('holder-1');
    assert.equal(response.currentProfile?.id, 'profile-new');
  });
  assert.equal(calls.creates, 1);
  assert.deepEqual(calls.composition, []);
});

test('enabled rebuild invokes composition only after the structured profile has been committed', async () => {
  const { service, calls } = setup({
    async composeForFormativeProfile() {
      calls.lifecycle.push('composition');
    }
  });
  await withFlag('true', async () => {
    const response = await service.rebuildForUser('holder-1');
    assert.equal(response.currentProfile?.id, 'profile-new');
  });
  assert.deepEqual(calls.composition, ['profile-new']);
  assert.deepEqual(calls.lifecycle, [
    'structured_transaction_committed',
    'composition'
  ]);
});

test('a composition failure is best effort and cannot fail the committed structured profile', async () => {
  const { service, calls } = setup({
    async composeForFormativeProfile() {
      throw new Error('source text must not be logged');
    }
  });
  await withFlag('true', async () => {
    const response = await service.rebuildForUser('holder-1');
    assert.equal(response.currentProfile?.id, 'profile-new');
  });
  assert.equal(calls.creates, 1);
  assert.deepEqual(calls.composition, ['profile-new']);
  assert.equal(calls.logs.length, 1);
  assert.equal(calls.logs[0]!.includes('source text'), false);
});
