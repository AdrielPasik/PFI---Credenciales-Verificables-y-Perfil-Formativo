import { readClientEnv } from '@/lib/env/client-env';
import { ApiError } from '@/lib/errors/api-error';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
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
        response.status
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
