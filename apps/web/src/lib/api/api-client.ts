import { readClientEnv } from '@/lib/env/client-env';
import { ApiError } from '@/lib/errors/api-error';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
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
    const headers = new Headers({
      Accept: 'application/json'
    });

    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }

    let response: Response;

    try {
      response = await this.fetchImplementation.call(
        globalThis,
        new URL(path.slice(1), `${this.baseUrl}/`),
        {
          method: options.method ?? 'GET',
          headers,
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
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
        response.status
      );
    }

    return payload;
  }
}

export function createApiClient() {
  return new ApiClient(readClientEnv().apiBaseUrl);
}
