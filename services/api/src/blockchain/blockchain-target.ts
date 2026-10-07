import { BlockchainNetwork } from '@prisma/client';
import { ZeroAddress, getAddress, isAddress } from 'ethers';

/**
 * Target de evidencia de blockchain -- S8c5.
 *
 * Rompe la asociacion historica
 *
 *   BLOCKCHAIN_EVIDENCE_MODE = credential_registry_anvil
 *   => red Anvil + chainId 31337 hardcodeados dentro del modo
 *
 * y la reemplaza por dos ejes INDEPENDIENTES:
 *
 *   evidenceMode  -- QUE mecanismo de evidencia usamos (mock | credential_registry)
 *   network       -- EN QUE cadena escribimos (anvil | base_sepolia)
 *
 * El modo ya no puede contener una red. Esa fusion es exactamente lo que hacia
 * imposible apuntar a Base Sepolia sin tocar la logica de escritura.
 *
 * ---------------------------------------------------------------------------
 * UNICA FRONTERA DE CONFIGURACION
 * ---------------------------------------------------------------------------
 *
 * Este archivo es el UNICO que lee las variables de entorno del registry. El
 * write client, el read client, el servicio de evidencia y la reconciliacion
 * reciben un target YA VALIDADO -- no vuelven a mirar `process.env`.
 *
 * ---------------------------------------------------------------------------
 * SEGURIDAD -- rpcUrl
 * ---------------------------------------------------------------------------
 *
 * `CREDENTIAL_REGISTRY_RPC_URL` es configuracion SENSIBLE: los endpoints de los
 * proveedores suelen llevar la credencial en el path o en el query
 * (`/v2/<API_KEY>`, `?apiKey=...`). Por eso:
 *
 *   - no se loguea;
 *   - no entra en ningun mensaje de error;
 *   - no se expone por HTTP ni por DTO;
 *   - no se interpola en ninguna excepcion.
 *
 * Los errores llevan el NOMBRE de la variable que fallo, nunca su valor.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE
 * ---------------------------------------------------------------------------
 *
 * S8c5 resuelve y valida configuracion LOCAL. No construye provider aca, no
 * llama a ninguna red y no sabe si el contrato existe: eso es el preflight,
 * que corre inmediatamente antes de cada escritura.
 */

// ---------------------------------------------------------------------------
// RED <-> CHAIN ID -- UNICA FUENTE
// ---------------------------------------------------------------------------

/**
 * Mapeo CONGELADO red -> chainId. Es el unico lugar del codigo de produccion
 * donde 31337 y 84532 son literales: la logica de escritura no vuelve a
 * mencionarlos.
 *
 * `base_sepolia` es el TARGET FINAL obligatorio del proyecto. `anvil` queda
 * como red de integracion local. Ninguna de las dos es, por si sola,
 * "blockchain completo": eso exige la evidencia live de Base Sepolia (S8c11).
 */
export const CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS = {
  [BlockchainNetwork.anvil]: 31337,
  [BlockchainNetwork.base_sepolia]: 84532
} as const;

export type CredentialRegistryNetwork =
  keyof typeof CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS;

/** Red final obligatoria del proyecto. */
export const FINAL_TARGET_NETWORK: CredentialRegistryNetwork =
  BlockchainNetwork.base_sepolia;

export function isCredentialRegistryNetwork(
  value: unknown
): value is CredentialRegistryNetwork {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS,
      value
    )
  );
}

export function chainIdForCredentialRegistryNetwork(
  network: CredentialRegistryNetwork
): number {
  return CREDENTIAL_REGISTRY_NETWORK_CHAIN_IDS[network];
}

// ---------------------------------------------------------------------------
// TARGET
// ---------------------------------------------------------------------------

export type BlockchainEvidenceModeName = 'mock' | 'credential_registry';

/**
 * Target validado.
 *
 * La union discriminada es la que hace cumplir el invariante: `mock` NO lleva
 * red, chainId, rpcUrl, contrato ni deployment, asi que es imposible --
 * en tiempo de compilacion -- construir un provider desde un target mock.
 */
export type BlockchainTarget =
  | { readonly evidenceMode: 'mock' }
  | {
      readonly evidenceMode: 'credential_registry';
      readonly network: CredentialRegistryNetwork;
      readonly chainId: number;
      /**
       * SENSIBLE. Se preserva EXACTAMENTE como fue aceptada, sin recortes ni
       * reescrituras, porque la credencial del proveedor puede vivir en el
       * path o en el query. Nunca se serializa.
       */
      readonly rpcUrl: string;
      /** Checksum EIP-55. */
      readonly contractAddress: string;
      /** Identificador opaco de UN deployment concreto. */
      readonly deploymentId: string;
    };

export type CredentialRegistryTarget = Extract<
  BlockchainTarget,
  { evidenceMode: 'credential_registry' }
>;

export function isCredentialRegistryTarget(
  target: BlockchainTarget
): target is CredentialRegistryTarget {
  return target.evidenceMode === 'credential_registry';
}

// ---------------------------------------------------------------------------
// ERRORES
// ---------------------------------------------------------------------------

