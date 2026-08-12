import assert from 'node:assert/strict';
import test from 'node:test';

import { AutomaticProfileRebuildService } from './automatic-profile-rebuild.service';

function setup(options: { rebuildError?: Error } = {}) {
  const calls = {
    rebuilds: [] as string[],
    logs: [] as string[]
  };
  const formativeProfileService = {
    async rebuildForUser(userId: string) {
      calls.rebuilds.push(userId);
      if (options.rebuildError) throw options.rebuildError;
      return { profileReference: 'profile-1' };
    }
  };
  const service = new AutomaticProfileRebuildService(
    formativeProfileService as never
  );
  Object.defineProperty(service, 'logger', {
    value: { error: (message: string) => calls.logs.push(message) }
  });
  return { service, calls };
}

test('rebuilds the holder profile for the given user', async () => {
  const { service, calls } = setup();

  const result = await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1'
  });

  assert.deepEqual(calls.rebuilds, ['holder-1']);
  assert.equal(calls.logs.length, 0);
  assert.deepEqual(result, { status: 'rebuilt' });
});

test('never rethrows when rebuildForUser fails -- logs a safe event instead', async () => {
  const { service, calls } = setup({
    rebuildError: new Error('raw db connection string secret')
  });

  const result = await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1'
  });

  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.deepEqual(logged, {
    event: 'automatic_profile_rebuild_failed',
    errorCode: 'formative_profile_rebuild_failed',
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1'
  });
  assert.equal(JSON.stringify(logged).includes('raw db connection'), false);
  assert.deepEqual(result, {
    status: 'failed',
    errorCode: 'formative_profile_rebuild_failed'
  });
});

test('never copies a controlled exception message into the safe rebuild log', async () => {
  const { service, calls } = setup({
    rebuildError: new Error('User holder-1 not found')
  });

  await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.analysisRunId, null);
  assert.equal(JSON.stringify(logged).includes('User holder-1 not found'), false);
});
