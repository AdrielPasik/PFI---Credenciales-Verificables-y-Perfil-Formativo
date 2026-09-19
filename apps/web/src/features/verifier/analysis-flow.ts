/**
 * Nucleo puro del flujo publico de analisis.
 *
 * DOS reglas viven aca y en ningun otro lado:
 *
 *   1. EL SERVIDOR DECIDE EL PASO. El paso visible se deriva del estado de la
 *      sesion y del analisis, nunca de un indice de wizard guardado localmente.
 *      Un numero de paso persistido mentiria despues de una recarga.
 *   2. LOS ERRORES PUBLICOS SE TRADUCEN, NO SE FILTRAN. Cada codigo estable del
 *      backend tiene copy propia; lo desconocido cae en un mensaje generico y
 *      nunca se imprime el codigo crudo.
 */

import { ApiError } from '@/lib/errors/api-error';
import type {
  PublicAnalysisResultVM,
  PublicFailureCategoryToken,
  PublicVerificationSessionVM
} from '@/models/public-analysis';

/** Los cuatro pasos del producto. `unavailable` no es un paso: es el final del camino. */
export type AnalysisStep =
  | 'objective'
  | 'requirements'
  | 'ready'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Cadencia de lectura del resultado mientras el analisis corre.
 *
 * Conservadora a proposito: el trabajo dura minutos, asi que sondear mas rapido
 * solo agrega carga sin acercar la respuesta.
 */
export const RESULT_POLL_INTERVAL_MS = 4_000;

/** El paso que corresponde a una sesion leida del servidor. */
export function stepForSession(session: PublicVerificationSessionVM): AnalysisStep {
  switch (session.status) {
    case 'draft':
    case 'requirements_proposed':
      return 'requirements';
    case 'requirements_confirmed':
      return 'ready';
    case 'consumed':
      // Ya produjo un run: la autoridad pasa a ser el resultado.
      return 'processing';
  }
}

/** El paso que corresponde a un resultado leido del servidor. */
export function stepForResult(result: PublicAnalysisResultVM): AnalysisStep {
  switch (result.state) {
    case 'AWAITING_REQUIREMENTS':
      return 'requirements';
    case 'READY_TO_EXECUTE':
      return 'ready';
    case 'PROCESSING':
      return 'processing';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
  }
}

export function shouldKeepPolling(result: PublicAnalysisResultVM): boolean {
  return result.state === 'PROCESSING';
}

// ---------------------------------------------------------------------------
// Fallos del analisis
// ---------------------------------------------------------------------------

export type FailureRecovery =
  /** Mismo run, mismo token: se vuelve a pedir la ejecucion. */
  | 'RETRY_SAME_ANALYSIS'
  /** El run no se puede continuar: hace falta un analisis nuevo. */
  | 'START_NEW_ANALYSIS'
  /** No se ofrece nada: la autorizacion ya no esta. */
  | 'NONE';

export interface FailureCopy {
  title: string;
  description: string;
  recovery: FailureRecovery;
}

/**
 * Copy por categoria de fallo.
 *
 * `TEMPORARILY_UNAVAILABLE` es el UNICO caso que reintenta el mismo analisis: el
 * presupuesto de intentos lo administra el backend, y el cliente no lo cuenta ni
 * lo muestra.
 */
export function failureCopy(
  failure: { category: PublicFailureCategoryToken; retryable: boolean },
  contextualVerificationEnabled: boolean
): FailureCopy {
  switch (failure.category) {
    case 'TEMPORARILY_UNAVAILABLE':
      return {
        title: 'El análisis no pudo completarse en este intento',
        description: 'Fue un problema temporal. Podés volver a intentarlo con el mismo objetivo y los mismos requisitos.',
        recovery: failure.retryable ? 'RETRY_SAME_ANALYSIS' : 'START_NEW_ANALYSIS'
      };
    case 'AUTHORIZATION_WITHDRAWN':
      return {
        title: 'El análisis se detuvo',
        description: 'Se detuvo porque cambió la autorización del perfil.',
        // Si la autorizacion ya no esta, ofrecer "analizar de nuevo" seria
        // prometer algo que el backend va a rechazar.
        recovery: contextualVerificationEnabled ? 'START_NEW_ANALYSIS' : 'NONE'
      };
    case 'EXECUTION_INTERRUPTED':
      return {
        title: 'Este análisis no pudo finalizar',
        description: 'El proceso se interrumpió y no puede retomarse. Podés iniciar un análisis nuevo.',
        recovery: contextualVerificationEnabled ? 'START_NEW_ANALYSIS' : 'NONE'
      };
    case 'RETRY_BUDGET_EXHAUSTED':
    case 'EXECUTION_FAILED':
      return {
        title: 'El análisis no pudo completarse',
        description: 'No pudimos terminar este análisis. Podés iniciar uno nuevo.',
        recovery: contextualVerificationEnabled ? 'START_NEW_ANALYSIS' : 'NONE'
      };
  }
}

