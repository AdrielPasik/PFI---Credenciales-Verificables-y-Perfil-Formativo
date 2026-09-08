import { QueryClient } from '@tanstack/react-query';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

/**
 * Estado de servidor.
 *
 * TanStack Query es la ÚNICA fuente de estado remoto. No hay store global
 * propio replicando perfil o credenciales: eso sólo generaría dos verdades.
 * El estado local (secciones expandidas, inputs, visibilidad de la contraseña)
 * vive en `useState` dentro del componente que lo necesita.
 */

/**
 * Reintentar un 401/403/404 o un contrato incompatible no arregla nada y
 * multiplica peticiones. Sólo se reintenta lo que puede ser transitorio: red,
 * timeout y 5xx.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof IncompatiblePayloadError) return false;

  if (error instanceof ApiError) {
    if (error.kind === 'network' || error.kind === 'timeout') return true;
    return error.status !== null && error.status >= 500;
  }

  return false;
}

/**
 * `overrides` existe sólo para los tests, que desactivan el reintento para no
 * dejar temporizadores vivos al terminar. El runtime siempre usa los valores
 * por defecto.
 */
export function createQueryClient(overrides?: {
  retry?: boolean;
}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: overrides?.retry === false ? false : shouldRetry,
        // Cambiar de pestaña no debe disparar una petición nueva: los datos
        // del titular no cambian segundo a segundo (sección 199).
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true
      },
      mutations: {
        // Una mutación (compartir, actualizar perfil) nunca se reintenta
        // sola: podría duplicar un efecto que el usuario no pidió dos veces.
        retry: false
      }
    }
  });
}

export const queryKeys = {
  profile: ['holder', 'profile', 'current'] as const,
  credentials: ['holder', 'credentials'] as const,
  credential: (credentialReference: string) =>
    ['holder', 'credentials', credentialReference] as const
};
