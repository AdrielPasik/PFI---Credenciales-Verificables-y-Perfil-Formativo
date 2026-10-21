import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LogScanIncompleteError,
  type LogScanReader,
  RECONCILIATION_CLOCK_SKEW_SECONDS,
  RECONCILIATION_LOG_WINDOW_BLOCKS,
  isRangeRejection,
  scanRegistrationLogs
} from './reconciliation-log-scan';

/**
 * Busqueda de logs de registracion: clasificacion de errores de rango, ubicacion
 * por timestamp, direccion del barrido y las garantias de "un error no es
 * ausencia". Lectores falsos y deterministas; nada de red.
 */

const FLOOR = 1_000;
const T0 = 1_800_000_000;
const LOG = { address: '0x1', topics: [], data: '0x', blockNumber: 0, transactionHash: '0x2' } as never;

function reader(options: {
  head: number;
  maxRange?: number;
  eventBlock?: number;
  getLogsError?: unknown;
  getBlockError?: boolean;
  blockSeconds?: number;
}) {
  const calls = { logs: [] as Array<[number, number]>, blocks: 0 };
  const seconds = options.blockSeconds ?? 2;

  const fake: LogScanReader = {
    async getBlockNumber() {
      return options.head;
    },
    async getBlock(blockNumber: number) {
      calls.blocks += 1;
      if (options.getBlockError) throw new Error('getBlock down');
      return { timestamp: T0 + blockNumber * seconds };
    },
    async getLogs(filter) {
      const from = filter.fromBlock;
      const to = filter.toBlock as number;
      calls.logs.push([from, to]);
      if (options.getLogsError) throw options.getLogsError;
      if (options.maxRange !== undefined && to - from + 1 > options.maxRange) {
        throw Object.assign(new Error('bad response (status=413)'), { response: { statusCode: 413 } });
      }
      const hit = options.eventBlock !== undefined && options.eventBlock >= from && options.eventBlock <= to;
      return hit ? [LOG] : [];
    }
  };

  return { fake, calls };
}

const filterFor = (window: { fromBlock: number; toBlock: number | 'latest' }) => ({
  address: '0x1',
  topics: ['0xt'],
  fromBlock: window.fromBlock,
  toBlock: window.toBlock
});

// ---------------------------------------------------------------------------
// CLASIFICACION DE ERRORES
// ---------------------------------------------------------------------------

test('isRangeRejection reconoce 413/414, -32005 y los mensajes habituales de proveedores', () => {
  const positives: unknown[] = [
    { response: { statusCode: 413 } },
    { status: 413 },
    { info: { responseStatus: '413 Request Entity Too Large' } },
    { info: { responseStatus: '414 URI Too Long' } },
    { error: { code: -32005, message: 'query returned more than 10000 results' } },
    { info: { error: { code: -32005 } } },
    new Error('Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range'),
    new Error('block range is too wide'),
    new Error('exceeds the max range of 1000 blocks'),
    new Error('Payload Too Large')
  ];

  for (const candidate of positives) {
    assert.equal(isRangeRejection(candidate), true, JSON.stringify(candidate));
  }
});

test('isRangeRejection NO confunde fallos de red, autenticacion o servidor con un rango', () => {
  const negatives: unknown[] = [
    null,
    undefined,
    'string',
    42,
    new Error('ECONNRESET'),
    new Error('getaddrinfo ENOTFOUND provider.example'),
    new Error('timeout'),
    { response: { statusCode: 401 } },
    { response: { statusCode: 429 } },
    { response: { statusCode: 500 } },
    { response: { statusCode: 503 } },
    { error: { code: -32000, message: 'header not found' } }
  ];

  for (const candidate of negatives) {
    assert.equal(isRangeRejection(candidate), false, String(candidate));
  }
});

// ---------------------------------------------------------------------------
// UBICACION POR TIMESTAMP Y DIRECCION DEL BARRIDO
// ---------------------------------------------------------------------------

test('con edad conocida arranca por TIMESTAMP (busqueda binaria) y barre hacia adelante', async () => {
  const head = FLOOR + 400_000;
  const eventBlock = head - 43_000;
  const elapsed = (head - eventBlock) * 2 + 6;
  const { fake, calls } = reader({ head, eventBlock });

  const logs = await scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR, pendingElapsedSeconds: elapsed });

  assert.equal(logs.length, 1);
  // ~20 getBlock para ubicar (log2 de 400k), no cientos.
  assert.ok(calls.blocks <= 25, `getBlock: ${calls.blocks}`);
  // El primer getLogs arranca cerca del evento, no en el deploy ni en la cabeza.
  const expectedStart = eventBlock - Math.ceil((RECONCILIATION_CLOCK_SKEW_SECONDS + 6) / 2);
  assert.ok(Math.abs(calls.logs[0][0] - expectedStart) <= 2, `arranque ${calls.logs[0][0]} vs ${expectedStart}`);
  assert.equal(calls.logs.length, 1);
});

