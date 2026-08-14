import { describe, expect, it } from 'vitest';

import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import { adaptPublicCredentialVerification } from './public-verification.adapter';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    credentialReference: 'credential-1',
    exists: true,
    status: 'issued',
    statusLabel: 'Emitida',
    title: 'Curso de gestión',
    type: 'course',
    typeLabel: 'Curso',
    issuer: { displayName: 'Institución demo', did: 'did:example:issuer' },
    holder: { displayLabel: 'Titular demo', did: null },
    issuedAt: '2026-08-14T10:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    canonicalHash: `0x${'a'.repeat(64)}`,
    canonicalHashShort: '0xaaaaaaaa…aaaaaa',
    canonicalizationVersion: 'canon_v1',
    integrity: { canonicalHashPresent: true, blockchainRecordsCount: 1, latestBlockchainRecord: { network: 'anvil', networkLabel: 'Entorno técnico/demo', chainId: 31337, txHash: `0x${'b'.repeat(64)}`, txHashShort: '0xbbbbbbbb…bbbbbb', status: 'registered', statusLabel: 'Registro técnico disponible', registeredAt: '2026-08-14T10:01:00.000Z' } },
    verification: { result: 'valid_issued', summary: 'Resultado seguro.', checkedAt: '2026-08-14T10:02:00.000Z' },
    ...overrides
  };
}

describe('adaptPublicCredentialVerification', () => {
  it('maps only the public allowlist and discards accidental private extras', () => {
    const result = adaptPublicCredentialVerification(payload({
      holder: { displayLabel: 'Titular demo', did: null, email: 'private@example.com' },
      rawData: { private: true },
      metadata: { private: true },
      analysisJson: { private: true },
      sourceRefs: ['private'],
      evidenceMap: { private: true },
      textForEmbedding: 'private text',
      storageKey: 'private/path'
    }));

    const serialized = JSON.stringify(result);
    expect(result.holderLabel).toBe('Titular demo');
    for (const value of ['private@example.com', 'rawData', 'analysisJson', 'sourceRefs', 'evidenceMap', 'textForEmbedding', 'storageKey']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('supports a revoked public result and nullable holder data', () => {
    const result = adaptPublicCredentialVerification(payload({
      status: 'revoked',
      statusLabel: 'Revocada',
      holder: { displayLabel: null, did: null },
      revokedAt: '2026-08-15T10:00:00.000Z',
      verification: { result: 'revoked', summary: 'Revocada.', checkedAt: '2026-08-15T10:01:00.000Z' }
    }));

    expect(result.status).toBe('revoked');
    expect(result.holderLabel).toBeNull();
  });

  it('rejects incomplete payloads instead of showing partial public data', () => {
    expect(() => adaptPublicCredentialVerification(null)).toThrow(IncompatiblePayloadError);
    expect(() => adaptPublicCredentialVerification(payload({ status: 'draft' }))).toThrow(IncompatiblePayloadError);
    expect(() => adaptPublicCredentialVerification(payload({ holder: {} }))).toThrow(IncompatiblePayloadError);
  });
});
