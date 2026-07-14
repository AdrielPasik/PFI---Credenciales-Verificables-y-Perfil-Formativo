import assert from 'node:assert/strict';
import test from 'node:test';

import { VerificationController } from './verification.controller';

test('VerificationController delegates credential verification lookup to the service', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    credentialId: 'cred-123',
    verificationStatus: 'draft',
    credential: {
      id: 'cred-123',
      title: 'Materia demo',
      status: 'draft',
      issuedAt: null,
      revokedAt: null,
      revocationReason: null,
      canonicalHash: null,
      canonicalizationVersion: null
    },
    blockchain: {
      records: []
    },
    semanticAnalysis: {
      latest: null
    }
  };

  const controller = new VerificationController({
    async getCredentialVerification(credentialId: string) {
      calls.push(credentialId);
      return expectedResponse;
    }
  } as never);

  const response = await controller.getCredentialVerification('cred-123');

  assert.deepEqual(calls, ['cred-123']);
  assert.deepEqual(response, expectedResponse);
});
