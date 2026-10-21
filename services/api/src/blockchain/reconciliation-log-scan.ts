import {
  type CredentialRegistryLog,
  type CredentialRegistryLogSearchRange,
  toSafeUnixSeconds
} from './credential-registry-events';

/**
 * Busqueda ACOTADA de logs de registracion -- S8, recuperacion en produccion.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 *
 * La primera credencial real quedo `pending` aunque su transaccion estaba
 * confirmada: el RPC privado responde HTTP 413 a un `eth_getLogs` de 10.000
 * bloques (incluso con topic0 y el hash indexado). Un error de proveedor no
 * dice nada sobre la cadena, asi que la busqueda tiene que (1) poder trabajar con
 * proveedores de rango chico y (2) no tener que barrer dias de bloques para
 * encontrar un evento que ocurrio segundos despues de la emision.
 *
 * ---------------------------------------------------------------------------
 * QUE HACE
 * ---------------------------------------------------------------------------
 *
 * 1. UBICA el bloque de arranque por TIMESTAMP (busqueda binaria sobre
 *    `getBlock`), no por una estimacion del tiempo de bloque: la transaccion no
 *    puede estar en un bloque anterior a la emision de la credencial. El reloj
 *    de referencia es el del propio bloque cabeza, no el del servidor.
 * 2. RECORRE hacia ADELANTE desde ahi: el evento esta pegado a la emision, asi
 *    que aparece en las primeras ventanas aunque el pendiente sea de hace dias.
 * 3. Si el proveedor RECHAZA el rango (413 o equivalente), PARTE la ventana a la
 *    mitad y aprende el tamano: las ventanas siguientes ya salen con ese tamano,
 *    no se vuelve a probar 10.000 en cada una. Nunca baja de 1 bloque ni sale de
 *    un presupuesto fijo de pedidos.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO HACE (invariantes)
 * ---------------------------------------------------------------------------
 *
 * - NO envia nada a la cadena. Solo `getBlockNumber`, `getBlock` y `getLogs`.
 * - UN ERROR NO ES AUSENCIA. Un fallo de proveedor, un rango imposible de achicar
 *   o un presupuesto agotado LANZAN: el llamador lo informa como "cadena no
 *   disponible" y la fila sigue `pending`. Solo se devuelve una lista vacia
 *   cuando TODO el rango se consulto con exito.
 * - NO lee el reloj del servidor ni acepta rangos del usuario.
 */

/** Tamano inicial de ventana de `eth_getLogs`. */
export const RECONCILIATION_LOG_WINDOW_BLOCKS = 10_000;

/** Piso del tamano de ventana. Se llega aca solo si el proveedor lo obliga. */
export const RECONCILIATION_MIN_LOG_WINDOW_BLOCKS = 1;

/**
 * Presupuesto TOTAL de pedidos `getLogs` por reconciliacion, contando los
 * rechazados. Es una cota defensiva: agotarla es "no se pudo establecer", nunca
 * "no esta registrado".
 */
export const RECONCILIATION_MAX_LOG_REQUESTS = 1_000;

/**
 * Margen (segundos) por debajo de la emision: cubre el desfase entre el reloj
 * del servidor que fecho la emision y el del bloque.
 */
export const RECONCILIATION_CLOCK_SKEW_SECONDS = 300;

/** Cota de la busqueda binaria por timestamp (2^40 bloques sobra). */
const MAX_LOCATE_STEPS = 40;

/**
 * Cota INFERIOR de respaldo cuando no se puede ubicar por timestamp. Ninguna
 * cadena EVM de este proyecto produce mas de un bloque por segundo (Base: 2 s),
 * asi que los segundos transcurridos acotan por arriba los bloques transcurridos.
 */
export const RECONCILIATION_MIN_BLOCK_SECONDS = 1;
export const RECONCILIATION_CLOCK_SLACK_BLOCKS = 3_600;

export class LogScanIncompleteError extends Error {
  constructor() {
    super('LOG_SCAN_INCOMPLETE');
    this.name = 'LogScanIncompleteError';
  }
}

export interface LogScanReader {
  getLogs(filter: {
    address: string;
    topics: readonly (string | null)[];
    fromBlock: number;
    toBlock: number | 'latest';
  }): Promise<readonly CredentialRegistryLog[]>;
  getBlock(blockNumber: number): Promise<{ timestamp?: unknown } | null>;
  getBlockNumber(): Promise<number>;
}

export type LogFilterFactory = (
  window: CredentialRegistryLogSearchRange
) => Parameters<LogScanReader['getLogs']>[0];

/**
 * El proveedor rechazo el TAMANO del rango (no "fallo" en general).
 *
 * Reconoce HTTP 413/414, el codigo JSON-RPC -32005 (limit exceeded) y los
 * mensajes habituales de proveedores. No inspecciona ni devuelve la URL.
 */
