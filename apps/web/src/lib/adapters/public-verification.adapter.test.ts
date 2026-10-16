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
    proof: null,
    integrity: { canonicalHashPresent: true, blockchainRecordsCount: 1, latestBlockchainRecord: { network: 'anvil', networkLabel: 'Entorno técnico/demo', chainId: 31337, txHash: `0x${'b'.repeat(64)}`, txHashShort: '0xbbbbbbbb…bbbbbb', status: 'registered', statusLabel: 'Registro técnico disponible', registeredAt: '2026-08-14T10:01:00.000Z', evidenceMode: 'mock', contractAddress: null, deploymentId: null, blockNumber: null, registrantAddress: null, revokedAt: null } },
    verification: { result: 'valid_issued', summary: 'Resultado seguro.', checkedAt: '2026-08-14T10:02:00.000Z', headline: 'VERIFIED_WITH_LIMITED_EVIDENCE', authenticity: { result: 'VERIFIED', reason: 'PROOF_VERIFIED' }, blockchainEvidence: { result: 'NOT_APPLICABLE_MOCK', reason: 'MOCK_EVIDENCE_RECORD' } },
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
      verification: { result: 'revoked', summary: 'Revocada.', checkedAt: '2026-08-15T10:01:00.000Z', headline: 'REVOKED', authenticity: { result: 'VERIFIED', reason: 'PROOF_VERIFIED' }, blockchainEvidence: { result: 'REVOKED_ON_CHAIN', reason: 'CHAIN_STATE_OBSERVED' } }
    }));

    expect(result.status).toBe('revoked');
    expect(result.holderLabel).toBeNull();
  });

  it('maps the authoritative verdict, the proof and the full public chain coordinates', () => {
    const contract = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';
    const registrant = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
    const result = adaptPublicCredentialVerification(payload({
      canonicalHash: `0x${'c'.repeat(64)}`,
      proof: {
        type: 'ScopeCredentialProof2026',
        profile: 'scope-proof-v1',
        cryptosuite: 'ecdsa-secp256k1-eip191',
        proofPurpose: 'assertionMethod',
        verificationMethod: 'did:web:api.example:did:issuers:i#assert-1',
        canonicalizationVersion: 'canon_v2',
        hashAlgorithm: 'sha-256',
        proofValue: `0x${'d'.repeat(130)}`,
        signerAddress: 'private-extra'
      },
      integrity: {
        canonicalHashPresent: true,
        blockchainRecordsCount: 1,
        latestBlockchainRecord: {
          network: 'base_sepolia',
          networkLabel: 'Testnet',
          chainId: 84532,
          txHash: `0x${'e'.repeat(64)}`,
          txHashShort: '0xeeeeeeee…eeeeee',
          status: 'registered',
          statusLabel: 'Registro técnico disponible',
          registeredAt: '2026-10-16T10:01:00.000Z',
          evidenceMode: 'credential_registry',
          contractAddress: contract,
          deploymentId: 'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1',
          blockNumber: 47934900,
          registrantAddress: registrant,
          revokedAt: null
        }
      },
      verification: {
        result: 'valid_issued',
        summary: 'Verificada.',
        checkedAt: '2026-10-16T10:02:00.000Z',
        headline: 'VERIFIED',
        authenticity: { result: 'VERIFIED', reason: 'PROOF_VERIFIED' },
        blockchainEvidence: { result: 'REGISTERED', reason: 'CHAIN_STATE_OBSERVED' }
      }
    }));

    expect(result.verification.headline).toBe('VERIFIED');
    expect(result.verification.authenticity.result).toBe('VERIFIED');
    expect(result.verification.blockchainEvidence.result).toBe('REGISTERED');
    expect(result.canonicalHash).toBe(`0x${'c'.repeat(64)}`);
    expect(result.proof).toEqual({
      cryptosuite: 'ecdsa-secp256k1-eip191',
      verificationMethod: 'did:web:api.example:did:issuers:i#assert-1',
      proofValue: `0x${'d'.repeat(130)}`
    });
    expect(JSON.stringify(result)).not.toContain('private-extra');
    expect(result.integrity.latestBlockchainRecord).toMatchObject({
      network: 'base_sepolia',
      evidenceMode: 'credential_registry',
      txHash: `0x${'e'.repeat(64)}`,
      contractAddress: contract,
      blockNumber: 47934900,
      registrantAddress: registrant
    });
  });

  it('never invents a verdict: a missing or unknown headline is rejected', () => {
    const base = payload() as { verification: Record<string, unknown> };

    for (const headline of [undefined, null, '', 'valid_issued', 'verified', 'OK']) {
      expect(() => adaptPublicCredentialVerification(payload({
        verification: { ...base.verification, headline }
      }))).toThrow(IncompatiblePayloadError);
    }

    expect(() => adaptPublicCredentialVerification(payload({
      verification: { ...base.verification, authenticity: undefined }
    }))).toThrow(IncompatiblePayloadError);
    expect(() => adaptPublicCredentialVerification(payload({
      verification: { ...base.verification, blockchainEvidence: { result: 'MAYBE', reason: 'X' } }
    }))).toThrow(IncompatiblePayloadError);
  });

  it('rejects an unknown network or evidence mode instead of guessing', () => {
    const base = payload() as { integrity: { latestBlockchainRecord: Record<string, unknown> } };
    for (const patch of [{ network: 'mainnet' }, { evidenceMode: 'real' }, { blockNumber: -1 }, { contractAddress: undefined }]) {
      expect(() => adaptPublicCredentialVerification(payload({
        integrity: { ...base.integrity, latestBlockchainRecord: { ...base.integrity.latestBlockchainRecord, ...patch } }
      }))).toThrow(IncompatiblePayloadError);
    }
  });

  it('rejects incomplete payloads instead of showing partial public data', () => {
    expect(() => adaptPublicCredentialVerification(null)).toThrow(IncompatiblePayloadError);
    expect(() => adaptPublicCredentialVerification(payload({ status: 'draft' }))).toThrow(IncompatiblePayloadError);
    expect(() => adaptPublicCredentialVerification(payload({ holder: {} }))).toThrow(IncompatiblePayloadError);
  });
});
