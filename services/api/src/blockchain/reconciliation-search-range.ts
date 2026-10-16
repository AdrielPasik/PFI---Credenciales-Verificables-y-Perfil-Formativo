import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getAddress, isAddress } from 'ethers';

import { type CredentialRegistryLogSearchRange } from './credential-registry-events';

/**
 * Limite inferior SEGURO de busqueda de logs -- S8 cierre de Base Sepolia.
 *
 * ---------------------------------------------------------------------------
 * QUE RESUELVE
 * ---------------------------------------------------------------------------
 *
 * `BlockchainRegistrationReconciliationService.reconcilePendingRegistration`
 * exige un rango de bloques inyectado y su documentacion decia que el limite
 * inferior definitivo es "el bloque de deploy del manifest que commitea
 * S8c10". Este modulo lo obtiene de ese manifest, y NUNCA de un valor que el
 * llamador (un request HTTP) pueda elegir.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO IMPORTA `deployment/`
 * ---------------------------------------------------------------------------
 *
 * El runtime Nest no importa la herramienta de deployment (lo congela
 * `deployment.structure.test.ts`). Aca se lee SOLO el archivo JSON publicado y
 * se comprueban cinco hechos del propio manifest. La validacion COMPLETA del
 * manifest es del deployment tool y de `blockchain:check-target`; este modulo no
 * la duplica ni la reemplaza.
 *
 * ---------------------------------------------------------------------------
 * FALLA CERRADO
 * ---------------------------------------------------------------------------
 *
 * El `deploymentId` sale de la FILA y se usa como nombre de archivo, asi que se
 * restringe a la forma canonica antes de tocar el disco (sin `/`, sin `..`).
 * Si el manifest no esta, no se puede leer, o describe OTRO deployment, red,
 * cadena o contrato que la fila, no hay rango: se lanza y no se adivina un
 * `fromBlock` ni se escanea desde el bloque 0.
 */

/** Forma canonica del identificador: derivado, nunca elegido. */
const DEPLOYMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-0x[0-9a-f]{40}$/;

const MANIFEST_SCHEMA_VERSION = 'credential_registry_deployment_v1';

export type DeploymentSearchRangeErrorCode =
  | 'DEPLOYMENT_ID_INVALID'
  | 'MANIFEST_UNAVAILABLE'
  | 'MANIFEST_MISMATCH';

const SAFE_MESSAGES: Record<DeploymentSearchRangeErrorCode, string> = {
  DEPLOYMENT_ID_INVALID:
    'El identificador de deployment del registro no tiene la forma canonica.',
  MANIFEST_UNAVAILABLE:
    'No se pudo leer el manifest del deployment del contrato.',
  MANIFEST_MISMATCH:
    'El manifest del deployment no corresponde al registro tecnico.'
};

export class DeploymentSearchRangeError extends Error {
  readonly code: DeploymentSearchRangeErrorCode;

  constructor(code: DeploymentSearchRangeErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'DeploymentSearchRangeError';
    this.code = code;
  }
}

export interface DeploymentSearchRangeIdentity {
  readonly network: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly deploymentId: string | null;
}

export interface DeploymentSearchRangeOptions {
  /** Directorio de manifests. Por defecto `<raiz del repo>/contracts/deployments`. */
  readonly manifestDirectory?: string;
  /** Lector de archivos inyectable para tests. */
  readonly readFile?: (path: string) => string;
}

/**
 * `contracts/deployments` relativo a este archivo. Funciona igual desde `src/`
 * (ts-node) que desde `dist/` (imagen de produccion): en ambos casos son cuatro
 * niveles hasta la raiz del repo (`/app` en la imagen).
 */
export const DEFAULT_MANIFEST_DIRECTORY = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'deployments'
);

export function resolveDeploymentSearchRange(
  identity: DeploymentSearchRangeIdentity,
  options: DeploymentSearchRangeOptions = {}
): CredentialRegistryLogSearchRange {
  const deploymentId = identity.deploymentId;

  if (
    typeof deploymentId !== 'string' ||
    !DEPLOYMENT_ID_PATTERN.test(deploymentId)
  ) {
    throw new DeploymentSearchRangeError('DEPLOYMENT_ID_INVALID');
  }

  const directory = options.manifestDirectory ?? DEFAULT_MANIFEST_DIRECTORY;
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  let manifest: unknown;
  try {
    manifest = JSON.parse(read(join(directory, `${deploymentId}.json`)));
  } catch {
    throw new DeploymentSearchRangeError('MANIFEST_UNAVAILABLE');
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new DeploymentSearchRangeError('MANIFEST_UNAVAILABLE');
  }

  const fields = manifest as Record<string, unknown>;
  const block = fields.deploymentBlockNumber;

  if (
    fields.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    fields.deploymentId !== deploymentId ||
    fields.network !== identity.network ||
    fields.chainId !== identity.chainId ||
    !sameAddress(fields.contractAddress, identity.contractAddress) ||
    typeof block !== 'number' ||
    !Number.isSafeInteger(block) ||
    block < 1
  ) {
    throw new DeploymentSearchRangeError('MANIFEST_MISMATCH');
  }

  // Nada puede haberse registrado antes de que el contrato exista.
  return { fromBlock: block, toBlock: 'latest' };
}

function sameAddress(left: unknown, right: string): boolean {
  if (
    typeof left !== 'string' ||
    !isAddress(left) ||
    !isAddress(right)
  ) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}
