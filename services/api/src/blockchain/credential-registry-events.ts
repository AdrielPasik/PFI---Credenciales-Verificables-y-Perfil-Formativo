import { Interface, getAddress, isAddress } from 'ethers';

/**
 * Evidencia de registracion a partir de EVENTOS -- S8c6.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 *
 * Hay una ventana de crash que ninguna otra cosa cubre:
 *
 *   TX #1 commiteado (credential emitida + intent pendiente durable)
 *   -> transaccion de registracion minada en la cadena
 *   -> el proceso muere ANTES de guardar el txHash y antes de finalizar
 *
 * En ese estado la base no sabe ningun hecho de la cadena, pero la cadena si
 * tiene la registracion. La unica forma de recuperarla es buscar la evidencia
 * por `credentialHash`.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO REAL DEL EVENTO (auditado sobre contracts/src/CredentialRegistry.sol)
 * ---------------------------------------------------------------------------
 *
 *   event CredentialRegistered(
 *     bytes32 indexed credentialHash,   // topic[1]
 *     address indexed issuer,           // topic[2] -- es msg.sender, el REGISTRANTE
 *     uint256 registeredAt              // data    -- es block.timestamp
 *   );
 *
 * Los dos datos que hacen falta para adoptar estan INDEXADOS, asi que se puede
 * filtrar por hash sin escanear y leer el registrante del topic. El `txHash` y
 * el `blockNumber` no son del evento: vienen del log mismo.
 *
 * `registeredAt` del evento es, por construccion, el `block.timestamp` de ese
 * bloque. Igual se lo usa SOLO como contraste: el valor que se persiste sale de
 * `getBlock(blockNumber).timestamp`, porque esa es la fuente que S8b congelo.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE DE LA BUSQUEDA -- LIMITACION DECLARADA
 * ---------------------------------------------------------------------------
 *
 * `getLogs` necesita un rango de bloques. S8c6 NO lo adivina: el rango se
 * INYECTA. El origen definitivo del limite inferior es el manifest de
 * deployment que commitea S8c10 (bloque de deploy), y hasta que exista:
 *
 *   DESCUBRIMIENTO ACOTADO DE HUERFANOS EN VIVO
 *   -> depende del manifest real de S8c10.
 *
 * No se implementa ni se promete un escaneo desde el bloque 0. El checkpoint de
 * `txHash` optimiza la recuperacion pero no elimina este requisito, porque el
 * crash puede ocurrir antes del checkpoint.
 */

/** Fragmento de ABI del evento, copiado del contrato, sin agregarle campos. */
export const CREDENTIAL_REGISTRY_EVENT_ABI = [
  'event CredentialRegistered(bytes32 indexed credentialHash, address indexed issuer, uint256 registeredAt)'
] as const;

export const CREDENTIAL_REGISTERED_EVENT_NAME = 'CredentialRegistered';

const credentialRegistryEventInterface = new Interface(
  CREDENTIAL_REGISTRY_EVENT_ABI as unknown as string[]
);

/** `keccak256` de la firma del evento. Es el topic[0] de cualquier log suyo. */
export const CREDENTIAL_REGISTERED_TOPIC =
  credentialRegistryEventInterface.getEvent(CREDENTIAL_REGISTERED_EVENT_NAME)!
    .topicHash;

const CANONICAL_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

/** Forma minima de un log, comun al receipt y a `getLogs`. */
export interface CredentialRegistryLog {
  readonly address?: string | null;
  readonly topics: readonly string[];
  readonly data: string;
  readonly transactionHash?: string | null;
  readonly blockNumber?: number | null;
}

/** Lo que un log de registracion prueba. */
export interface CredentialRegisteredEvidence {
  readonly credentialHash: string;
  /** Registrante OBSERVADO (`msg.sender`), con checksum EIP-55. */
  readonly registrant: string;
  /** `block.timestamp` tal como lo emitio el contrato, en segundos. */
  readonly registeredAtSeconds: number;
  readonly txHash: string;
  readonly blockNumber: number;
}

/**
 * Rango de bloques para buscar logs. SIEMPRE inyectado: ver la limitacion
 * declarada arriba.
 */
export interface CredentialRegistryLogSearchRange {
  readonly fromBlock: number;
  readonly toBlock: number | 'latest';
}

/**
 * Filtro por `credentialHash`. El hash viaja como topic porque esta indexado,
 * asi que el nodo no necesita escanear datos.
 */
export function buildCredentialRegisteredFilter(
  contractAddress: string,
  credentialHash: string,
  range: CredentialRegistryLogSearchRange
) {
  return {
    address: contractAddress,
    topics: [CREDENTIAL_REGISTERED_TOPIC, normalizeHashTopic(credentialHash)],
    fromBlock: range.fromBlock,
    toBlock: range.toBlock
  };
}

