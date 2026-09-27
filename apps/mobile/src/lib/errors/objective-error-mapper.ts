import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

/**
 * Copy de error de Objetivos.
 *
 * Se mapea POR STATUS. `HttpClient` descarta el cuerpo del error, así que el
 * código de aplicación (`OBJECTIVE_TOO_LARGE`, etc.) no llega al cliente. No
 * hace falta: el mapeo de NestJS es biyectivo por status.
 *
 * El copy NUNCA menciona proveedor, modelo, schema, parser ni códigos HTTP.
 * Traduce a intención: qué puede hacer la persona.
 */

export interface ObjectiveErrorMessage {
  message: string;
  /**
   * Si ofrecer reintento directo de la MISMA operación.
   *
   * `false` cuando repetir lo mismo no puede dar otro resultado: ahí el copy
   * invita a cambiar algo en vez de a insistir. Importa especialmente acá:
   * cada reintento de una propuesta es una llamada al proveedor.
   */
  retryable: boolean;
}

function isIncompatible(error: unknown): boolean {
  return (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  );
}

export function mapObjectiveProposalError(
  error: unknown
): ObjectiveErrorMessage {
  if (isIncompatible(error)) {
    return {
      message: 'El servicio devolvió una propuesta incompatible.',
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
        'El análisis del objetivo tardó demasiado. Volvé a intentarlo en unos minutos.',
      retryable: true
    };
  }

  if (error instanceof ApiError && error.kind === 'http') {
    switch (error.status) {
      case 400:
        return {
          message: 'Revisá los datos del objetivo antes de analizarlo.',
          retryable: false
        };
      case 413:
        return {
          message:
            'El texto del objetivo es demasiado largo para analizarlo de una vez. Probá acortarlo sin perder la parte que describe los requisitos.',
          retryable: false
        };
      case 422:
        return {
          message:
            'No pudimos generar una propuesta confiable para este objetivo. Revisá el texto e intentá nuevamente.',
          retryable: false
        };
      case 503:
        return {
          message: 'El servicio no está disponible en este momento.',
          retryable: true
        };
      default:
        return {
          message: 'No pudimos analizar el objetivo en este momento.',
          retryable: true
        };
    }
  }

  return {
    message: 'No pudimos analizar el objetivo en este momento.',
    retryable: true
  };
}

export function mapObjectiveCreateError(
  error: unknown
): ObjectiveErrorMessage {
  if (isIncompatible(error)) {
    return {
      message: 'El servicio devolvió una respuesta incompatible.',
      retryable: true
    };
  }

  if (
    error instanceof ApiError &&
    (error.kind === 'network' || error.kind === 'timeout')
  ) {
    return {
      message:
        'No pudimos conectar con Scope. Revisá tu conexión e intentá de nuevo.',
      retryable: true
    };
  }

  if (
    error instanceof ApiError &&
    error.kind === 'http' &&
    error.status === 400
  ) {
    return {
      message:
        'No pudimos confirmar el objetivo. Revisá que todos los requisitos tengan texto.',
      retryable: true
    };
  }

  if (
    error instanceof ApiError &&
    error.kind === 'http' &&
    error.status === 413
  ) {
    return {
      message:
        'El objetivo revisado quedó demasiado grande para confirmarlo. Volvé a editar el objetivo y acortá el texto original antes de analizarlo nuevamente.',
      retryable: false
    };
  }

  return {
    message: 'El servicio no está disponible. Volvé a intentar.',
    retryable: true
  };
}

export function mapObjectiveReadError(error: unknown): string {
  if (isIncompatible(error)) {
    return 'El servicio devolvió un objetivo incompatible.';
  }

  if (
    error instanceof ApiError &&
    error.kind === 'http' &&
    error.status === 404
  ) {
    return 'No encontramos este objetivo en tu espacio personal.';
  }

  if (error instanceof ApiError && error.kind === 'network') {
    return 'Sin conexión con Scope. Revisá tu conexión e intentá de nuevo.';
  }

  return 'No pudimos cargar tus objetivos en este momento.';
}
