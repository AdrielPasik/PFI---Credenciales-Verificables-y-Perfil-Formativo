/**
 * Copy de error de Objetivos — P2.3.
 *
 * Se mapea POR STATUS. `ApiClient` descarta el cuerpo del error, asi que el
 * codigo de aplicacion (`OBJECTIVE_TOO_LARGE`, etc.) no llega al navegador. No
 * hace falta: el mapeo de NestJS es biyectivo por status, asi que el status
 * lleva la misma informacion.
 *
 * El copy NUNCA menciona proveedor, modelo, schema, parser ni codigos HTTP.
 * Traduce a intencion: que puede hacer la persona.
 */

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

export interface ObjectiveErrorMessage {
  message: string;
  /**
   * Si ofrecer reintento directo de la MISMA operacion.
   *
   * `false` cuando repetir lo mismo no puede dar otro resultado: ahi el copy
   * invita a cambiar algo en vez de a insistir.
   */
  retryable: boolean;
}

export function mapObjectiveProposalError(error: unknown): ObjectiveErrorMessage {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return {
      message: 'El servicio devolvio una propuesta incompatible.',
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
      case 400:
        return {
          message: 'Revisa los datos del objetivo antes de analizarlo.',
          retryable: false
        };
      case 413:
        return {
          message:
            'El texto del objetivo es demasiado largo para analizarlo de una vez. Proba acortarlo sin perder la parte que describe los requisitos.',
          retryable: false
        };
      case 422:
        return {
          message:
            'No pudimos generar una propuesta confiable para este objetivo. Revisa el texto e intenta nuevamente.',
          retryable: false
        };
      case 503:
        return {
          message: 'El servicio no esta disponible en este momento.',
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

export function mapObjectiveCreateError(error: unknown): ObjectiveErrorMessage {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return {
      message: 'El servicio devolvio una respuesta incompatible.',
      retryable: true
    };
  }

  if (error instanceof ApiError && error.kind === 'network') {
    return {
      message:
        'No pudimos conectar con el servicio. Revisa tu conexion e intenta de nuevo.',
      retryable: true
    };
  }

  if (error instanceof ApiError && error.kind === 'http' && error.status === 400) {
    return {
      message:
        'No pudimos confirmar el objetivo. Revisa que todos los requisitos tengan texto.',
      retryable: true
    };
  }

  return {
    message: 'El servicio no esta disponible. Volve a intentar.',
    retryable: true
  };
}

export function mapObjectiveReadError(error: unknown): string {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return 'El servicio devolvio un objetivo incompatible.';
  }
  if (error instanceof ApiError && error.kind === 'http' && error.status === 404) {
    return 'No encontramos este objetivo en tu espacio personal.';
  }
  return 'No pudimos cargar tus objetivos en este momento.';
}
