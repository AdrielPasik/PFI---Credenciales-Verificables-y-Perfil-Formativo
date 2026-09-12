/**
 * Copy de error del Analisis de trayectoria — P2.4B.
 *
 * Se mapea POR STATUS, igual que `objective-error-mapper.ts`: `ApiClient`
 * descarta el cuerpo del error, asi que ningun codigo interno llega al
 * navegador. Tampoco hace falta — el mapeo de NestJS es biyectivo por status.
 *
 * El copy NUNCA menciona proveedor, modelo, prompt, etapa, policy ni
 * `failureCode`. Traduce a intencion: que puede hacer la persona ahora.
 */

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { RunFailureCategory } from '@/models/reasoning-runs';

export interface ReasoningRunErrorMessage {
  message: string;
  /** Si repetir la MISMA operacion puede dar otro resultado. */
  retryable: boolean;
}

/**
 * Errores de crear o ejecutar.
 *
 * El 409 se parte en dos porque las dos situaciones piden cosas distintas de la
 * persona: si otra ejecucion tiene la claim, esperar; si el run murio, ya no se
 * reintenta esa fila y hay que empezar uno nuevo.
 */
export function mapReasoningRunActionError(
  error: unknown
): ReasoningRunErrorMessage {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return {
      message: 'El servicio devolvio un analisis incompatible.',
      retryable: false
    };
  }

  if (error instanceof ApiError && error.kind === 'network') {
    return {
      message:
        'No pudimos conectar con el servicio. Revisa tu conexion e intenta de nuevo.',
      retryable: true
    };
  }

  if (error instanceof ApiError && error.kind === 'http') {
    switch (error.status) {
      case 404:
        return {
          message: 'No encontramos este objetivo en tu espacio personal.',
          retryable: false
        };
      case 409:
        return {
          message:
            'Este analisis ya no puede continuar. Podes iniciar un analisis nuevo cuando quieras.',
          retryable: false
        };
      case 503:
        return {
          message:
            'El analisis no se pudo completar en este momento. Volve a intentarlo en un rato.',
          retryable: true
        };
      default:
        return {
          message: 'No pudimos completar el analisis de tu trayectoria.',
          retryable: true
        };
    }
  }

  return {
    message: 'No pudimos completar el analisis de tu trayectoria.',
    retryable: true
  };
}

export function mapReasoningRunReadError(error: unknown): string {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return 'El servicio devolvio un analisis incompatible.';
  }
  if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
    return 'No encontramos este analisis en tu espacio personal.';
  }
  return 'No pudimos cargar el analisis de tu trayectoria en este momento.';
}

/**
 * Que le paso a un run que termino en `failed`.
 *
 * `EVIDENCE_PREPARATION_BLOCKED` es la unica categoria accionable: significa que
 * el problema estuvo en preparar la evidencia, no en razonar. Todo lo demas es
 * generico a proposito.
 */
export function describeRunFailure(category: RunFailureCategory | null): string {
  if (category === 'EVIDENCE_PREPARATION_BLOCKED') {
    return 'No pudimos preparar la evidencia de tus credenciales para este analisis. Puede que alguna fuente no este disponible todavia.';
  }
  return 'El analisis no pudo completarse.';
}
