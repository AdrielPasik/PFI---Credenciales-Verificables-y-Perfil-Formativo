import { HttpException, HttpStatus } from '@nestjs/common';

export type ShareVerificationPolicyErrorCode =
  | 'SHARE_NOT_FOUND'
  | 'SHARE_NOT_ACTIVE'
  | 'SHARE_SCOPE_NOT_SUPPORTED'
  | 'INVALID_POLICY_REQUEST'
  | 'CREDENTIAL_SELECTION_REQUIRED'
  | 'CREDENTIAL_NOT_AUTHORIZABLE';

/**
 * `CREDENTIAL_NOT_AUTHORIZABLE` es deliberadamente UN codigo para "no existe",
 * "no es tuya", "es borrador" y "esta revocada".
 *
 * Distinguirlos convertiria el endpoint en un oraculo de existencia: un holder
 * podria probar ids ajenos y leer en la respuesta si esa credencial existe y en
 * que estado esta. El holder ve sus propias credenciales elegibles en la UI, asi
 * que no pierde nada util; un atacante pierde el canal entero.
 */
const SAFE_MESSAGES: Record<ShareVerificationPolicyErrorCode, string> = {
  SHARE_NOT_FOUND: 'No se encontro el enlace compartido solicitado.',
  SHARE_SCOPE_NOT_SUPPORTED:
    'Este tipo de enlace no admite analisis contextual. Solo un enlace de perfil puede habilitarlo.',
  SHARE_NOT_ACTIVE:
    'El enlace compartido ya no esta activo. Compartí un enlace nuevo para configurar el analisis contextual.',
  INVALID_POLICY_REQUEST: 'La configuracion enviada no es valida.',
  CREDENTIAL_SELECTION_REQUIRED:
    'Para habilitar el analisis contextual tenes que elegir al menos una credencial.',
  CREDENTIAL_NOT_AUTHORIZABLE:
    'Alguna de las credenciales seleccionadas no esta disponible para autorizar.'
};

const STATUS_BY_CODE: Record<ShareVerificationPolicyErrorCode, HttpStatus> = {
  SHARE_NOT_FOUND: HttpStatus.NOT_FOUND,
  SHARE_NOT_ACTIVE: HttpStatus.CONFLICT,
  SHARE_SCOPE_NOT_SUPPORTED: HttpStatus.CONFLICT,
  INVALID_POLICY_REQUEST: HttpStatus.BAD_REQUEST,
  CREDENTIAL_SELECTION_REQUIRED: HttpStatus.BAD_REQUEST,
  CREDENTIAL_NOT_AUTHORIZABLE: HttpStatus.BAD_REQUEST
};

/** Frontera estable: nunca expone ids ajenos, tokenHash ni estado interno. */
export class ShareVerificationPolicyError extends HttpException {
  constructor(code: ShareVerificationPolicyErrorCode) {
    super({ code, message: SAFE_MESSAGES[code] }, STATUS_BY_CODE[code]);
  }
}
