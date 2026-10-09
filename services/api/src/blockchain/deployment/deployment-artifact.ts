import { readFileSync } from 'node:fs';

import { Interface, keccak256 } from 'ethers';

/**
 * Identidad del artefacto compilado -- S8c10.1. PURO salvo `readArtifactFile`.
 *
 * Foundry COMPILA; esta capa solo LEE el artefacto y comprueba que cumple el
 * contrato que hace valida la comparacion EXACTA del bytecode runtime:
 *
 *   - ningun argumento de constructor;
 *   - ninguna libreria enlazada (`linkReferences` vacio);
 *   - ningun immutable (`immutableReferences` vacio o ausente);
 *   - el runtime esta contenido tal cual dentro del creation code (el
 *     constructor solo copia el runtime, sin sustituir nada).
 *
 * Si un contrato futuro rompe cualquiera de esas cuatro cosas, este validador
 * FALLA hasta que se rediseñe la comparacion. No hay normalizacion ni recorte de
 * metadata: se comparan los bytes completos.
 */

export const CREDENTIAL_REGISTRY_CONTRACT_NAME = 'CredentialRegistry';
export const CREDENTIAL_REGISTRY_SOURCE_PATH = 'src/CredentialRegistry.sol';
export const SOLIDITY_VERSION = '0.8.26';

/** Settings de compilacion CONGELADOS (los que se auditaron en S8c10 Phase 0). */
export const FROZEN_COMPILER_SETTINGS = Object.freeze({
  optimizer: Object.freeze({ enabled: false, runs: 200 }),
  viaIR: false,
  evmVersion: 'cancun',
  bytecodeHash: 'ipfs'
});

export interface CompilerSettings {
  optimizer: { enabled: boolean; runs: number };
  viaIR: boolean;
  evmVersion: string;
  bytecodeHash: string;
}

/** ABI CONGELADO, formato `full` de ethers, ordenado. */
export const EXPECTED_ABI_FRAGMENTS: readonly string[] = [
  'error:error CredentialAlreadyRegistered(bytes32 credentialHash)',
  'error:error CredentialAlreadyRevoked(bytes32 credentialHash)',
  'error:error CredentialNotRegistered(bytes32 credentialHash)',
  'error:error UnauthorizedRevoker(address caller)',
  'error:error ZeroCredentialHash()',
  'event:event CredentialRegistered(bytes32 indexed credentialHash, address indexed issuer, uint256 registeredAt)',
  'event:event CredentialRevoked(bytes32 indexed credentialHash, address indexed issuer, uint256 revokedAt)',
  'function:function getCredentialStatus(bytes32 credentialHash) view returns (bool exists, bool revoked, address issuer, uint256 registeredAt, uint256 revokedAt)',
  'function:function registerCredential(bytes32 credentialHash)',
  'function:function revokeCredential(bytes32 credentialHash)'
];

export type ArtifactReasonCode =
  | 'ARTIFACT_MALFORMED'
  | 'ARTIFACT_CONTRACT_NAME'
  | 'ARTIFACT_ABI_MISMATCH'
  | 'ARTIFACT_CONSTRUCTOR_ARGS'
  | 'ARTIFACT_EMPTY_CREATION_BYTECODE'
  | 'ARTIFACT_EMPTY_RUNTIME_BYTECODE'
  | 'ARTIFACT_LINK_REFERENCES'
  | 'ARTIFACT_IMMUTABLES'
  | 'ARTIFACT_RUNTIME_NOT_IN_CREATION'
  | 'ARTIFACT_COMPILER_VERSION'
  | 'ARTIFACT_COMPILER_SETTINGS';

export class DeploymentArtifactError extends Error {
  readonly reasons: readonly ArtifactReasonCode[];

  constructor(reasons: readonly ArtifactReasonCode[]) {
    // Mensaje fijo: el artefacto puede ser grande y no se refleja.
    super('El artefacto compilado de CredentialRegistry no es valido.');
    this.name = 'DeploymentArtifactError';
    this.reasons = reasons;
  }
}

export interface ValidatedCredentialRegistryArtifact {
  readonly contractName: typeof CREDENTIAL_REGISTRY_CONTRACT_NAME;
  /** `0x` + hex minuscula. */
  readonly creationBytecode: string;
  readonly runtimeBytecode: string;
  readonly creationBytecodeHash: string;
  readonly runtimeBytecodeHash: string;
  readonly solidityVersion: typeof SOLIDITY_VERSION;
  readonly compilerSettings: CompilerSettings;
}