export type BlockchainTargetErrorCode =
  | 'BLOCKCHAIN_TARGET_CONFIG_INVALID'
  | 'BLOCKCHAIN_RPC_UNAVAILABLE'
  | 'BLOCKCHAIN_NETWORK_MISMATCH'
  | 'BLOCKCHAIN_CONTRACT_MISSING';

/**
 * Mensajes FIJOS. Nunca se interpola nada: ni la URL del RPC, ni el endpoint,
 * ni la API key, ni el chainId observado, ni el mensaje crudo de ethers.
 */
const SAFE_MESSAGES: Record<BlockchainTargetErrorCode, string> = {
  BLOCKCHAIN_TARGET_CONFIG_INVALID:
    'La configuracion del registro de credenciales en blockchain no es valida.',
  BLOCKCHAIN_RPC_UNAVAILABLE:
    'No se pudo contactar el endpoint de la red configurada.',
  BLOCKCHAIN_NETWORK_MISMATCH:
    'La red observada no es la red configurada para este registro.',
  BLOCKCHAIN_CONTRACT_MISSING:
    'No hay contrato desplegado en la direccion configurada.'
};

/**
 * NOMBRES de variables, nunca valores. Un nombre de variable no es un secreto
 * y es justo lo que un operador necesita para corregir la configuracion.
 */
export type BlockchainTargetField =
  | 'BLOCKCHAIN_EVIDENCE_MODE'
  | 'CREDENTIAL_REGISTRY_NETWORK'
  | 'CREDENTIAL_REGISTRY_CHAIN_ID'
  | 'CREDENTIAL_REGISTRY_RPC_URL'
  | 'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS'
  | 'CREDENTIAL_REGISTRY_DEPLOYMENT_ID';

export class BlockchainTargetError extends Error {
  readonly code: BlockchainTargetErrorCode;
  /** Solo para errores de configuracion. */
  readonly field?: BlockchainTargetField;
  /** Clase del error del provider, nunca su mensaje. */
  readonly providerErrorName?: string;

  constructor(
    code: BlockchainTargetErrorCode,
    context: {
      field?: BlockchainTargetField;
      providerErrorName?: string;
    } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'BlockchainTargetError';
    this.code = code;

    if (context.field !== undefined) {
      this.field = context.field;
    }
    if (context.providerErrorName !== undefined) {
      this.providerErrorName = context.providerErrorName;
    }
  }
}

/** Mensaje fijo asociado a un code, para aserciones de tests. */
export function safeBlockchainTargetMessage(
  code: BlockchainTargetErrorCode
): string {
  return SAFE_MESSAGES[code];
}

// ---------------------------------------------------------------------------
// ENTORNO
// ---------------------------------------------------------------------------

export interface BlockchainTargetEnvironment {
  BLOCKCHAIN_EVIDENCE_MODE?: string;
  CREDENTIAL_REGISTRY_NETWORK?: string;
  CREDENTIAL_REGISTRY_CHAIN_ID?: string;
  CREDENTIAL_REGISTRY_RPC_URL?: string;
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS?: string;
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID?: string;
}

export type BlockchainTargetResolution =
  | { readonly ok: true; readonly target: BlockchainTarget }
  | {
      readonly ok: false;
      readonly code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID';
      readonly field: BlockchainTargetField;
    };

const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
// Decimal, sin cero a la izquierda: `031337` es un valor plausible-pero-sucio
// que `Number` aceptaria igual, y en cualquier otro contexto se leeria como
// octal. Se rechaza por ambiguo, igual que el padding de espacios.
const DECIMAL_INTEGER_PATTERN = /^[1-9][0-9]*$/;
// `isAddress` de ethers acepta 40 hex SIN prefijo (verificado en 6.17.0) y
// `getAddress` lo normaliza. Para un contrato de CONFIGURACION eso es
// demasiado permisivo: toda herramienta emite la forma `0x`, y aceptar la otra
// en silencio es la misma clase de indulgencia que recortar espacios.
const HEX_ADDRESS_PREFIX_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Resuelve el target desde el entorno SIN lanzar.
 *
 * Esta forma existe para los llamadores que necesitan clasificar el fallo (la
 * resolucion de deployment ligada a un BlockchainRecord lo usa para elegir su
 * propia razon). `resolveBlockchainTarget` envuelve esto y lanza.
 *
 * FALLA CERRADO: un modo real incompleto o mal formado NUNCA degrada a mock.
 * Degradar seria lo peor posible -- reportariamos evidencia de blockchain
 * mientras la escritura real queda silenciosamente desactivada.
 */
