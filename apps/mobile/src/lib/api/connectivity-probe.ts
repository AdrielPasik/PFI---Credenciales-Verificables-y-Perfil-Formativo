import type { HttpClient } from '@/lib/api/http-client';
import { ApiError } from '@/lib/errors/api-error';

export type ConnectivityProbeResult =
  | { status: 'reachable'; httpStatus: number }
  | { status: 'unexpected-response'; httpStatus: number | null }
  | { status: 'unreachable'; category: 'network' | 'timeout' | 'other' };

/**
 * Prueba no autenticada y read-only. Un 401 de `/auth/me` prueba que la API
 * está accesible; nunca limpia ni inspecciona la sesión Holder.
 */
export async function probeApiConnectivity(
  client: HttpClient
): Promise<ConnectivityProbeResult> {
  try {
    await client.request('/auth/me', { timeoutMs: 45_000 });
    return { status: 'unexpected-response', httpStatus: 200 };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: 'reachable', httpStatus: 401 };
    }

    if (error instanceof ApiError && error.kind === 'http') {
      return { status: 'unexpected-response', httpStatus: error.status };
    }

    if (error instanceof ApiError && error.kind === 'network') {
      return { status: 'unreachable', category: 'network' };
    }

    if (error instanceof ApiError && error.kind === 'timeout') {
      return { status: 'unreachable', category: 'timeout' };
    }

    return { status: 'unreachable', category: 'other' };
  }
}
