import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Codigos estables de la verificacion contextual publica.
 *
 * Varios casos se COLAPSAN a proposito en un mismo codigo:
 *
 *   SHARE_NOT_AVAILABLE     token mal formado, inexistente, revocado, vencido o
 *                           de un alcance no soportado
 *   REQUEST_NOT_AVAILABLE   token inexistente, vencido o de OTRO enlace
 *
 * Separarlos convertiria cada endpoint futuro en un oraculo: un tercero podria
 * distinguir "este enlace existio y fue revocado" de "nunca existio", o probar si
 * una solicitud pertenece a otro enlace.
 */
export type PublicVerificationErrorCode =
  | 'SHARE_NOT_AVAILABLE'
  | 'CONTEXTUAL_VERIFICATION_NOT_AVAILABLE'
  | 'INVALID_REQUEST_INPUT'
  | 'REQUEST_NOT_AVAILABLE'
  | 'REQUEST_NOT_CONFIRMED'
  | 'OBJECTIVE_DEFINITION_INVALID'
  | 'AUTHORIZATION_CHANGED'
  | 'AUTHORIZED_EVIDENCE_INCONSISTENT'
  | 'NO_USABLE_AUTHORIZED_EVIDENCE'
  | 'AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE'
  | 'EXECUTION_IN_PROGRESS'
  | 'RUN_QUOTA_EXCEEDED'
  | 'FREEZE_CONFLICT'
  | 'SESSION_CONFLICT'
  | 'ACTIVE_REQUEST_LIMIT_REACHED'
  | 'PROPOSAL_IN_PROGRESS'
  | 'PROPOSAL_QUOTA_EXCEEDED'
  | 'PROPOSAL_COOLDOWN_ACTIVE'
  | 'PROPOSAL_TEMPORARILY_UNAVAILABLE'
  | 'PROPOSAL_UNAVAILABLE'
  | 'REQUIREMENTS_INVALID'
  | 'REQUIREMENTS_ALREADY_CONFIRMED';

const SAFE_MESSAGES: Record<PublicVerificationErrorCode, string> = {
  SHARE_NOT_AVAILABLE: 'El enlace compartido no está disponible.',
  CONTEXTUAL_VERIFICATION_NOT_AVAILABLE:
    'Este perfil no tiene habilitado el análisis contextual.',
  INVALID_REQUEST_INPUT: 'Los datos enviados no son válidos.',
  REQUEST_NOT_AVAILABLE: 'La solicitud de análisis no está disponible.',
  REQUEST_NOT_CONFIRMED: 'Los requisitos de la solicitud todavía no fueron confirmados.',
  OBJECTIVE_DEFINITION_INVALID: 'La definición del objetivo no es válida.',
  AUTHORIZATION_CHANGED:
    'La autorización del perfil cambió mientras se preparaba el análisis. Intentá nuevamente.',
  AUTHORIZED_EVIDENCE_INCONSISTENT:
    'La evidencia autorizada no pudo verificarse de forma segura.',
  NO_USABLE_AUTHORIZED_EVIDENCE:
    'La evidencia autorizada por este perfil no tiene contenido utilizable para un análisis.',
  AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE:
    'Parte de la evidencia autorizada no está disponible en este momento. Intentá nuevamente más tarde.',
  EXECUTION_IN_PROGRESS:
    'Ya hay un análisis en curso para este perfil. Intentá nuevamente en unos minutos.',
  RUN_QUOTA_EXCEEDED:
    'Se alcanzó el límite de análisis para este perfil. Intentá nuevamente más tarde.',
  FREEZE_CONFLICT: 'La solicitud se está procesando en paralelo. Intentá nuevamente.',
  SESSION_CONFLICT: 'La sesión cambió mientras se procesaba el pedido. Volvé a consultarla.',
  ACTIVE_REQUEST_LIMIT_REACHED:
    'Este perfil tiene demasiadas solicitudes de análisis abiertas. Intentá más tarde.',
  PROPOSAL_IN_PROGRESS: 'La propuesta de requisitos todavía se está generando.',
  PROPOSAL_QUOTA_EXCEEDED:
    'Se alcanzó el límite de propuestas para este perfil. Intentá nuevamente más tarde.',
  PROPOSAL_COOLDOWN_ACTIVE: 'Esperá un momento antes de pedir otra propuesta.',
  PROPOSAL_TEMPORARILY_UNAVAILABLE:
    'No se pudo generar la propuesta en este momento. Intentá nuevamente más tarde.',
  PROPOSAL_UNAVAILABLE: 'No se pudo producir una propuesta confiable para este objetivo.',
  REQUIREMENTS_INVALID: 'Los requisitos enviados no son válidos.',
  REQUIREMENTS_ALREADY_CONFIRMED:
    'Los requisitos de esta solicitud ya fueron confirmados y no pueden cambiarse.'
};

const STATUS_BY_CODE: Record<PublicVerificationErrorCode, HttpStatus> = {
  SHARE_NOT_AVAILABLE: HttpStatus.NOT_FOUND,
  CONTEXTUAL_VERIFICATION_NOT_AVAILABLE: HttpStatus.FORBIDDEN,
  INVALID_REQUEST_INPUT: HttpStatus.BAD_REQUEST,
  REQUEST_NOT_AVAILABLE: HttpStatus.NOT_FOUND,
  REQUEST_NOT_CONFIRMED: HttpStatus.CONFLICT,
  OBJECTIVE_DEFINITION_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  AUTHORIZATION_CHANGED: HttpStatus.CONFLICT,
  AUTHORIZED_EVIDENCE_INCONSISTENT: HttpStatus.CONFLICT,
  NO_USABLE_AUTHORIZED_EVIDENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  EXECUTION_IN_PROGRESS: HttpStatus.CONFLICT,
  RUN_QUOTA_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  FREEZE_CONFLICT: HttpStatus.CONFLICT,
  SESSION_CONFLICT: HttpStatus.CONFLICT,
  ACTIVE_REQUEST_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  PROPOSAL_IN_PROGRESS: HttpStatus.CONFLICT,
  PROPOSAL_QUOTA_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  PROPOSAL_COOLDOWN_ACTIVE: HttpStatus.TOO_MANY_REQUESTS,
  PROPOSAL_TEMPORARILY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PROPOSAL_UNAVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  REQUIREMENTS_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  REQUIREMENTS_ALREADY_CONFIRMED: HttpStatus.CONFLICT
};

/** Solo estos se resuelven reintentando la MISMA operacion. */
export const RETRYABLE_PUBLIC_VERIFICATION_CODES: ReadonlySet<PublicVerificationErrorCode> =
  new Set([
    'AUTHORIZATION_CHANGED',
    'FREEZE_CONFLICT',
    'AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE',
    'EXECUTION_IN_PROGRESS',
    'SESSION_CONFLICT',
    'PROPOSAL_IN_PROGRESS',
    'PROPOSAL_COOLDOWN_ACTIVE',
    'PROPOSAL_TEMPORARILY_UNAVAILABLE'
  ]);

/** Frontera estable: nunca ids, SHAs, storage, ids autorizados ni `src_NN`. */
export class PublicVerificationError extends HttpException {
  constructor(readonly code: PublicVerificationErrorCode) {
    super({ code, message: SAFE_MESSAGES[code] }, STATUS_BY_CODE[code]);
  }
}
