import { getAddress, getCreateAddress, isAddress, keccak256 } from 'ethers';

import { type ValidatedCredentialRegistryArtifact } from './deployment-artifact';
import { CANONICAL_DEPLOYMENT_CHAIN_ID } from './deployment-id';
import { DeploymentOperatorError, type SafeDeploymentContext } from './deployment-errors';

/**
 * Validacion PURA de la evidencia de deployment -- S8c10.1.
 *
 * Nada de I/O. Cada funcion recibe lo que el provider OBSERVO y lo compara
 * contra lo que se esperaba. Ninguna acepta un valor "informado por el
 * operador" para un hecho de cadena.
 */

/** Confirmaciones exigidas ANTES de finalizar. Mas conservador que el 1 de register/revoke. */
export const DEPLOYMENT_ACCEPTANCE_CONFIRMATIONS = 5;

export const DEPLOYMENT_CONFIRMATION_TIMEOUT_MS = 180_000;

const HASH32 = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Formas MINIMAS de lo que el provider devuelve
// ---------------------------------------------------------------------------

export interface ObservedReceipt {
  readonly hash: string;
  readonly status: number | null;
  readonly to: string | null;
  readonly from: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly contractAddress: string | null;
}

export interface ObservedTransaction {
  readonly hash: string;
  readonly to: string | null;
  readonly from: string;
  readonly data: string;
  readonly chainId: bigint | number | null;
}

export interface ObservedBlock {
  readonly number: number;
  readonly hash: string | null;
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Direccion CREATE esperada
// ---------------------------------------------------------------------------

/**
 * Derivacion estandar de Ethereum: keccak(rlp([deployer, nonce]))[12:].
 *
 * Es evidencia de RECUPERACION (permite buscar un deployment cuyo envio quedo
 * ambiguo). NO reemplaza al recibo: la direccion final sale del recibo y debe
 * coincidir con esta.
 */
export function computeExpectedCreateAddress(deployer: string, nonce: number): string {
  if (!isAddress(deployer) || !Number.isSafeInteger(nonce) || nonce < 0) {
    throw new DeploymentOperatorError('DEPLOYMENT_RECEIPT_INVALID');
  }
  return getAddress(getCreateAddress({ from: deployer, nonce }));
}

// ---------------------------------------------------------------------------
// Recibo
// ---------------------------------------------------------------------------

export interface ReceiptExpectations {
  readonly transactionHash: string;
  readonly deployerAddress: string;
  readonly expectedCreateAddress: string;
  readonly context: SafeDeploymentContext;
}

export interface ValidatedReceipt {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly contractAddress: string;
}

export function validateDeploymentReceipt(
  receipt: ObservedReceipt | null,
  expected: ReceiptExpectations
): ValidatedReceipt {
  const fail = (reason: string): never => {
    throw new DeploymentOperatorError('DEPLOYMENT_RECEIPT_INVALID', {
      context: expected.context,
      reasons: [reason]
    });
  };

  if (!receipt) {
    return fail('RECEIPT_MISSING');
  }
  if (receipt.status !== 1) {
    throw new DeploymentOperatorError('DEPLOYMENT_FAILED_RECEIPT', {
      context: expected.context
    });
  }
  if (receipt.to !== null) {
    return fail('RECEIPT_TO_NOT_NULL');
  }
  if (!isAddress(receipt.from) || getAddress(receipt.from) !== getAddress(expected.deployerAddress)) {
    return fail('RECEIPT_FROM_MISMATCH');
  }
  if (typeof receipt.hash !== 'string' || !HASH32.test(receipt.hash) || receipt.hash.toLowerCase() !== expected.transactionHash.toLowerCase()) {
    return fail('RECEIPT_HASH_MISMATCH');
  }
  if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0) {
    return fail('RECEIPT_BLOCK_NUMBER');
  }
  if (typeof receipt.blockHash !== 'string' || !HASH32.test(receipt.blockHash)) {
    return fail('RECEIPT_BLOCK_HASH');
  }
  if (!receipt.contractAddress) {
    return fail('RECEIPT_CONTRACT_ADDRESS_MISSING');
  }
  if (!isAddress(receipt.contractAddress)) {
    return fail('RECEIPT_CONTRACT_ADDRESS_INVALID');
  }

  const contractAddress = getAddress(receipt.contractAddress);
  if (contractAddress !== getAddress(expected.expectedCreateAddress)) {
    return fail('RECEIPT_CONTRACT_ADDRESS_NOT_EXPECTED_CREATE');
  }

