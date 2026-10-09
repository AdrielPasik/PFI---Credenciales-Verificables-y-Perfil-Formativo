import { getAddress } from 'ethers';

import {
  CREDENTIAL_REGISTRY_CONTRACT_NAME,
  FROZEN_COMPILER_SETTINGS,
  SOLIDITY_VERSION
} from './deployment-artifact';
import {
  CANONICAL_DEPLOYMENT_CHAIN_ID,
  CANONICAL_DEPLOYMENT_NETWORK,
  DeploymentIdError,
  deriveCanonicalDeploymentId
} from './deployment-id';

/**
 * Manifest de deployment v1 -- S8c10.1. UN validador autoritativo.
 *
 * Contiene UNICAMENTE hechos on-chain inmutables de UN deployment. Nada mutable:
 * ni RPC, ni ruta de keystore, ni secretRef, ni estado de fondeo, ni readiness,
 * ni estado de AWS, ni estado de verificacion en el explorador.
 *
 * El validador es ESTRICTO: un campo desconocido invalida el manifest. Asi un
 * campo con aspecto de secreto (`privateKey`, `rpcUrl`, ...) no puede colarse
 * en evidencia que se commitea. Los codigos de razon NUNCA reflejan el nombre ni
 * el valor del campo ofensor.
 */

export const DEPLOYMENT_MANIFEST_SCHEMA_VERSION = 'credential_registry_deployment_v1';

/** Orden canonico de los campos (es el orden de serializacion). */
export const DEPLOYMENT_MANIFEST_FIELDS = [
  'schemaVersion',
  'deploymentId',
  'contractName',
  'network',
  'chainId',
  'contractAddress',
  'deploymentTransactionHash',
  'deploymentBlockNumber',
  'deploymentBlockHash',
  'deploymentTimestamp',
  'deployerAddress',
  'deploymentSourceCommit',
  'foundryVersion',
  'solidityVersion',
  'compilerSettings',
  'creationBytecodeHash',
  'runtimeBytecodeHash',
  'constructorArguments'
] as const;

export interface DeploymentManifest {
  schemaVersion: typeof DEPLOYMENT_MANIFEST_SCHEMA_VERSION;
  deploymentId: string;
  contractName: typeof CREDENTIAL_REGISTRY_CONTRACT_NAME;
  network: string;
  chainId: number;
  contractAddress: string;
  deploymentTransactionHash: string;
  deploymentBlockNumber: number;
  deploymentBlockHash: string;
  deploymentTimestamp: string;
  deployerAddress: string;
  deploymentSourceCommit: string;
  foundryVersion: string;
  solidityVersion: string;
  compilerSettings: typeof FROZEN_COMPILER_SETTINGS;
  creationBytecodeHash: string;
  runtimeBytecodeHash: string;
  constructorArguments: [];
}

export type ManifestReasonCode =
  | 'MANIFEST_NOT_AN_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'MISSING_FIELD'
  | 'SCHEMA_VERSION'
  | 'DEPLOYMENT_ID'
  | 'CONTRACT_NAME'
  | 'NETWORK'
  | 'CHAIN_ID'
  | 'CONTRACT_ADDRESS'
  | 'TRANSACTION_HASH'
  | 'BLOCK_NUMBER'
  | 'BLOCK_HASH'
  | 'TIMESTAMP'
  | 'DEPLOYER_ADDRESS'
  | 'SOURCE_COMMIT'
  | 'FOUNDRY_VERSION'
  | 'SOLIDITY_VERSION'
  | 'COMPILER_SETTINGS'
  | 'CREATION_BYTECODE_HASH'
  | 'RUNTIME_BYTECODE_HASH'
  | 'CONSTRUCTOR_ARGUMENTS';

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: DeploymentManifest }
  | { readonly ok: false; readonly reasons: readonly ManifestReasonCode[] };

