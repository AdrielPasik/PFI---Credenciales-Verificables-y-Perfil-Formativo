const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Sólo las cadenas públicas conocidas construyen enlaces externos. */
const EXPLORER_BY_CHAIN: Readonly<Record<number, { network: string; origin: string }>> = {
  84532: { network: 'base-sepolia', origin: 'https://sepolia.basescan.org' }
};

export function buildTransactionExplorerUrl(input: {
  network: string;
  chainId: number;
  txHash: string | null;
}): string | null {
  const explorer = EXPLORER_BY_CHAIN[input.chainId];
  if (!explorer || explorer.network !== input.network || input.txHash === null || !TX_HASH.test(input.txHash)) {
    return null;
  }
  return `${explorer.origin}/tx/${input.txHash}`;
}
