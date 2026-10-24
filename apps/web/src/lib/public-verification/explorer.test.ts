import { describe, expect, it } from 'vitest';

import {
  BASESCAN_TRANSACTION_LINK_LABEL,
  buildBaseSepoliaExplorerLinks,
  buildTransactionExplorerUrl
} from './explorer';

const TX = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0xCb7401e268f61b1242B17fE141453471CFbdc6e1';

describe('buildBaseSepoliaExplorerLinks', () => {
  it('builds public links only for a real Base Sepolia registry record', () => {
    expect(buildBaseSepoliaExplorerLinks({
      network: 'base_sepolia', chainId: 84532, evidenceMode: 'credential_registry', txHash: TX, contractAddress: CONTRACT
    })).toEqual({
      transactionUrl: `https://sepolia.basescan.org/tx/${TX}`,
      contractUrl: `https://sepolia.basescan.org/address/${CONTRACT}`
    });
  });

  it('builds nothing for mock evidence, another network or another chain', () => {
    const none = { transactionUrl: null, contractUrl: null };

    expect(buildBaseSepoliaExplorerLinks({ network: 'base_sepolia', chainId: 84532, evidenceMode: 'mock', txHash: TX, contractAddress: CONTRACT })).toEqual(none);
    expect(buildBaseSepoliaExplorerLinks({ network: 'base_sepolia', chainId: 84532, evidenceMode: null, txHash: TX, contractAddress: CONTRACT })).toEqual(none);
    expect(buildBaseSepoliaExplorerLinks({ network: 'anvil', chainId: 31337, evidenceMode: 'credential_registry', txHash: TX, contractAddress: CONTRACT })).toEqual(none);
    expect(buildBaseSepoliaExplorerLinks({ network: 'base_sepolia', chainId: 1, evidenceMode: 'credential_registry', txHash: TX, contractAddress: CONTRACT })).toEqual(none);
  });

  it('never builds a link from a malformed hash or address (no URL injection)', () => {
    const links = buildBaseSepoliaExplorerLinks({
      network: 'base_sepolia', chainId: 84532, evidenceMode: 'credential_registry',
      txHash: '0x1/../../evil', contractAddress: 'javascript:alert(1)'
    });

    expect(links).toEqual({ transactionUrl: null, contractUrl: null });
    expect(buildBaseSepoliaExplorerLinks({
      network: 'base_sepolia', chainId: 84532, evidenceMode: 'credential_registry', txHash: null, contractAddress: null
    })).toEqual({ transactionUrl: null, contractUrl: null });
  });
});

describe('buildTransactionExplorerUrl', () => {
  it('builds the BaseScan URL from the received hash for Base Sepolia (84532)', () => {
    expect(buildTransactionExplorerUrl({ network: 'base_sepolia', chainId: 84532, txHash: TX }))
      .toBe(`https://sepolia.basescan.org/tx/${TX}`);
  });

  it('uses the real production transaction hash, never a fixed value', () => {
    const other = `0x${'12'.repeat(32)}`;
    expect(buildTransactionExplorerUrl({ network: 'base_sepolia', chainId: 84532, txHash: other }))
      .toBe(`https://sepolia.basescan.org/tx/${other}`);
  });

  it.each([null, undefined, '', 'pending', '0x', '0xabc', `0x${'zz'.repeat(32)}`, `${TX}00`, ` ${TX}`])(
    'returns no link for a missing or invalid hash (%s)',
    (txHash) => {
      expect(buildTransactionExplorerUrl({ network: 'base_sepolia', chainId: 84532, txHash: txHash as never })).toBeNull();
    }
  );

  it('does not assume that an unknown network is Base Sepolia', () => {
    for (const [network, chainId] of [['ethereum', 1], ['base', 8453], ['future_network', 999999], ['anvil', 31337], ['mock', 1]] as const) {
      expect(buildTransactionExplorerUrl({ network, chainId, txHash: TX })).toBeNull();
    }
  });

  it('requires the network label and the chain id to describe the same chain', () => {
    expect(buildTransactionExplorerUrl({ network: 'base_sepolia', chainId: 1, txHash: TX })).toBeNull();
    expect(buildTransactionExplorerUrl({ network: 'anvil', chainId: 84532, txHash: TX })).toBeNull();
  });

  it('honours the evidence mode only when the surface reports it', () => {
    const base = { network: 'base_sepolia', chainId: 84532, txHash: TX };
    expect(buildTransactionExplorerUrl({ ...base, evidenceMode: 'credential_registry' })).not.toBeNull();
    expect(buildTransactionExplorerUrl({ ...base, evidenceMode: 'mock' })).toBeNull();
    expect(buildTransactionExplorerUrl({ ...base, evidenceMode: null })).toBeNull();
    expect(buildTransactionExplorerUrl(base)).not.toBeNull();
  });

  it('keeps the public-verifier link behaviour (shared implementation)', () => {
    expect(buildBaseSepoliaExplorerLinks({
      network: 'base_sepolia', chainId: 84532, evidenceMode: 'credential_registry', txHash: TX, contractAddress: CONTRACT
    }).transactionUrl).toBe(`https://sepolia.basescan.org/tx/${TX}`);
    expect(BASESCAN_TRANSACTION_LINK_LABEL).toBe('Ver transacción en BaseScan');
  });
});
