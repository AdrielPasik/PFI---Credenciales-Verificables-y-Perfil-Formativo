import { ApiError } from '@/lib/errors/api-error';

/**
 * Cliente HTTP único de la app.
 *
 * Toda llamada de red pasa por acá: no hay `fetch` suelto en pantallas ni en
 * hooks. Centraliza base URL, header de autorización, serialización JSON,
 * timeout y categorización de errores.
 *
 * La app habla EXCLUSIVAMENTE con el backend NestJS de Scope. Nunca con el
 * servicio de IA, ni con blockchain, ni con storage, ni con terceros.
 */

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  /** Milisegundos. `null` desactiva el timeout para esta petición. */
  timeoutMs?: number | null;
}

export type FetchImplementation = typeof fetch;

/**
 * 20 s cubre con holgura las lecturas del holder y la reconstrucción manual
 * de perfil (determinística, sin IA). No se aplica un timeout más agresivo:
 * abortar una operación legítima del backend sería peor que esperar.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * El primer acceso a la API de demo puede requerir que el servicio despierte.
 * Se reserva para login, registro y restauración de sesión; las consultas
 * habituales del Holder mantienen el límite general de 20 s.
 */
export const AUTH_TIMEOUT_MS = 45_000;

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  async request(
    path: `/${string}`,
    options: HttpRequestOptions = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const timeoutMs =
      options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    const controller = new AbortController();
    const externalSignal = options.signal;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    function abortFromExternal() {
      controller.abort();
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', abortFromExternal);
      }
    }

    if (timeoutMs !== null) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    let response: Response;

    try {
      response = await this.fetchImplementation(
        `${this.baseUrl}${path}`,
        {
          method: options.method ?? 'GET',
          headers,
          body: options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
          signal: controller.signal
        }
      );
    } catch {
      if (timedOut) {
        throw new ApiError(
          'El servicio tardó demasiado en responder.',
          'timeout'
        );
      }

      throw new ApiError('No fue posible conectar con el servicio.', 'network');
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', abortFromExternal);
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
      // Nunca se propaga el cuerpo del error del servidor: podría contener
      // detalle interno. La categoría (status) alcanza para decidir el copy.
      throw new ApiError(
        'El servicio rechazó la operación.',
        'http',
        response.status
      );
    }

    return payload;
  }
}

/** Petición ya autenticada: el token lo inyecta la capa de sesión. */
export type AuthenticatedRequest = (
  path: `/${string}`,
  options?: Omit<HttpRequestOptions, 'token'>
) => Promise<unknown>;
