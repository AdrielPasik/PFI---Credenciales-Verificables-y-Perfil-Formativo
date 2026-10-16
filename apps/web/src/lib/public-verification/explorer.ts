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
    transactionUrl:
      record.txHash !== null && TX_HASH_PATTERN.test(record.txHash)
        ? `${BASE_SEPOLIA_EXPLORER_ORIGIN}/tx/${record.txHash}`
        : null,
    contractUrl:
      record.contractAddress !== null && ADDRESS_PATTERN.test(record.contractAddress)
        ? `${BASE_SEPOLIA_EXPLORER_ORIGIN}/address/${record.contractAddress}`
        : null
  };
}
