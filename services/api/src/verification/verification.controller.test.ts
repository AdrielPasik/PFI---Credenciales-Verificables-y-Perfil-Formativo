import assert from 'node:assert/strict';
import test from 'node:test';

import { VerificationController } from './verification.controller';

test('public VerificationController delegates only the credential reference and has no auth dependency', async () => {
  const calls: string[] = [];
  const expectedResponse = {
    credentialReference: 'credential-1',
    exists: true,
    status: 'issued',
    statusLabel: 'Emitida',
    title: 'Curso demo',
    type: 'course',
    typeLabel: 'Curso',
    issuer: { displayName: 'Issuer demo', did: null },
    holder: { displayLabel: null, did: null },
    issuedAt: null,
    revokedAt: null,
    revocationReason: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    integrity: { canonicalHashPresent: false, blockchainRecordsCount: 0, latestBlockchainRecord: null },
    verification: { result: 'not_verifiable', summary: 'Seguro', checkedAt: '2026-08-14T00:00:00.000Z' }
  };
  const controller = new VerificationController({
    async getCredentialVerification(credentialId: string) {
      calls.push(credentialId);
      return expectedResponse;
    }
  } as never);

  const response = await controller.getCredentialVerification('credential-1');

  assert.deepEqual(calls, ['credential-1']);
  assert.deepEqual(response, expectedResponse);
});
