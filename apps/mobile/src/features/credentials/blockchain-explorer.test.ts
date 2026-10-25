import { buildTransactionExplorerUrl } from '@/features/credentials/blockchain-explorer';

const HASH = `0x${'a'.repeat(64)}`;

describe('explorador blockchain', () => {
  it('construye BaseScan sólo para Base Sepolia y un hash válido', () => {
    expect(buildTransactionExplorerUrl({ network: 'base-sepolia', chainId: 84532, txHash: HASH }))
      .toBe(`https://sepolia.basescan.org/tx/${HASH}`);
  });

  it.each([
    { network: 'base-sepolia', chainId: 84532, txHash: null },
    { network: 'anvil', chainId: 31337, txHash: HASH },
    { network: 'base-sepolia', chainId: 84532, txHash: '0x123' }
  ])('no inventa un explorador para datos no verificables', (input) => {
    expect(buildTransactionExplorerUrl(input)).toBeNull();
  });
});