test('el arranque nunca baja del piso del manifest ni pasa de la cabeza', async () => {
  const { fake, calls } = reader({ head: FLOOR + 50, eventBlock: FLOOR + 10 });

  await scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR, pendingElapsedSeconds: 10 ** 9 });

  assert.equal(calls.logs[0][0], FLOOR);
  assert.ok(calls.logs.every(([from, to]) => from >= FLOOR && to <= FLOOR + 50));
});

test('sin edad conocida retrocede desde la cabeza hasta el piso en ventanas', async () => {
  const head = FLOOR + 25_000;
  const { fake, calls } = reader({ head });

  const logs = await scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR });

  assert.deepEqual(logs, []);
  assert.equal(calls.logs[0][1], head);
  assert.equal(calls.logs[calls.logs.length - 1][0], FLOOR);
  assert.ok(calls.logs.every(([from, to]) => to - from + 1 <= RECONCILIATION_LOG_WINDOW_BLOCKS));
  assert.equal(calls.blocks, 0);
});

test('sin timestamps utilizables usa la cota conservadora y sigue funcionando', async () => {
  const head = FLOOR + 100_000;
  const eventBlock = head - 500;
  const { fake, calls } = reader({ head, eventBlock, getBlockError: true });

  const logs = await scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR, pendingElapsedSeconds: 1_000 });

  assert.equal(logs.length, 1);
  // 1.000 s + 3.600 de holgura: nunca el rango entero.
  assert.ok(calls.logs[0][0] >= head - 4_700);
});

// ---------------------------------------------------------------------------
// UN ERROR NO ES AUSENCIA
// ---------------------------------------------------------------------------

test('el tamano aprendido se reutiliza: no se vuelve a probar 10.000 en cada ventana', async () => {
  const head = FLOOR + 5_000;
  const { fake, calls } = reader({ head, maxRange: 1_000 });

  await scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR });

  const rejected = calls.logs.filter(([from, to]) => to - from + 1 > 1_000);
  assert.ok(rejected.length <= 4, `rechazos: ${rejected.length}`);
  const accepted = calls.logs.filter(([from, to]) => to - from + 1 <= 1_000);
  assert.ok(accepted.length >= 4);
});

test('un proveedor que rechaza incluso 1 bloque lanza (no devuelve lista vacia)', async () => {
  const { fake } = reader({ head: FLOOR + 100, maxRange: 0 });

  await assert.rejects(
    () => scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR }),
    (error: unknown) => isRangeRejection(error)
  );
});

test('un error que no es de rango se propaga en el primer intento', async () => {
  const boom = new Error('ECONNRESET');
  const { fake, calls } = reader({ head: FLOOR + 100, getLogsError: boom });

  await assert.rejects(() => scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR }), boom);
  assert.equal(calls.logs.length, 1);
});

test('la cabeza por debajo del piso es un estado imposible: lanza, no concluye ausencia', async () => {
  const { fake } = reader({ head: FLOOR - 1 });

  await assert.rejects(
    () => scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR }),
    LogScanIncompleteError
  );
});

test('si el barrido no alcanza a cubrir el rango dentro del presupuesto lanza LogScanIncompleteError', async () => {
  const { fake } = reader({ head: FLOOR + 5_000, maxRange: 1 });

  await assert.rejects(
    () => scanRegistrationLogs({ reader: fake, filterFor, floorBlock: FLOOR }),
    LogScanIncompleteError
  );
});

test('estructural: el modulo solo lee (sin escritura, sin reloj del servidor, sin reintentos de escritura)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const code = readFileSync(join(__dirname, 'reconciliation-log-scan.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  for (const forbidden of [
    'sendTransaction',
    'registerCredential',
    'revokeCredential',
    'Wallet',
    'NonceManager',
    'AnchorWriteCoordinator',
    'process.env',
    'new Date()',
    'Date.now()',
    'setTimeout',
    'while ('
  ]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }

  assert.ok(!/from\s+'[^']*\/deployment\//.test(code));
});
