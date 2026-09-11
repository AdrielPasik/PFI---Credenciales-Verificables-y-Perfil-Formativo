/**
 * Vocabulario de error de la API privada de ReasoningRuns — slice F3.7.
 *
 * ES UN VOCABULARIO PROPIO, NO UN PASSTHROUGH. Los códigos internos de F3.3–F3.6
 * describen la PROVENIENCIA OPERATIVA de un fallo —qué etapa, qué proveedor, qué
 * plan— y esa información no pertenece a una respuesta HTTP: le contaría a quien
 * pregunta cosas sobre nuestra infraestructura que no necesita para actuar.
 *
 * La API distingue exactamente dos cosas, que es lo que un cliente puede usar:
 *
 *     ¿puedo hacer algo al respecto?      → 4xx accionable
 *     ¿es un problema del servidor?        → 5xx genérico, sin detalle
 *
 * NUNCA se exponen:
 *
 *     PROVIDER_TRANSPORT_FAILURE · PROVIDER_CONFIGURATION_FAILURE
 *     EXECUTION_PLAN_MISMATCH · ai_service_error_v1 · status HTTP del proveedor
 *     model / prompt / adapter / reasoningEffort
 *     el `failureCode` interno de la fila
 *
 * Mismo patrón que `ObjectiveRowError` de F2.2: los códigos y su estado HTTP se
 * declaran juntos, el service lanza directamente, y en 5xx el cuerpo es genérico.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export const REASONING_RUN_API_CODES = [
  /**
   * No existe, o no pertenece a quien pregunta. UN SOLO código para los dos
   * casos: distinguirlos convertiría la API en un oráculo de existencia.
   */
  'REASONING_RUN_NOT_FOUND',
  /** El Objective no existe o no es de quien pregunta. Misma indistinguibilidad. */
  'OBJECTIVE_NOT_FOUND',
  /**
   * El Objective existe y es del usuario, pero su artifact persistido ya no
   * verifica. Es CORRUPCIÓN nuestra, no un error del cliente: cuerpo genérico.
   */
  'OBJECTIVE_UNREADABLE',
  /** Otra ejecución tiene la claim de este run. */
  'EXECUTION_ALREADY_RUNNING',
  /**
   * El run terminó en `failed` y no se reejecuta en la misma fila.
   *
   * Una observación epistemológica nueva es un ReasoningRun nuevo: el universo de
   * evidencia se congela al crearlo, así que "reintentar" uno muerto sería
   * evaluar contra un congelado que ya se declaró inutilizable.
   */
  'RUN_TERMINALLY_FAILED',
  /**
   * Fallo TRANSITORIO. El run quedó reintentable y el mismo `execute` sirve.
   *
   * La API no dice por qué: sabe que no se pudo ahora, no que un proveedor
   * concreto dio timeout.
   */
  'EXECUTION_TEMPORARILY_UNAVAILABLE',
  /**
   * Fallo interno de ejecución, terminal o desconocido. Cuerpo genérico.
   *
   * El detalle del desenlace vive en el recurso: `GET` del run muestra
   * `status: failed`.
   */
  'EXECUTION_FAILED',
  /**
   * La historia persistida no se puede leer con confianza —snapshot corrupto,
   * resultado ausente o inconsistente con su propio Objective—.
   *
   * FALLA CERRADO: no se repara, no se recomputa y no se devuelve un resultado
   * parcialmente confiable.
   */
  'REASONING_RUN_HISTORY_UNREADABLE'
] as const;

export type ReasoningRunApiCode = (typeof REASONING_RUN_API_CODES)[number];

