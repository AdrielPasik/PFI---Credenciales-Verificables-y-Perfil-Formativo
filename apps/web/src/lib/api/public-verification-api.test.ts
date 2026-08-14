import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/api-client', () => ({
  createApiClient: () => ({ request })
}));

import { getPublicCredentialVerificationRequest } from './public-verification-api';

describe('getPublicCredentialVerificationRequest', () => {
  beforeEach(() => request.mockReset());

  it('uses the public endpoint without an authenticated request or token', async () => {
    request.mockResolvedValue({
      credentialReference: 'credential-1', exists: true, status: 'issued', statusLabel: 'Emitida', title: 'Curso', type: 'course', typeLabel: 'Curso', issuer: { displayName: 'Issuer', did: null }, holder: { displayLabel: null, did: null }, issuedAt: null, revokedAt: null, revocationReason: null, canonicalHash: null, canonicalHashShort: null, canonicalizationVersion: null,
      integrity: { canonicalHashPresent: false, blockchainRecordsCount: 0, latestBlockchainRecord: null }, verification: { result: 'not_verifiable', summary: 'Seguro', checkedAt: '2026-08-14T00:00:00.000Z' }
    });

    await getPublicCredentialVerificationRequest('credential-1');

    expect(request).toHaveBeenCalledWith('/verify/credentials/credential-1');
    expect(request.mock.calls[0]?.[1]).toBeUndefined();
  });
});
