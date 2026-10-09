import { getAddress, isAddress } from 'ethers';

import {
  FINAL_TARGET_NETWORK,
  chainIdForCredentialRegistryNetwork
} from '../blockchain-target';

/**
 * Identidad canonica del deployment -- S8c10.1.
 *
 *   deploymentId = "base-sepolia-84532-" + lowercase(contractAddress)
 *
 * donde la direccion conserva el prefijo `0x` y tiene exactamente 40 hex. UNA
 * sola implementacion.
 *
 * Propiedades: determinista a partir de lo que la cadena confirmo, direccion
 * COMPLETA (sin truncar), sin fecha, sin etiqueta humana de version, sin hash
 * de bytecode ni de transaccion. Mide 61 caracteres, dentro del limite de 64 del
 * backend.
 *
 * Es OPACO para el backend: ningun codigo parsea este formato. Lo unico que el
 * backend compara es la igualdad exacta del string.
 */

/** Red y chain del unico deployment canonico. Derivados del mapeo unico de S8c5. */
export const CANONICAL_DEPLOYMENT_NETWORK = FINAL_TARGET_NETWORK;
export const CANONICAL_DEPLOYMENT_CHAIN_ID = chainIdForCredentialRegistryNetwork(
  CANONICAL_DEPLOYMENT_NETWORK
);

/** `base_sepolia` -> `base-sepolia`, igual que el `@map` de Prisma. */
const NETWORK_SLUG = CANONICAL_DEPLOYMENT_NETWORK.replace(/_/g, '-');

export const CANONICAL_DEPLOYMENT_ID_PREFIX = `${NETWORK_SLUG}-${CANONICAL_DEPLOYMENT_CHAIN_ID}-`;

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type DeploymentIdErrorCode =
  | 'WRONG_NETWORK'
  | 'WRONG_CHAIN'
  | 'INVALID_ADDRESS';

export class DeploymentIdError extends Error {
  readonly code: DeploymentIdErrorCode;

  constructor(code: DeploymentIdErrorCode) {
    super(
      code === 'WRONG_NETWORK'
        ? 'La red no es la del deployment canonico.'
        : code === 'WRONG_CHAIN'
          ? 'El chainId no es el del deployment canonico.'
          : 'La direccion del contrato no es valida.'
    );
    this.name = 'DeploymentIdError';
    this.code = code;
  }
}

/**
 * Direccion de contrato canonica (EIP-55), o lanza. Exige `0x` + 40 hex (ethers
 * acepta 40 hex SIN prefijo), rechaza un checksum mixto invalido y la direccion
 * cero.
 */
export function normalizeContractAddress(raw: unknown): string {
  if (typeof raw !== 'string' || !HEX_ADDRESS.test(raw) || !isAddress(raw)) {
    throw new DeploymentIdError('INVALID_ADDRESS');
  }

  const checksummed = getAddress(raw);
  if (checksummed.toLowerCase() === ZERO_ADDRESS) {
    throw new DeploymentIdError('INVALID_ADDRESS');
  }

  return checksummed;
}

export function deriveCanonicalDeploymentId(input: {
  network: unknown;
  chainId: unknown;
  contractAddress: unknown;
}): string {
  if (input.network !== CANONICAL_DEPLOYMENT_NETWORK) {
    throw new DeploymentIdError('WRONG_NETWORK');
  }
  if (input.chainId !== CANONICAL_DEPLOYMENT_CHAIN_ID) {
    throw new DeploymentIdError('WRONG_CHAIN');
  }

  return `${CANONICAL_DEPLOYMENT_ID_PREFIX}${normalizeContractAddress(
    input.contractAddress
  ).toLowerCase()}`;
}
