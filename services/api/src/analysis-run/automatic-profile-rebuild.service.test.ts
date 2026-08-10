import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

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

  await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1'
  });

  assert.deepEqual(calls.rebuilds, ['holder-1']);
  assert.equal(calls.logs.length, 0);
});

test('never rethrows when rebuildForUser fails -- logs a safe event instead', async () => {
  const { service, calls } = setup({
    rebuildError: new Error('raw db connection string secret')
  });

  await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1'
  });

  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.deepEqual(logged, {
    event: 'automatic_profile_rebuild_failed',
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: 'run-1',
    reason: 'unexpected_error'
  });
  assert.equal(JSON.stringify(logged).includes('raw db connection'), false);
});

test('preserves a safe HttpException message as the logged reason', async () => {
  const { service, calls } = setup({
    rebuildError: new NotFoundException('User holder-1 not found')
  });

  await service.rebuildAfterAutomaticAnalysis({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'User holder-1 not found');
  assert.equal(logged.analysisRunId, null);
});
