import { readFileSync } from 'node:fs';

import {
  CREDENTIAL_REGISTRY_CONTRACT_NAME,
  FROZEN_COMPILER_SETTINGS,
  SOLIDITY_VERSION,
  type ValidatedCredentialRegistryArtifact
} from './deployment-artifact';
import {
  CANONICAL_DEPLOYMENT_CHAIN_ID,
  CANONICAL_DEPLOYMENT_NETWORK
} from './deployment-id';
import { DeploymentOperatorError } from './deployment-errors';

/**
 * Identidad de la toolchain de deployment -- S8c10.1.
 *
 * La version del binario de Foundry no puede quedar como procedencia invisible.
 * `contracts/deployments/deployment-toolchain.json` es el UNICO archivo del
 * repositorio que la declara, y la preparacion del deployment la compara con la
 * instalada ANTES de aceptar un build. No se instala ni se actualiza nada: una
 * diferencia FALLA CERRADO.
 *
 * Ademas fija los hashes del artefacto REVISADO. Si el codigo Solidity, los
 * settings o los bytes de la fuente (incluidos los fines de linea) cambian, el
 * build deja de coincidir y el deployment no se prepara hasta que alguien revise
 * y actualice este archivo.
 */

export const TOOLCHAIN_SCHEMA_VERSION = 'credential_registry_deployment_toolchain_v1';

const FORGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;

export interface DeploymentToolchain {
  schemaVersion: typeof TOOLCHAIN_SCHEMA_VERSION;
  contractName: typeof CREDENTIAL_REGISTRY_CONTRACT_NAME;
  network: string;
  chainId: number;
  requiredForgeVersion: string;
  requiredForgeCommitSha: string;
  solcVersion: string;
  compilerSettings: typeof FROZEN_COMPILER_SETTINGS;
  reviewedArtifact: { creationBytecodeHash: string; runtimeBytecodeHash: string };
}

export class DeploymentToolchainError extends Error {
  constructor() {
    super('La configuracion de toolchain de deployment no es valida.');
    this.name = 'DeploymentToolchainError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valida el archivo de toolchain. Estricto: un campo desconocido lo invalida. */
export function parseDeploymentToolchain(raw: unknown): DeploymentToolchain {
  if (!isRecord(raw)) {
    throw new DeploymentToolchainError();
  }

  const keys = [
    'schemaVersion',
    'contractName',
    'network',
    'chainId',
    'requiredForgeVersion',
    'requiredForgeCommitSha',
    'solcVersion',
    'compilerSettings',
    'reviewedArtifact'
  ];
  const reviewed = raw.reviewedArtifact;

  if (
    Object.keys(raw).sort().join() !== [...keys].sort().join() ||
    raw.schemaVersion !== TOOLCHAIN_SCHEMA_VERSION ||
    raw.contractName !== CREDENTIAL_REGISTRY_CONTRACT_NAME ||
    raw.network !== CANONICAL_DEPLOYMENT_NETWORK ||
    raw.chainId !== CANONICAL_DEPLOYMENT_CHAIN_ID ||
    typeof raw.requiredForgeVersion !== 'string' ||
    !FORGE_VERSION_PATTERN.test(raw.requiredForgeVersion) ||
    typeof raw.requiredForgeCommitSha !== 'string' ||
    !COMMIT_SHA.test(raw.requiredForgeCommitSha) ||
    raw.solcVersion !== SOLIDITY_VERSION ||
    JSON.stringify(raw.compilerSettings) !== JSON.stringify(FROZEN_COMPILER_SETTINGS) ||
    !isRecord(reviewed) ||
    Object.keys(reviewed).sort().join() !== 'creationBytecodeHash,runtimeBytecodeHash' ||
    typeof reviewed.creationBytecodeHash !== 'string' ||
    !HASH.test(reviewed.creationBytecodeHash) ||
    typeof reviewed.runtimeBytecodeHash !== 'string' ||
    !HASH.test(reviewed.runtimeBytecodeHash)
  ) {
    throw new DeploymentToolchainError();
  }

  return raw as unknown as DeploymentToolchain;
}

export function readDeploymentToolchainFile(path: string): DeploymentToolchain {
  try {
    return parseDeploymentToolchain(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    throw new DeploymentToolchainError();
  }
}

export interface ForgeVersionIdentity {
  version: string;
  commitSha: string;
}

/**
 * Normaliza la salida de `forge --version`:
 *
 *   forge Version: 1.2.3-stable
 *   Commit SHA: a813a2c...
 *   Build Timestamp: ...
 *
 * Tolera CRLF. Solo la version y el SHA completo cuentan: la fecha de build y el
 * perfil no son identidad.
 */
export function parseForgeVersionOutput(output: string): ForgeVersionIdentity | null {
  const version = /^\s*forge Version:\s*(\S+)\s*$/im.exec(output)?.[1];
  const commitSha = /^\s*Commit SHA:\s*([0-9a-f]{40})\s*$/im.exec(output)?.[1];

  if (!version || !FORGE_VERSION_PATTERN.test(version) || !commitSha) {
    return null;
  }

  return { version, commitSha };
}

/** FALLA CERRADO ante cualquier diferencia o salida no reconocible. */
export function assertForgeMatchesToolchain(
  forgeVersionOutput: string,
  toolchain: DeploymentToolchain
): ForgeVersionIdentity {
  const identity = parseForgeVersionOutput(forgeVersionOutput);

  if (
    !identity ||
    identity.version !== toolchain.requiredForgeVersion ||
    identity.commitSha !== toolchain.requiredForgeCommitSha
  ) {
    throw new DeploymentOperatorError('TOOLCHAIN_MISMATCH');
  }

  return identity;
}

/** El build debe producir EXACTAMENTE el artefacto revisado. */
export function assertArtifactMatchesReviewedHashes(
  artifact: ValidatedCredentialRegistryArtifact,
  toolchain: DeploymentToolchain
): void {
  if (
    artifact.creationBytecodeHash !== toolchain.reviewedArtifact.creationBytecodeHash ||
    artifact.runtimeBytecodeHash !== toolchain.reviewedArtifact.runtimeBytecodeHash
  ) {
    throw new DeploymentOperatorError('ARTIFACT_INVALID', {
      reasons: ['ARTIFACT_HASH_DIFFERS_FROM_REVIEWED']
    });
  }
}
