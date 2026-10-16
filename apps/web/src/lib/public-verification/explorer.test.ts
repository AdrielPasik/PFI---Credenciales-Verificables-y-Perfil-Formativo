import { describe, expect, it } from 'vitest';

import { buildBaseSepoliaExplorerLinks } from './explorer';

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
