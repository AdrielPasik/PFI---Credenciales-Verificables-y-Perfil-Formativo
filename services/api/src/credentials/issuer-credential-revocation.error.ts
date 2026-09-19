import { HttpException, HttpStatus } from '@nestjs/common';

export type IssuerCredentialRevocationErrorCode =
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_NOT_ISSUED'
  | 'INVALID_REVOCATION_REASON'
  | 'BLOCKCHAIN_RECORD_UNRESOLVABLE'
  | 'BLOCKCHAIN_DEPLOYMENT_UNRESOLVED'
  | 'BLOCKCHAIN_SIGNER_UNAVAILABLE'
  | 'BLOCKCHAIN_SIGNER_UNAUTHORIZED'
  | 'BLOCKCHAIN_WRITE_FAILED'
  | 'BLOCKCHAIN_STATE_INCONSISTENT'
  | 'DATABASE_RECONCILIATION_FAILED'
  | 'PROFILE_RECONCILIATION_FAILED';

const SAFE_MESSAGES: Record<IssuerCredentialRevocationErrorCode, string> = {
  CREDENTIAL_NOT_FOUND: 'No se encontro la credencial solicitada.',
  CREDENTIAL_NOT_ISSUED: 'Solo se pueden revocar credenciales emitidas.',
  INVALID_REVOCATION_REASON: 'El motivo de revocacion no es valido.',
  BLOCKCHAIN_RECORD_UNRESOLVABLE:
    'No se pudo verificar de forma segura el registro tecnico de la credencial.',
  BLOCKCHAIN_DEPLOYMENT_UNRESOLVED:
    'La configuracion tecnica de revocacion no esta disponible.',
  BLOCKCHAIN_SIGNER_UNAVAILABLE:
    'La configuracion tecnica de revocacion no esta disponible.',
  BLOCKCHAIN_SIGNER_UNAUTHORIZED:
    'La configuracion tecnica no esta autorizada para revocar esta credencial.',
  BLOCKCHAIN_WRITE_FAILED:
    'No se pudo completar la revocacion tecnica. Intentelo nuevamente.',
  BLOCKCHAIN_STATE_INCONSISTENT:
    'El estado tecnico de la credencial requiere revision antes de revocarla.',
  DATABASE_RECONCILIATION_FAILED:
    'La revocacion tecnica fue confirmada, pero no se pudo actualizar el estado local. Intentelo nuevamente.',
  PROFILE_RECONCILIATION_FAILED:
    'La revocacion fue registrada, pero no se pudo actualizar el perfil formativo. Intentelo nuevamente.'
};

const STATUS_BY_CODE: Record<IssuerCredentialRevocationErrorCode, HttpStatus> = {
  CREDENTIAL_NOT_FOUND: HttpStatus.NOT_FOUND,
  CREDENTIAL_NOT_ISSUED: HttpStatus.CONFLICT,
  INVALID_REVOCATION_REASON: HttpStatus.BAD_REQUEST,
  BLOCKCHAIN_RECORD_UNRESOLVABLE: HttpStatus.CONFLICT,
  BLOCKCHAIN_DEPLOYMENT_UNRESOLVED: HttpStatus.SERVICE_UNAVAILABLE,
  BLOCKCHAIN_SIGNER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  BLOCKCHAIN_SIGNER_UNAUTHORIZED: HttpStatus.CONFLICT,
  BLOCKCHAIN_WRITE_FAILED: HttpStatus.BAD_GATEWAY,
  BLOCKCHAIN_STATE_INCONSISTENT: HttpStatus.CONFLICT,
  DATABASE_RECONCILIATION_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  PROFILE_RECONCILIATION_FAILED: HttpStatus.SERVICE_UNAVAILABLE
};

/** Safe, stable boundary error: no RPC, signer, record, or provider details. */
export class IssuerCredentialRevocationError extends HttpException {
  constructor(code: IssuerCredentialRevocationErrorCode) {
    super(
      { code, message: SAFE_MESSAGES[code] },
      STATUS_BY_CODE[code]
    );
  }
}