export function isRangeRejection(error: unknown): boolean {
  const candidate = error as {
    response?: { statusCode?: unknown };
    status?: unknown;
    code?: unknown;
    error?: { code?: unknown; message?: unknown };
    info?: { responseStatus?: unknown; error?: { code?: unknown; message?: unknown } };
    shortMessage?: unknown;
    message?: unknown;
  } | null;

  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const statuses = [
    candidate.response?.statusCode,
    candidate.status,
    typeof candidate.info?.responseStatus === 'string'
      ? Number.parseInt(candidate.info.responseStatus, 10)
      : candidate.info?.responseStatus
  ];
  if (statuses.some((status) => status === 413 || status === 414)) {
    return true;
  }

  const codes = [candidate.error?.code, candidate.info?.error?.code, candidate.code];
  if (codes.some((code) => code === -32005 || code === '-32005')) {
    return true;
  }

  const text = [
    candidate.shortMessage,
    candidate.message,
    candidate.error?.message,
    candidate.info?.error?.message
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  return /\b413\b|payload too large|entity too large|block range|range (is )?too (large|wide|big)|too many (blocks|results)|query returned more than|limit exceeded|exceeds? .{0,24}(range|limit)|max(imum)? .{0,12}range/.test(
    text
  );
}

/** Cota inferior de respaldo (sin consultar bloques). */
export function boundedSearchStart(
  floorBlock: number,
  head: number,
  pendingElapsedSeconds: number | undefined
): number {
  if (
    typeof pendingElapsedSeconds !== 'number' ||
    !Number.isFinite(pendingElapsedSeconds)
  ) {
    return floorBlock;
  }

  const blocksBack =
    Math.ceil(Math.max(0, pendingElapsedSeconds) / RECONCILIATION_MIN_BLOCK_SECONDS) +
    RECONCILIATION_CLOCK_SLACK_BLOCKS;

  return Math.max(floorBlock, head - blocksBack);
}

async function blockTimestamp(reader: LogScanReader, blockNumber: number): Promise<number> {
  const block = await reader.getBlock(blockNumber);
  const seconds = block ? toSafeUnixSeconds(block.timestamp) : null;

  if (seconds === null) {
    throw new LogScanIncompleteError();
  }

  return seconds;
}

/**
 * Primer bloque cuyo timestamp es >= (timestamp del cabeza - segundos pendiente
 * - margen). Nunca baja de `floorBlock` ni pasa de `head`.
 */
async function locateStartBlock(
  reader: LogScanReader,
  floorBlock: number,
  head: number,
  pendingElapsedSeconds: number
): Promise<number> {
  const headTimestamp = await blockTimestamp(reader, head);
  const target =
    headTimestamp -
    Math.ceil(Math.max(0, pendingElapsedSeconds)) -
    RECONCILIATION_CLOCK_SKEW_SECONDS;

  let low = floorBlock;
  let high = head;

  for (let step = 0; step < MAX_LOCATE_STEPS && low < high; step += 1) {
    const middle = low + Math.floor((high - low) / 2);

    if ((await blockTimestamp(reader, middle)) >= target) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

/**
 * Devuelve los logs del PRIMER tramo con resultados, o `[]` solo si se consulto
 * con exito todo el rango. Lanza en cualquier otro caso.
 */
export async function scanRegistrationLogs(input: {
  reader: LogScanReader;
  filterFor: LogFilterFactory;
  floorBlock: number;
  pendingElapsedSeconds?: number;
}): Promise<readonly CredentialRegistryLog[]> {
  const { reader, filterFor, floorBlock, pendingElapsedSeconds } = input;

  const head = await reader.getBlockNumber();
  if (!Number.isSafeInteger(head) || head < floorBlock) {
    // La cabeza por debajo del deploy es un estado imposible: no se concluye nada.
    throw new LogScanIncompleteError();
  }

  const hasAge =
    typeof pendingElapsedSeconds === 'number' && Number.isFinite(pendingElapsedSeconds);

  let start = floorBlock;
  if (hasAge) {
    try {
      start = await locateStartBlock(reader, floorBlock, head, pendingElapsedSeconds);
    } catch {
      // Sin timestamps confiables se usa la cota conservadora por segundos.
      start = boundedSearchStart(floorBlock, head, pendingElapsedSeconds);
    }
  }

  // Con antiguedad conocida el evento esta cerca del inicio: se avanza. Sin ella,
  // lo mas probable es lo reciente: se retrocede desde la cabeza.
  const forward = hasAge;
  let size = RECONCILIATION_LOG_WINDOW_BLOCKS;
  let cursor = forward ? start : head;

  for (let request = 0; request < RECONCILIATION_MAX_LOG_REQUESTS; request += 1) {
    const fromBlock = forward ? cursor : Math.max(start, cursor - size + 1);
    const toBlock = forward ? Math.min(head, cursor + size - 1) : cursor;

    let logs: readonly CredentialRegistryLog[];
    try {
      logs = await reader.getLogs(filterFor({ fromBlock, toBlock }));
    } catch (error) {
      if (isRangeRejection(error) && size > RECONCILIATION_MIN_LOG_WINDOW_BLOCKS) {
        size = Math.max(RECONCILIATION_MIN_LOG_WINDOW_BLOCKS, Math.floor(size / 2));
        continue;
      }

      throw error;
    }

    if (logs.length > 0) {
      return logs;
    }

    if (forward ? toBlock >= head : fromBlock <= start) {
      return [];
    }

    cursor = forward ? toBlock + 1 : fromBlock - 1;
  }

  throw new LogScanIncompleteError();
}
