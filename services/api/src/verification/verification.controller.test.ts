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
    issuer: { displayName: 'Issuer demo', did: null, technicalDid: null },
    holder: { displayLabel: null, did: null },
    issuedAt: null,
    revokedAt: null,
    revocationReason: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    integrity: {
      canonicalHashPresent: false,
      blockchainRecordsCount: 0,
      latestBlockchainRecord: null
    },
    verification: {
      result: 'not_verifiable',
      summary: 'Seguro',
      checkedAt: '2026-08-14T00:00:00.000Z',
      headline: 'INDETERMINATE',
      authenticity: {
        result: 'INDETERMINATE',
        reason: 'LEGACY_UNSIGNED_CREDENTIAL'
      },
      credentialStatus: 'ACTIVE',
      blockchainEvidence: {
        result: 'NOT_FOUND',
        reason: 'NO_BLOCKCHAIN_RECORD'
      }
    }
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

test('S8c7: el controller no decide nada -- solo proyecta a HTTP', async () => {
  // Ni el titular, ni la autenticidad, ni el estado se derivan aca: el
  // controller no tiene una segunda copia de la logica de verificacion.
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const source = readFileSync(join(__dirname, 'verification.controller.ts'), 'utf8');

  for (const forbidden of [
    'deriveVerificationHeadline',
    'deriveCredentialStatus',
    'deriveLegacyVerificationResult',
    'headline',
    'authenticity',
    'prisma',
    'CredentialStatus'
  ]) {
    assert.ok(!source.includes(forbidden), `el controller no debe mencionar ${forbidden}`);
  }
});