export function tryResolveBlockchainTarget(
  environment: BlockchainTargetEnvironment = process.env
): BlockchainTargetResolution {
  const rawMode = environment.BLOCKCHAIN_EVIDENCE_MODE;

  // Ausente o vacio = mock. Es el default historico y el unico implicito.
  if (rawMode === undefined || rawMode === '') {
    return { ok: true, target: { evidenceMode: 'mock' } };
  }

  if (rawMode === 'mock') {
    return { ok: true, target: { evidenceMode: 'mock' } };
  }

  // `credential_registry_anvil` YA NO existe como modo: fusionaba mecanismo y
  // red. No se traduce en silencio a `credential_registry` + anvil, porque esa
  // traduccion inventaria una red que el operador no declaro.
  if (rawMode !== 'credential_registry') {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'BLOCKCHAIN_EVIDENCE_MODE'
    };
  }

  const network = environment.CREDENTIAL_REGISTRY_NETWORK;
  if (!isCredentialRegistryNetwork(network)) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_NETWORK'
    };
  }

  const chainId = parseChainId(environment.CREDENTIAL_REGISTRY_CHAIN_ID);
  if (chainId === null) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_CHAIN_ID'
    };
  }

  // CONSISTENCIA red <-> chainId. No alcanza con que el chainId sea un numero
  // plausible: una etiqueta `base_sepolia` con chainId 31337 describe dos
  // cadenas distintas a la vez y no puede resolverse.
  if (chainId !== chainIdForCredentialRegistryNetwork(network)) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_CHAIN_ID'
    };
  }

  const rpcUrl = validateRpcUrl(environment.CREDENTIAL_REGISTRY_RPC_URL, network);
  if (rpcUrl === null) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_RPC_URL'
    };
  }

  const contractAddress = validateContractAddress(
    environment.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS
  );
  if (contractAddress === null) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS'
    };
  }

  const deploymentId = validateDeploymentId(
    environment.CREDENTIAL_REGISTRY_DEPLOYMENT_ID
  );
  if (deploymentId === null) {
    return {
      ok: false,
      code: 'BLOCKCHAIN_TARGET_CONFIG_INVALID',
      field: 'CREDENTIAL_REGISTRY_DEPLOYMENT_ID'
    };
  }

  return {
    ok: true,
    target: {
      evidenceMode: 'credential_registry',
      network,
      chainId,
      rpcUrl,
      contractAddress,
      deploymentId
    }
  };
}

/** Igual que `tryResolveBlockchainTarget`, pero lanza un error tipado seguro. */
export function resolveBlockchainTarget(
  environment: BlockchainTargetEnvironment = process.env
): BlockchainTarget {
  const resolution = tryResolveBlockchainTarget(environment);

  if (!resolution.ok) {
    throw new BlockchainTargetError(resolution.code, {
      field: resolution.field
    });
  }

  return resolution.target;
}

// ---------------------------------------------------------------------------
// VALIDADORES
// ---------------------------------------------------------------------------

/**
 * chainId DECIMAL explicito. Nada de coercion implicita de JS: `Number('')` es
 * 0 y `Number('  31337  ')` es 31337, y las dos cosas aceptarian basura.
 */
function parseChainId(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || raw !== raw.trim() || raw.length === 0) {
    return null;
  }

  if (!DECIMAL_INTEGER_PATTERN.test(raw)) {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

/**
 * Valida la URL del RPC y devuelve el string ORIGINAL aceptado.
 *
 * Se parsea SOLO para validar. No se normaliza nada: no se recorta, no se
 * pasa a minuscula, no se quita el query y no se reescribe el host. Cualquiera
 * de esas cosas podria destruir la credencial que el proveedor espera en el
 * path o en el query, y lo haria en silencio.
 *
 * Padding de espacios se RECHAZA en vez de recortarse: aceptarlo callado
 * esconde un error de configuracion.
 */
function validateRpcUrl(
  raw: string | undefined,
  network: CredentialRegistryNetwork
): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  if (parsed.protocol === 'http:') {
    // Base Sepolia es una red publica: HTTP plano expondria la credencial del
    // proveedor en transito. Solo el target local admite HTTP, y solo contra
    // loopback -- un Anvil remoto tambien tiene que ir por HTTPS.
    if (network !== BlockchainNetwork.anvil) {
      return null;
    }

    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
      return null;
    }
  }

  return raw;
}

function validateContractAddress(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) {
    return null;
  }

  if (!HEX_ADDRESS_PREFIX_PATTERN.test(raw) || !isAddress(raw)) {
    return null;
  }

  const normalized = getAddress(raw);

  // La direccion cero no es un deployment. Que la direccion sea sintacticamente
  // valida no dice NADA sobre que haya codigo ahi: eso lo decide el preflight.
  if (normalized === getAddress(ZeroAddress)) {
    return null;
  }

  return normalized;
}

/**
 * `deploymentId` identifica UN deployment concreto del contrato.
 *
 * NO es el nombre de la red, NO es la direccion del contrato y NO es un hash de
 * transaccion: varias versiones de CredentialRegistry pueden convivir en la
 * misma cadena, asi que la red no alcanza para distinguirlas.
 *
 * S8c5 solo valida la FORMA: un slug ASCII opaco. El manifest commiteado que
 * le da significado (red, chainId, direccion, tx y bloque de deploy) lo
 * produce S8c10, cuando el contrato exista de verdad.
 */
function validateDeploymentId(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) {
    return null;
  }

  if (!DEPLOYMENT_ID_PATTERN.test(raw)) {
    return null;
  }

  return raw;
}