const HASH32 = /^0x[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const FORGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** EIP-55 EXACTO: ni minuscula, ni mayuscula, ni checksum mixto invalido. */
function isCanonicalChecksumAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !HEX_ADDRESS.test(value)) {
    return false;
  }
  try {
    return getAddress(value) === value;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DDTHH:MM:SSZ` que existe de verdad en el calendario. */
export function isValidUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = TIMESTAMP.exec(value);
  if (!match) {
    return false;
  }
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().replace('.000Z', 'Z') === value
  );
}

export function validateDeploymentManifest(input: unknown): ManifestValidation {
  if (!isRecord(input)) {
    return { ok: false, reasons: ['MANIFEST_NOT_AN_OBJECT'] };
  }

  const reasons: ManifestReasonCode[] = [];
  const allowed = new Set<string>(DEPLOYMENT_MANIFEST_FIELDS);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      reasons.push('UNKNOWN_FIELD');
      break;
    }
  }
  for (const field of DEPLOYMENT_MANIFEST_FIELDS) {
    if (!(field in input)) {
      reasons.push('MISSING_FIELD');
      break;
    }
  }

  if (input.schemaVersion !== DEPLOYMENT_MANIFEST_SCHEMA_VERSION) {
    reasons.push('SCHEMA_VERSION');
  }
  if (input.contractName !== CREDENTIAL_REGISTRY_CONTRACT_NAME) {
    reasons.push('CONTRACT_NAME');
  }
  if (input.network !== CANONICAL_DEPLOYMENT_NETWORK) {
    reasons.push('NETWORK');
  }
  if (input.chainId !== CANONICAL_DEPLOYMENT_CHAIN_ID) {
    reasons.push('CHAIN_ID');
  }
  if (!isCanonicalChecksumAddress(input.contractAddress)) {
    reasons.push('CONTRACT_ADDRESS');
  }
  if (typeof input.deploymentTransactionHash !== 'string' || !HASH32.test(input.deploymentTransactionHash)) {
    reasons.push('TRANSACTION_HASH');
  }
  if (
    typeof input.deploymentBlockNumber !== 'number' ||
    !Number.isSafeInteger(input.deploymentBlockNumber) ||
    input.deploymentBlockNumber <= 0
  ) {
    reasons.push('BLOCK_NUMBER');
  }
  if (typeof input.deploymentBlockHash !== 'string' || !HASH32.test(input.deploymentBlockHash)) {
    reasons.push('BLOCK_HASH');
  }
  if (!isValidUtcTimestamp(input.deploymentTimestamp)) {
    reasons.push('TIMESTAMP');
  }
  if (!isCanonicalChecksumAddress(input.deployerAddress)) {
    reasons.push('DEPLOYER_ADDRESS');
  }
  if (typeof input.deploymentSourceCommit !== 'string' || !COMMIT.test(input.deploymentSourceCommit)) {
    reasons.push('SOURCE_COMMIT');
  }
  if (typeof input.foundryVersion !== 'string' || !FORGE_VERSION.test(input.foundryVersion)) {
    reasons.push('FOUNDRY_VERSION');
  }
  if (input.solidityVersion !== SOLIDITY_VERSION) {
    reasons.push('SOLIDITY_VERSION');
  }
  if (JSON.stringify(input.compilerSettings) !== JSON.stringify(FROZEN_COMPILER_SETTINGS)) {
    reasons.push('COMPILER_SETTINGS');
  }
  if (typeof input.creationBytecodeHash !== 'string' || !HASH32.test(input.creationBytecodeHash)) {
    reasons.push('CREATION_BYTECODE_HASH');
  }
  if (typeof input.runtimeBytecodeHash !== 'string' || !HASH32.test(input.runtimeBytecodeHash)) {
    reasons.push('RUNTIME_BYTECODE_HASH');
  }
  if (!Array.isArray(input.constructorArguments) || input.constructorArguments.length !== 0) {
    reasons.push('CONSTRUCTOR_ARGUMENTS');
  }

  // deploymentId = derivacion canonica de la direccion. No se confia en el
  // string del archivo.
  if (isCanonicalChecksumAddress(input.contractAddress)) {
    try {
      const expected = deriveCanonicalDeploymentId({
        network: input.network,
        chainId: input.chainId,
        contractAddress: input.contractAddress
      });
      if (input.deploymentId !== expected) {
        reasons.push('DEPLOYMENT_ID');
      }
    } catch (error) {
      // Red/chain incorrectas ya se reportaron arriba; la direccion es valida.
      if (!(error instanceof DeploymentIdError)) {
        reasons.push('DEPLOYMENT_ID');
      }
    }
  } else if (typeof input.deploymentId !== 'string') {
    reasons.push('DEPLOYMENT_ID');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: [...new Set(reasons)] };
  }

  return { ok: true, manifest: input as unknown as DeploymentManifest };
}

/** Evidencia OBSERVADA. Ningun campo lo aporta el llamador a mano. */
export interface ObservedDeploymentEvidence {
  contractAddress: string;
  deploymentTransactionHash: string;
  deploymentBlockNumber: number;
  deploymentBlockHash: string;
  deploymentTimestamp: string;
  deployerAddress: string;
  deploymentSourceCommit: string;
  foundryVersion: string;
  creationBytecodeHash: string;
  runtimeBytecodeHash: string;
}

/** Construye el manifest en el orden canonico y lo valida. Lanza si no cierra. */
export function buildDeploymentManifest(
  evidence: ObservedDeploymentEvidence
): DeploymentManifest {
  const candidate = {
    schemaVersion: DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
    deploymentId: deriveCanonicalDeploymentId({
      network: CANONICAL_DEPLOYMENT_NETWORK,
      chainId: CANONICAL_DEPLOYMENT_CHAIN_ID,
      contractAddress: evidence.contractAddress
    }),
    contractName: CREDENTIAL_REGISTRY_CONTRACT_NAME,
    network: CANONICAL_DEPLOYMENT_NETWORK,
    chainId: CANONICAL_DEPLOYMENT_CHAIN_ID,
    contractAddress: evidence.contractAddress,
    deploymentTransactionHash: evidence.deploymentTransactionHash,
    deploymentBlockNumber: evidence.deploymentBlockNumber,
    deploymentBlockHash: evidence.deploymentBlockHash,
    deploymentTimestamp: evidence.deploymentTimestamp,
    deployerAddress: evidence.deployerAddress,
    deploymentSourceCommit: evidence.deploymentSourceCommit,
    foundryVersion: evidence.foundryVersion,
    solidityVersion: SOLIDITY_VERSION,
    compilerSettings: FROZEN_COMPILER_SETTINGS,
    creationBytecodeHash: evidence.creationBytecodeHash,
    runtimeBytecodeHash: evidence.runtimeBytecodeHash,
    constructorArguments: []
  };

  const validation = validateDeploymentManifest(candidate);
  if (!validation.ok) {
    throw new DeploymentManifestError(validation.reasons);
  }

  return validation.manifest;
}

export class DeploymentManifestError extends Error {
  readonly reasons: readonly ManifestReasonCode[];

  constructor(reasons: readonly ManifestReasonCode[]) {
    super('El manifest de deployment no es valido.');
    this.name = 'DeploymentManifestError';
    this.reasons = reasons;
  }
}

/** Serializacion canonica: orden fijo, indentacion de 2 y salto final. */
export function serializeDeploymentManifest(manifest: DeploymentManifest): string {
  const ordered: Record<string, unknown> = {};
  for (const field of DEPLOYMENT_MANIFEST_FIELDS) {
    ordered[field] = manifest[field];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