// ---------------------------------------------------------------------------
// Errores de la API
// ---------------------------------------------------------------------------

export interface PublicErrorCopy {
  message: string;
  /** La misma operacion puede volver a intentarse. */
  retryable: boolean;
  /** El enlace o la sesion ya no sirven: no tiene sentido seguir pidiendo. */
  fatal: boolean;
  /** La sesion guardada dejo de existir: hay que empezar una nueva. */
  sessionLost: boolean;
}

const ERROR_COPY: Record<string, PublicErrorCopy> = {
  SHARE_NOT_AVAILABLE: {
    message: 'Este perfil compartido ya no está disponible.',
    retryable: false,
    fatal: true,
    sessionLost: false
  },
  CONTEXTUAL_VERIFICATION_NOT_AVAILABLE: {
    message: 'Este perfil no tiene habilitado el análisis de trayectoria.',
    retryable: false,
    fatal: true,
    sessionLost: false
  },
  REQUEST_NOT_AVAILABLE: {
    message: 'Esta sesión de análisis ya no está disponible. Podés empezar una nueva.',
    retryable: false,
    fatal: false,
    sessionLost: true
  },
  REQUEST_NOT_CONFIRMED: {
    message: 'Primero confirmá los requisitos que se van a analizar.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  REQUIREMENTS_INVALID: {
    message: 'Revisá los requisitos: alguno no es válido.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  REQUIREMENTS_ALREADY_CONFIRMED: {
    message: 'Los requisitos ya fueron confirmados y no pueden cambiarse.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  OBJECTIVE_DEFINITION_INVALID: {
    message: 'No pudimos usar estos requisitos. Revisalos e intentá de nuevo.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  PROPOSAL_IN_PROGRESS: {
    message: 'Ya estamos preparando la propuesta de requisitos.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  PROPOSAL_COOLDOWN_ACTIVE: {
    message: 'Esperá unos segundos antes de pedir otra propuesta.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  PROPOSAL_TEMPORARILY_UNAVAILABLE: {
    message: 'No pudimos preparar la propuesta en este momento. Intentá de nuevo en un rato.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  PROPOSAL_UNAVAILABLE: {
    message: 'No pudimos proponer requisitos para este objetivo. Podés escribirlos vos.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  PROPOSAL_QUOTA_EXCEEDED: {
    message: 'Se alcanzó el límite de propuestas para este perfil. Intentá más tarde.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  ACTIVE_REQUEST_LIMIT_REACHED: {
    message: 'Este perfil tiene demasiados análisis abiertos. Intentá más tarde.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE: {
    message: 'La evidencia autorizada no está disponible en este momento. Intentá más tarde.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  NO_USABLE_AUTHORIZED_EVIDENCE: {
    message: 'La evidencia autorizada por este perfil no permite hacer un análisis.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  EXECUTION_IN_PROGRESS: {
    message: 'Ya hay un análisis en curso para este perfil. Probá de nuevo en unos minutos.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  RUN_QUOTA_EXCEEDED: {
    message: 'Se alcanzó el límite de análisis para este perfil. Intentá más tarde.',
    retryable: false,
    fatal: false,
    sessionLost: false
  },
  AUTHORIZATION_CHANGED: {
    message: 'La autorización del perfil cambió mientras preparábamos el análisis. Intentá de nuevo.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  SESSION_CONFLICT: {
    message: 'La sesión cambió mientras procesábamos el pedido. Volvé a intentarlo.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  FREEZE_CONFLICT: {
    message: 'El análisis se estaba preparando en paralelo. Volvé a intentarlo.',
    retryable: true,
    fatal: false,
    sessionLost: false
  },
  INVALID_REQUEST_INPUT: {
    message: 'Revisá los datos ingresados.',
    retryable: false,
    fatal: false,
    sessionLost: false
  }
};

const GENERIC: PublicErrorCopy = {
  message: 'No pudimos completar la operación. Intentá de nuevo.',
  retryable: true,
  fatal: false,
  sessionLost: false
};

const NETWORK: PublicErrorCopy = {
  message: 'No pudimos conectarnos con el servicio. Revisá tu conexión e intentá de nuevo.',
  retryable: true,
  fatal: false,
  sessionLost: false
};

/**
 * Traduce un error de la API a copy publica.
 *
 * Un 404 sin codigo se trata como enlace no disponible: es lo que responde el
 * backend cuando el enlace fue revocado, y seguir sondeando contra una autoridad
 * revocada no tiene sentido.
 */
export function publicErrorCopy(error: unknown): PublicErrorCopy {
  if (!(error instanceof ApiError)) return GENERIC;
  if (error.kind === 'network') return NETWORK;
  if (error.code !== null && ERROR_COPY[error.code]) return ERROR_COPY[error.code];
  if (error.status === 404) return ERROR_COPY.SHARE_NOT_AVAILABLE;
  return GENERIC;
}
