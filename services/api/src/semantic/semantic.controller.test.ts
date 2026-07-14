import assert from 'node:assert/strict';
import test from 'node:test';

import { SemanticController } from './semantic.controller';

test('SemanticController delegates latest semantic analysis lookup to the service', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    credentialId: 'cred-123',
    latestSemanticAnalysis: null
  };

  const controller = new SemanticController({
    async getLatestForCredential(credentialId: string) {
      calls.push(credentialId);
      return expectedResponse;
    }
  } as never);

  const response = await controller.getLatestForCredential('cred-123');

  assert.deepEqual(calls, ['cred-123']);
  assert.deepEqual(response, expectedResponse);
});