  return {
    transactionHash: receipt.hash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash.toLowerCase(),
    contractAddress
  };
}

// ---------------------------------------------------------------------------
// Transaccion
// ---------------------------------------------------------------------------

/**
 * La transaccion observada debe ser LA creacion del artefacto revisado: sin
 * destinatario, del deployer esperado y con `data` IGUAL al creation bytecode
 * (no hay argumentos de constructor, asi que no se agrega nada).
 */
export function verifyDeploymentTransaction(
  transaction: ObservedTransaction | null,
  expected: {
    deployerAddress: string;
    artifact: ValidatedCredentialRegistryArtifact;
    context: SafeDeploymentContext;
  }
): void {
  const mismatch = (reason: string): never => {
    throw new DeploymentOperatorError('DEPLOYMENT_TRANSACTION_MISMATCH', {
      context: expected.context,
      reasons: [reason]
    });
  };

  if (!transaction) {
    return mismatch('TRANSACTION_MISSING');
  }
  if (transaction.to !== null) {
    return mismatch('TRANSACTION_TO_NOT_NULL');
  }
  if (!isAddress(transaction.from) || getAddress(transaction.from) !== getAddress(expected.deployerAddress)) {
    return mismatch('TRANSACTION_FROM_MISMATCH');
  }
  if (
    transaction.chainId !== null &&
    BigInt(transaction.chainId) !== BigInt(CANONICAL_DEPLOYMENT_CHAIN_ID)
  ) {
    return mismatch('TRANSACTION_CHAIN_MISMATCH');
  }
  if (
    typeof transaction.data !== 'string' ||
    transaction.data.toLowerCase() !== expected.artifact.creationBytecode
  ) {
    return mismatch('TRANSACTION_DATA_NOT_REVIEWED_CREATION_BYTECODE');
  }
}

// ---------------------------------------------------------------------------
// Codigo runtime
// ---------------------------------------------------------------------------

/**
 * Igualdad EXACTA (insensible a mayusculas) entre el codigo on-chain y el
 * runtime del artefacto, mas el hash. Sin recortar metadata, sin prefijos, y
 * "hay codigo" NO alcanza.
 */
export function verifyDeployedRuntimeCode(
  chainCode: string,
  artifact: ValidatedCredentialRegistryArtifact,
  context: SafeDeploymentContext
): void {
  if (typeof chainCode !== 'string' || chainCode === '0x' || chainCode === '') {
    throw new DeploymentOperatorError('DEPLOYMENT_CODE_EMPTY', { context });
  }

  const normalized = chainCode.toLowerCase();
  if (
    normalized !== artifact.runtimeBytecode ||
    keccak256(normalized) !== artifact.runtimeBytecodeHash
  ) {
    throw new DeploymentOperatorError('DEPLOYMENT_IDENTITY_MISMATCH', { context });
  }
}

// ---------------------------------------------------------------------------
// Bloque y timestamp
// ---------------------------------------------------------------------------

/** UTC `YYYY-MM-DDTHH:MM:SSZ` exacto desde `block.timestamp` (segundos). */
export function formatBlockTimestampUtc(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new DeploymentOperatorError('DEPLOYMENT_BLOCK_INVALID', {
      reasons: ['BLOCK_TIMESTAMP_INVALID']
    });
  }
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}

export function verifyDeploymentBlock(
  block: ObservedBlock | null,
  receipt: ValidatedReceipt,
  context: SafeDeploymentContext
): { blockHash: string; deploymentTimestamp: string } {
  const invalid = (reason: string): never => {
    throw new DeploymentOperatorError('DEPLOYMENT_BLOCK_INVALID', {
      context,
      reasons: [reason]
    });
  };

  if (!block) {
    return invalid('BLOCK_MISSING');
  }
  if (block.number !== receipt.blockNumber) {
    return invalid('BLOCK_NUMBER_MISMATCH');
  }
  if (typeof block.hash !== 'string' || !HASH32.test(block.hash)) {
    return invalid('BLOCK_HASH_MALFORMED');
  }
  if (block.hash.toLowerCase() !== receipt.blockHash) {
    return invalid('BLOCK_HASH_MISMATCH');
  }

  return {
    blockHash: block.hash.toLowerCase(),
    deploymentTimestamp: formatBlockTimestampUtc(block.timestamp)
  };
}
