import { describe, expect, it } from 'vitest';

import {
  abbreviateIntegrityReference,
  formatBlockchainEvidenceStatus,
  formatBlockchainNetwork,
  formatIntegrityDate
} from '@/lib/formatters/credential-integrity';

describe('credential integrity formatters', () => {
  it('abbreviates long technical references without changing short values', () => {
    const hash = `0x${'a'.repeat(64)}`;

    expect(abbreviateIntegrityReference(hash)).toBe(
      `${hash.slice(0, 12)}…${hash.slice(-8)}`
    );
    expect(abbreviateIntegrityReference('canon_v1')).toBe('canon_v1');
  });

  it('formats dates and restrained network/status labels', () => {
    expect(formatIntegrityDate('2026-08-06T12:00:00.000Z')).toBeTruthy();
    expect(formatBlockchainNetwork('anvil')).toBe('Entorno técnico/demo');
    expect(formatBlockchainNetwork('base-sepolia')).toBe('Testnet');
    expect(formatBlockchainNetwork('base-mainnet')).toBe('Red técnica');
    expect(formatBlockchainEvidenceStatus('registered')).toBe('Registrada');
    expect(formatBlockchainEvidenceStatus('future')).toBe('Estado técnico');
  });
});
