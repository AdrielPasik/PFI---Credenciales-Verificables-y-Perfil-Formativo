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
    reason: 'post_automatic_analysis',
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

// P1.1
test('rebuildAfterIssuance rebuilds the holder profile and never lanza', async () => {
  const { service, calls } = setup();

  const result = await service.rebuildAfterIssuance({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  assert.deepEqual(calls.rebuilds, ['holder-1']);
  assert.deepEqual(result, { status: 'rebuilt' });
});

test('rebuildAfterIssuance failure logs reason=post_issuance and never rethrows', async () => {
  const { service, calls } = setup({
    rebuildError: new Error('raw db connection string secret')
  });

  const result = await service.rebuildAfterIssuance({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  assert.equal(calls.logs.length, 1);
  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.deepEqual(logged, {
    event: 'automatic_profile_rebuild_failed',
    errorCode: 'formative_profile_rebuild_failed',
    reason: 'post_issuance',
    credentialId: 'credential-1',
    holderUserId: 'holder-1',
    analysisRunId: null
  });
  assert.deepEqual(result, {
    status: 'failed',
    errorCode: 'formative_profile_rebuild_failed'
  });
});

// C5b.1
test('rebuildAfterReviewedInterpretationApply rebuilds the holder profile and never lanza', async () => {
  const { service, calls } = setup();

  const result = await service.rebuildAfterReviewedInterpretationApply({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  assert.deepEqual(calls.rebuilds, ['holder-1']);
  assert.deepEqual(result, { status: 'rebuilt' });
});

test('rebuildAfterReviewedInterpretationApply failure logs reason=post_reviewed_interpretation_apply', async () => {
  const { service, calls } = setup({ rebuildError: new Error('boom') });

  await service.rebuildAfterReviewedInterpretationApply({
    credentialId: 'credential-1',
    holderUserId: 'holder-1'
  });

  const logged = JSON.parse(calls.logs[0]) as Record<string, unknown>;
  assert.equal(logged.reason, 'post_reviewed_interpretation_apply');
});

// P1.1: rebuildBestEffort es la unica implementacion real -- los 3
// wrappers explicitos delegan en ella sin duplicar try/catch.
test('rebuildBestEffort accepts credentialId-less input (holderUserId only)', async () => {
  const { service, calls } = setup();

  const result = await service.rebuildBestEffort({
    holderUserId: 'holder-1',
    reason: 'post_issuance'
  });

  assert.deepEqual(calls.rebuilds, ['holder-1']);
  assert.deepEqual(result, { status: 'rebuilt' });
});