/**
 * Decodifica UN log de registracion.
 *
 * Devuelve `null` en vez de lanzar cuando el log no es de este evento o no
 * trae la procedencia completa: un log sin `transactionHash` o sin
 * `blockNumber` no prueba nada adoptable, y fabricar esos valores seria
 * exactamente lo que esta slice prohibe.
 */
export function decodeCredentialRegisteredLog(
  log: CredentialRegistryLog
): CredentialRegisteredEvidence | null {
  if (!Array.isArray(log.topics) || log.topics.length < 3) {
    return null;
  }

  if (log.topics[0] !== CREDENTIAL_REGISTERED_TOPIC) {
    return null;
  }

  let decoded;
  try {
    decoded = credentialRegistryEventInterface.decodeEventLog(
      CREDENTIAL_REGISTERED_EVENT_NAME,
      log.data,
      log.topics as string[]
    );
  } catch {
    // No se propaga el error de ethers: puede arrastrar el endpoint del RPC.
    return null;
  }

  const credentialHash = String(decoded.credentialHash).toLowerCase();
  if (!CANONICAL_HASH_PATTERN.test(credentialHash)) {
    return null;
  }

  const rawRegistrant = String(decoded.issuer);
  if (!isAddress(rawRegistrant)) {
    return null;
  }

  const registeredAtSeconds = toSafeUnixSeconds(decoded.registeredAt);
  if (registeredAtSeconds === null) {
    return null;
  }

  if (
    typeof log.transactionHash !== 'string' ||
    !isCanonicalTransactionHash(log.transactionHash)
  ) {
    return null;
  }

  if (!isValidBlockNumber(log.blockNumber)) {
    return null;
  }

  return {
    credentialHash,
    registrant: getAddress(rawRegistrant),
    registeredAtSeconds,
    txHash: log.transactionHash.toLowerCase(),
    blockNumber: log.blockNumber as number
  };
}

/**
 * Selecciona la UNICA evidencia que corresponde al hash y al registrante
 * esperados.
 *
 * Falla cerrado -- devolviendo `null` -- si hay mas de una candidata con
 * procedencia contradictoria. El contrato ya revierte una segunda registracion
 * del mismo hash, pero "elegir una" en silencio seria inventar una respuesta
 * frente a evidencia que no entendemos.
 */
export function selectCredentialRegisteredEvidence(
  logs: readonly CredentialRegistryLog[],
  expected: { credentialHash: string; registrant: string }
):
  | { readonly kind: 'single'; readonly evidence: CredentialRegisteredEvidence }
  | { readonly kind: 'none' }
  | { readonly kind: 'conflicting' }
  | { readonly kind: 'unexpected_registrant' } {
  const expectedHash = expected.credentialHash.toLowerCase();
  const expectedRegistrant = isAddress(expected.registrant)
    ? getAddress(expected.registrant)
    : null;

  if (expectedRegistrant === null) {
    return { kind: 'conflicting' };
  }

  const decoded = logs
    .map((log) => decodeCredentialRegisteredLog(log))
    .filter((value): value is CredentialRegisteredEvidence => value !== null)
    .filter((value) => value.credentialHash === expectedHash);

  if (decoded.length === 0) {
    return { kind: 'none' };
  }

  const matching = decoded.filter(
    (value) => value.registrant === expectedRegistrant
  );

  if (matching.length === 0) {
    // Hay registracion para este hash, pero la hizo otra cuenta. No se adopta.
    return { kind: 'unexpected_registrant' };
  }

  // Varias registraciones del mismo hash con distinta transaccion o bloque.
  const distinct = new Set(
    matching.map((value) => `${value.txHash}:${value.blockNumber}`)
  );
  if (distinct.size > 1) {
    return { kind: 'conflicting' };
  }

  return { kind: 'single', evidence: matching[0] };
}

export function isCanonicalTransactionHash(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isValidBlockNumber(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    // La columna es Int32 en PostgreSQL (S8c1).
    value <= 2_147_483_647
  );
}

/**
 * `block.timestamp` de Ethereum son SEGUNDOS Unix. Se exige un entero seguro no
 * negativo y se convierte UNA sola vez a `Date` UTC.
 */
export function toSafeUnixSeconds(value: unknown): number | null {
  let seconds: number;

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    seconds = Number(value);
  } else if (typeof value === 'number') {
    seconds = value;
  } else {
    return null;
  }

  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    return null;
  }

  return seconds;
}

/** Segundos Unix -> `Date` UTC. Sin fallback al reloj del servidor. */
export function unixSecondsToDate(seconds: number): Date | null {
  const milliseconds = seconds * 1000;

  if (!Number.isSafeInteger(milliseconds)) {
    return null;
  }

  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeHashTopic(credentialHash: string): string {
  return credentialHash.toLowerCase();
}
