import { readClientEnv } from '@/lib/env/client-env';
import { ApiError } from '@/lib/errors/api-error';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  /**
   * Headers adicionales. Existe para el token de sesion del verificador
   * publico, que viaja en `X-Verification-Request-Token` y NUNCA en la URL.
   *
   * No se registran en logs ni en diagnosticos: el cliente nunca serializa los
   * headers de una peticion en un error.
   */
  headers?: Record<string, string>;
}

export type AuthenticatedApiRequestOptions = Omit<
  ApiRequestOptions,
  'token'
>;

export type AuthenticatedApiRequest = (
  path: `/${string}`,
  options?: AuthenticatedApiRequestOptions
) => Promise<unknown>;

type FetchImplementation = typeof fetch;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  async request(
    path: `/${string}`,
    options: ApiRequestOptions = {}
  ): Promise<unknown> {
    const formDataBody = isFormData(options.body);
    const requestBody = serializeRequestBody(options.body);
    const headers = new Headers({
      Accept: 'application/json'
    });

    if (options.body !== undefined && !formDataBody) {
      headers.set('Content-Type', 'application/json');
    }

    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }

    let response: Response;

    try {
      response = await this.fetchImplementation.call(
        globalThis,
        new URL(path.slice(1), `${this.baseUrl}/`),
        {
          method: options.method ?? 'GET',
          headers,
          body: requestBody,
          signal: options.signal
        }
      );
    } catch {
      throw new ApiError(
        'No fue posible conectar con el servicio.',
        'network'
      );
    }

    const responseText = await response.text();
    let payload: unknown = null;

    if (responseText.length > 0) {
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        if (response.ok) {
          throw new ApiError(
            'El servicio devolvió una respuesta inválida.',
            'invalid-response',
            response.status
          );
        }
      }
    }

    if (!response.ok) {
      throw new ApiError(
        'El servicio rechazó la operación.',
        'http',
        response.status,
        // Codigo estable del backend, cuando lo trae. Es un token de producto
        // (`SHARE_NOT_AVAILABLE`, `PROPOSAL_IN_PROGRESS`, ...), nunca un detalle
        // interno: el backend ya decide que codigos son publicables.
        safeErrorCode(payload)
      );
    }

    return payload;
  }
}

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function serializeRequestBody(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  return isFormData(body) ? body : JSON.stringify(body);
}

export function createApiClient() {
  return new ApiClient(readClientEnv().apiBaseUrl);
}

/** Solo un `code` string y corto. Cualquier otra cosa se descarta. */
function safeErrorCode(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const code = (payload as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : null;
}
