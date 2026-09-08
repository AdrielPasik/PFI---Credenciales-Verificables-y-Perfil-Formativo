import { HttpClient, type FetchImplementation } from '@/lib/api/http-client';

/**
 * Utilidades de red para tests. Ningún test hace una petición real: siempre
 * se inyecta una implementación de `fetch` controlada.
 */

export interface StubResponse {
  status?: number;
  body?: unknown;
  /** Cuerpo crudo, para simular una respuesta no-JSON del servidor. */
  rawBody?: string;
}

export interface RecordedRequest {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function toResponse(stub: StubResponse | undefined): Response {
  const status = stub?.status ?? 200;
  const text =
    stub?.rawBody ?? (stub?.body === undefined ? '' : JSON.stringify(stub.body));

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  } as unknown as Response;
}

function recordCall(
  calls: RecordedRequest[],
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const headers: Record<string, string> = {};

  if (init?.headers) {
    for (const [key, value] of Object.entries(
      init.headers as Record<string, string>
    )) {
      headers[key] = value;
    }
  }

  const url = String(input);
  let path = url;

  try {
    path = new URL(url).pathname;
  } catch {
    // Ya es una ruta relativa.
  }

  const call: RecordedRequest = {
    url,
    path,
    method: init?.method ?? 'GET',
    headers,
    body: typeof init?.body === 'string' ? init.body : null
  };

  calls.push(call);
  return call;
}

/**
 * Stub secuencial: devuelve las respuestas en orden y repite la última.
 * Útil para probar el cliente HTTP, donde el orden ES lo que se verifica.
 */
export function createFetchStub(responses: StubResponse | StubResponse[]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedRequest[] = [];

  const fetchImplementation = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    recordCall(calls, input, init);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return toResponse(next);
  }) as unknown as FetchImplementation;

  return { fetchImplementation, calls };
}

export type RouteMap = Record<string, StubResponse | StubResponse[]>;

/**
 * Stub enrutado por `METHOD /ruta`.
 *
 * Es el que usan los tests de pantalla: a diferencia del secuencial, no se
 * desincroniza cuando una consulta se reintenta o cuando cambia el orden de
 * montaje de los hooks. Una ruta no declarada devuelve 404, así que un test
 * nunca "pasa" por accidente contra un endpoint que no esperaba.
 */
export function createRoutedFetchStub(routes: RouteMap) {
  const queues = new Map<string, StubResponse[]>();

  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  const calls: RecordedRequest[] = [];

  const fetchImplementation = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const call = recordCall(calls, input, init);
    const key = `${call.method} ${call.path}`;
    const queue = queues.get(key);

    if (!queue) {
      return toResponse({ status: 404, body: { message: 'ruta no simulada' } });
    }

    const next = queue.length > 1 ? queue.shift() : queue[0];
    return toResponse(next);
  }) as unknown as FetchImplementation;

  return { fetchImplementation, calls };
}

export function createFailingFetch(reason = 'network down') {
  const fetchImplementation = (async () => {
    throw new Error(reason);
  }) as unknown as FetchImplementation;

  return fetchImplementation;
}

export function createTestHttpClient(
  responses: StubResponse | StubResponse[],
  baseUrl = 'https://api.scope.test'
) {
  const { fetchImplementation, calls } = createFetchStub(responses);
  return { client: new HttpClient(baseUrl, fetchImplementation), calls };
}