const API_STATUS: Record<ReasoningRunApiCode, HttpStatus> = {
  REASONING_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  OBJECTIVE_NOT_FOUND: HttpStatus.NOT_FOUND,
  OBJECTIVE_UNREADABLE: HttpStatus.INTERNAL_SERVER_ERROR,
  EXECUTION_ALREADY_RUNNING: HttpStatus.CONFLICT,
  RUN_TERMINALLY_FAILED: HttpStatus.CONFLICT,
  EXECUTION_TEMPORARILY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  EXECUTION_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  REASONING_RUN_HISTORY_UNREADABLE: HttpStatus.INTERNAL_SERVER_ERROR
};

/**
 * Mensajes FIJOS por código. No se compone texto con datos de la fila ni del
 * error interno: un mensaje que interpola deja de ser un contrato estable y se
 * vuelve un canal por el que se escapa información.
 */
const API_MESSAGE: Record<ReasoningRunApiCode, string> = {
  REASONING_RUN_NOT_FOUND: 'No se encontro el analisis solicitado.',
  OBJECTIVE_NOT_FOUND: 'No se encontro el objetivo solicitado.',
  OBJECTIVE_UNREADABLE: 'No se pudo leer el objetivo solicitado.',
  EXECUTION_ALREADY_RUNNING: 'El analisis ya se esta ejecutando.',
  RUN_TERMINALLY_FAILED:
    'El analisis termino con un fallo y no puede volver a ejecutarse. Crea uno nuevo.',
  EXECUTION_TEMPORARILY_UNAVAILABLE:
    'El analisis no se pudo ejecutar en este momento. Intentalo de nuevo mas tarde.',
  EXECUTION_FAILED: 'No se pudo completar el analisis.',
  REASONING_RUN_HISTORY_UNREADABLE: 'No se pudo leer el analisis solicitado.'
};

export class ReasoningRunApiError extends HttpException {
  public readonly code: ReasoningRunApiCode;

  public constructor(code: ReasoningRunApiCode) {
    const status = API_STATUS[code];
    super(
      // En 5xx viaja SOLO el mensaje genérico: un fallo de integridad o de
      // ejecución nuestro no le describe el estado interno a nadie. En 4xx viaja
      // además el código, que es un identificador cerrado y accionable.
      status === HttpStatus.INTERNAL_SERVER_ERROR
        ? { statusCode: status, message: API_MESSAGE[code] }
        : { statusCode: status, message: API_MESSAGE[code], code },
      status
    );
    this.name = 'ReasoningRunApiError';
    this.code = code;
  }
}

export function failReasoningRunApi(code: ReasoningRunApiCode): never {
  throw new ReasoningRunApiError(code);
}

/**
 * Categorías de fallo VISIBLES en el recurso.
 *
 * `ReasoningRun.failureCode` es un string operativo y deliberadamente
 * extensible: F3.1 lo dejó así para que agregar un desenlace no costara una
 * migración. Devolverlo crudo convertiría cada token interno futuro en contrato
 * público por accidente.
 *
 * Se proyecta a un conjunto CERRADO y pequeño, y todo lo desconocido cae en
 * `EXECUTION_FAILED`. Un código interno nuevo no puede ensanchar esta API sola.
 */
export const RUN_FAILURE_CATEGORIES = [
  /** El universo de evidencia no se pudo congelar de forma utilizable. */
  'EVIDENCE_PREPARATION_BLOCKED',
  /** Cualquier otro desenlace terminal. */
  'EXECUTION_FAILED'
] as const;

export type RunFailureCategory = (typeof RUN_FAILURE_CATEGORIES)[number];

/** El único código interno con categoría propia hoy. */
const FAILURE_CATEGORY_BY_INTERNAL_CODE: Readonly<Record<string, RunFailureCategory>> = {
  reasoning_input_freeze_blocked: 'EVIDENCE_PREPARATION_BLOCKED'
};

export function toFailureCategory(
  internalFailureCode: string | null
): RunFailureCategory | null {
  if (internalFailureCode === null) return null;
  return FAILURE_CATEGORY_BY_INTERNAL_CODE[internalFailureCode] ?? 'EXECUTION_FAILED';
}
