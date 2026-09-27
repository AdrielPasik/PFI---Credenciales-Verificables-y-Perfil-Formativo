import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { RunFailureCategory } from '@/types/reasoning-runs';

/**
 * Copy de error del Análisis de trayectoria.
 *
 * Se mapea POR STATUS, igual que `objective-error-mapper.ts`. El copy NUNCA
 * menciona proveedor, modelo, prompt, etapa, policy ni `failureCode`. Traduce a
 * intención: qué puede hacer la persona ahora.
 */

export interface ReasoningRunErrorMessage {
  message: string;
  /** Si repetir la MISMA operación puede dar otro resultado. */
  retryable: boolean;
}

function isIncompatible(error: unknown): boolean {
  return (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  );
}

/**
 * Errores de crear o ejecutar.
 *
 * El 409 no se reintenta: significa que ese run ya no puede continuar, y la
 * respuesta de producto es empezar uno nuevo, no insistir sobre la misma fila.
 */
export function mapReasoningRunActionError(
  error: unknown
): ReasoningRunErrorMessage {
  if (isIncompatible(error)) {
    return {
      message: 'El servicio devolvió un análisis incompatible.',
      retryable: false
    };
  }

  if (error instanceof ApiError && error.kind === 'network') {
    return {
      message:
        'No pudimos conectar con Scope. Revisá tu conexión e intentá de nuevo.',
      retryable: true
    };
  }

  if (error instanceof ApiError && error.kind === 'timeout') {
    return {
      message:
        'El análisis tardó más de lo esperado. Puede haber seguido en el servidor: volvé a abrir el objetivo en unos minutos antes de iniciar uno nuevo.',
      retryable: false
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
            'Este análisis ya no puede continuar. Podés iniciar un análisis nuevo cuando quieras.',
          retryable: false
        };
      case 503:
        return {
          message:
            'El análisis no se pudo completar en este momento. Volvé a intentarlo en un rato.',
          retryable: true
        };
      default:
        return {
          message: 'No pudimos completar el análisis de tu trayectoria.',
          retryable: true
        };
    }
  }

  return {
    message: 'No pudimos completar el análisis de tu trayectoria.',
    retryable: true
  };
}

export function mapReasoningRunReadError(error: unknown): string {
  if (isIncompatible(error)) {
    return 'El servicio devolvió un análisis incompatible.';
  }

  if (
    error instanceof ApiError &&
    error.kind === 'http' &&
    error.status === 404
  ) {
    return 'No encontramos este análisis en tu espacio personal.';
  }

  return 'No pudimos cargar el análisis de tu trayectoria en este momento.';
}

/**
 * Qué le pasó a un run que terminó en `failed`.
 *
 * `EVIDENCE_PREPARATION_BLOCKED` es la única categoría accionable: significa que
 * el problema estuvo en preparar la evidencia, no en razonar — y no dice nada
 * sobre lo que la persona sabe o deja de saber. Todo lo demás es genérico a
 * propósito. El token de la categoría NUNCA se muestra.
 */
export function describeRunFailure(
  category: RunFailureCategory | null
): string {
  if (category === 'EVIDENCE_PREPARATION_BLOCKED') {
    return 'Scope no pudo preparar toda la evidencia de tus credenciales para este análisis. Puede que alguna fuente no esté disponible todavía.';
  }

  return 'El análisis no pudo completarse.';
}
