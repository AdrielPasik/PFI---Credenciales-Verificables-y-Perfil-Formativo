/**
 * Enlaces al explorador de Base Sepolia, construidos SOLO con datos PUBLICOS.
 *
 * El navegador no recibe ningun RPC ni credencial: un enlace a un explorador
 * es una URL publica armada con el hash de la transaccion y la direccion del
 * contrato que ya devuelve `GET /verify/credentials/:id`.
 *
 * Solo se arma cuando el registro es REAL (`credential_registry`) y la red y la
 * cadena corresponden a Base Sepolia. Una fila `mock` o de otra red no produce
 * ningun enlace: apuntar un explorador publico a una transaccion simulada seria
 * presentar evidencia inexistente como si estuviera en una red publica.
 */

export const BASE_SEPOLIA_EXPLORER_ORIGIN = 'https://sepolia.basescan.org';
const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Texto del enlace a la transaccion en el explorador de la red actual. */
export const BASESCAN_TRANSACTION_LINK_LABEL = 'Ver transacción en BaseScan';

/**
 * Explorador por CADENA efectiva. Solo las redes listadas aca producen enlaces:
 * una red desconocida NO hereda el explorador de Base Sepolia. Cada entrada exige
 * que la etiqueta de red coincida con el `chainId` (una fila `base_sepolia` con
 * otro chainId no describe una cadena publica coherente y no genera enlace).
 */
const EXPLORERS_BY_CHAIN_ID: Readonly<Record<number, { network: string; origin: string }>> = {
  [BASE_SEPOLIA_CHAIN_ID]: { network: 'base_sepolia', origin: BASE_SEPOLIA_EXPLORER_ORIGIN }
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export interface ExplorerRecordInput {
  network: string;
  chainId: number;
  evidenceMode: 'mock' | 'credential_registry' | null;
  txHash: string | null;
  contractAddress: string | null;
}

export interface ExplorerLinks {
  transactionUrl: string | null;
  contractUrl: string | null;
}

/**
 * URL de la transaccion en el explorador de la red, o `null`.
 *
 * Solo con un hash de transaccion REAL (32 bytes hex), una red soportada cuyo
 * `chainId` coincide con su etiqueta y, si la superficie informa el modo de
 * evidencia, solo en `credential_registry`. Las superficies que no lo informan
 * (wallet del titular, detalle del emisor) lo omiten: una fila simulada
 * es `anvil`/31337 y por eso nunca resuelve un explorador.
 *
 * Es una URL publica armada con datos que ya devuelve el backend: sin consultas
 * a la cadena ni a la API del explorador.
 */
export function buildTransactionExplorerUrl(input: {
  network: string;
  chainId: number;
  txHash: string | null | undefined;
  evidenceMode?: 'mock' | 'credential_registry' | null;
}): string | null {
  const explorer = EXPLORERS_BY_CHAIN_ID[input.chainId];

  if (
    !explorer ||
    explorer.network !== input.network ||
    (input.evidenceMode !== undefined && input.evidenceMode !== 'credential_registry')
  ) {
    return null;
  }

  return typeof input.txHash === 'string' && TX_HASH_PATTERN.test(input.txHash)
    ? `${explorer.origin}/tx/${input.txHash}`
    : null;
}

export function buildBaseSepoliaExplorerLinks(
  record: ExplorerRecordInput
): ExplorerLinks {
  const real =
    record.network === 'base_sepolia' &&
    record.chainId === BASE_SEPOLIA_CHAIN_ID &&
    record.evidenceMode === 'credential_registry';

  if (!real) {
    return { transactionUrl: null, contractUrl: null };
  }

  return {
    transactionUrl: buildTransactionExplorerUrl(record),
    contractUrl:
      record.contractAddress !== null && ADDRESS_PATTERN.test(record.contractAddress)
        ? `${BASE_SEPOLIA_EXPLORER_ORIGIN}/address/${record.contractAddress}`
        : null
  };
}