const BYTECODE = /^0x(?:[0-9a-fA-F]{2})+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyObjectOrAbsent(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

/**
 * Valida un artefacto Foundry (`out/CredentialRegistry.sol/CredentialRegistry.json`).
 * Acumula TODAS las razones; no se corta en la primera.
 */
export function validateCredentialRegistryArtifact(
  raw: unknown
): ValidatedCredentialRegistryArtifact {
  if (!isRecord(raw)) {
    throw new DeploymentArtifactError(['ARTIFACT_MALFORMED']);
  }

  const reasons: ArtifactReasonCode[] = [];
  const bytecode = isRecord(raw.bytecode) ? raw.bytecode : null;
  const deployed = isRecord(raw.deployedBytecode) ? raw.deployedBytecode : null;
  const metadata = isRecord(raw.metadata) ? raw.metadata : null;

  if (!bytecode || !deployed || !metadata || !Array.isArray(raw.abi)) {
    throw new DeploymentArtifactError(['ARTIFACT_MALFORMED']);
  }

  // --- nombre del contrato -------------------------------------------------
  const settings = isRecord(metadata.settings) ? metadata.settings : {};
  const target = settings.compilationTarget;
  if (
    !isRecord(target) ||
    Object.keys(target).length !== 1 ||
    target[CREDENTIAL_REGISTRY_SOURCE_PATH] !== CREDENTIAL_REGISTRY_CONTRACT_NAME
  ) {
    reasons.push('ARTIFACT_CONTRACT_NAME');
  }

  // --- ABI -----------------------------------------------------------------
  try {
    const abi = Interface.from(raw.abi as never);
    const actual = abi.fragments
      .map((fragment) => `${fragment.type}:${fragment.format('full')}`)
      .sort();

    if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_ABI_FRAGMENTS)) {
      reasons.push('ARTIFACT_ABI_MISMATCH');
    }
    if (abi.deploy.inputs.length !== 0) {
      reasons.push('ARTIFACT_CONSTRUCTOR_ARGS');
    }
  } catch {
    reasons.push('ARTIFACT_ABI_MISMATCH');
  }

  // --- bytecode ------------------------------------------------------------
  const creation = typeof bytecode.object === 'string' ? bytecode.object : '';
  const runtime = typeof deployed.object === 'string' ? deployed.object : '';

  if (!BYTECODE.test(creation)) {
    reasons.push('ARTIFACT_EMPTY_CREATION_BYTECODE');
  }
  if (!BYTECODE.test(runtime)) {
    reasons.push('ARTIFACT_EMPTY_RUNTIME_BYTECODE');
  }

  // --- librerias e immutables ---------------------------------------------
  if (
    !isEmptyObjectOrAbsent(bytecode.linkReferences) ||
    !isEmptyObjectOrAbsent(deployed.linkReferences)
  ) {
    reasons.push('ARTIFACT_LINK_REFERENCES');
  }
  if (!isEmptyObjectOrAbsent(deployed.immutableReferences)) {
    reasons.push('ARTIFACT_IMMUTABLES');
  }

  // El runtime vive TAL CUAL dentro del creation code. Si hubiera immutables o
  // un constructor que modifica el codigo, esto no se cumpliria.
  if (
    BYTECODE.test(creation) &&
    BYTECODE.test(runtime) &&
    !creation.toLowerCase().includes(runtime.toLowerCase().slice(2))
  ) {
    reasons.push('ARTIFACT_RUNTIME_NOT_IN_CREATION');
  }

  // --- compilador ----------------------------------------------------------
  const compiler = isRecord(metadata.compiler) ? metadata.compiler : {};
  if (
    typeof compiler.version !== 'string' ||
    !compiler.version.startsWith(`${SOLIDITY_VERSION}+`)
  ) {
    reasons.push('ARTIFACT_COMPILER_VERSION');
  }

  const optimizer = isRecord(settings.optimizer) ? settings.optimizer : {};
  const metadataSettings = isRecord(settings.metadata) ? settings.metadata : {};
  const observedSettings: CompilerSettings = {
    optimizer: {
      enabled: optimizer.enabled as boolean,
      runs: optimizer.runs as number
    },
    // Foundry omite `viaIR` cuando es falso.
    viaIR: settings.viaIR === undefined ? false : (settings.viaIR as boolean),
    evmVersion: settings.evmVersion as string,
    bytecodeHash: metadataSettings.bytecodeHash as string
  };

  if (
    JSON.stringify(observedSettings) !== JSON.stringify(FROZEN_COMPILER_SETTINGS) ||
    !isEmptyObjectOrAbsent(settings.libraries) ||
    (Array.isArray(settings.remappings) && settings.remappings.length > 0)
  ) {
    reasons.push('ARTIFACT_COMPILER_SETTINGS');
  }

  if (reasons.length > 0) {
    throw new DeploymentArtifactError([...new Set(reasons)]);
  }

  const creationBytecode = creation.toLowerCase();
  const runtimeBytecode = runtime.toLowerCase();

  return Object.freeze({
    contractName: CREDENTIAL_REGISTRY_CONTRACT_NAME,
    creationBytecode,
    runtimeBytecode,
    // Hashes COMPLETOS del bytecode completo. Sin truncar y sin recortar metadata.
    creationBytecodeHash: keccak256(creationBytecode),
    runtimeBytecodeHash: keccak256(runtimeBytecode),
    solidityVersion: SOLIDITY_VERSION,
    compilerSettings: Object.freeze({
      optimizer: { ...FROZEN_COMPILER_SETTINGS.optimizer },
      viaIR: FROZEN_COMPILER_SETTINGS.viaIR,
      evmVersion: FROZEN_COMPILER_SETTINGS.evmVersion,
      bytecodeHash: FROZEN_COMPILER_SETTINGS.bytecodeHash
    })
  });
}

/** I/O: lee y parsea el JSON del artefacto. El unico acceso a disco de este modulo. */
export function readArtifactFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new DeploymentArtifactError(['ARTIFACT_MALFORMED']);
  }
}
