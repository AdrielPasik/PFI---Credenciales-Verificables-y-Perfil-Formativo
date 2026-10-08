/**
 * Errores tipados de rotacion de signers -- S8c8.
 *
 * Misma forma que `SignerResolutionError`: un `code` estable mas un mensaje que
 * sale SIEMPRE de un mapa de literales fijos. Nunca se interpola nada, asi que
 * por construccion el mensaje no puede contener un `secretRef`, una direccion,
 * un id de perfil ni un dump de excepcion.
 *
 * El contexto util para operar viaja en propiedades SEPARADAS.
 *
 * NO es una `HttpException`: S8c8 no expone ninguna ruta de rotacion. Si S8c9
 * agrega una superficie operativa, sera esa capa la que decida el mapeo HTTP.
 */

export type SignerRotationErrorCode =
  // Identidad tecnica
  | 'TECHNICAL_IDENTITY_NOT_CONFIGURED'
  | 'TECHNICAL_IDENTITY_NOT_ROTATABLE'
  // Perfil vigente del que se rota
  | 'CURRENT_PROFILE_NOT_FOUND'
  | 'CURRENT_PROFILE_PURPOSE_MISMATCH'
  | 'CURRENT_PROFILE_RETIRED'
  | 'CURRENT_ASSERTION_NOT_BOUND'
  // Perfil nuevo
  | 'NEW_PROFILE_NOT_FOUND'
  | 'NEW_PROFILE_PURPOSE_MISMATCH'
  | 'NEW_PROFILE_NOT_ACTIVE'
  | 'NEW_PROFILE_ADDRESS_NOT_VERIFIED'
  | 'NEW_PROFILE_PUBLIC_KEY_UNUSABLE'
  | 'NEW_PROFILE_ALREADY_CURRENT'
  | 'NEW_PROFILE_BOUND_TO_ANOTHER_ISSUER'
  | 'NEW_PROFILE_KEY_VERSION_NOT_NEXT'
  // Concurrencia
  | 'ROTATION_CONFLICT';

const SAFE_MESSAGES: Record<SignerRotationErrorCode, string> = {
  TECHNICAL_IDENTITY_NOT_CONFIGURED:
    'El issuer no tiene una identidad tecnica configurada.',
  TECHNICAL_IDENTITY_NOT_ROTATABLE:
    'La identidad tecnica del issuer no admite rotacion en su estado actual.',
  CURRENT_PROFILE_NOT_FOUND:
    'El perfil de firma vigente del issuer no existe.',
  CURRENT_PROFILE_PURPOSE_MISMATCH:
    'El perfil de firma vigente no corresponde al proposito que se rota.',
  CURRENT_PROFILE_RETIRED:
    'El perfil de firma vigente esta retirado, lo que es un estado incoherente.',
  CURRENT_ASSERTION_NOT_BOUND:
    'La clave de asercion vigente no figura en la historia del issuer.',
  NEW_PROFILE_NOT_FOUND: 'El perfil de firma nuevo no existe.',
  NEW_PROFILE_PURPOSE_MISMATCH:
    'El perfil de firma nuevo no corresponde al proposito que se rota.',
  NEW_PROFILE_NOT_ACTIVE: 'El perfil de firma nuevo no esta activo.',
  NEW_PROFILE_ADDRESS_NOT_VERIFIED:
    'El perfil de firma nuevo no completo la verificacion de su direccion.',
  NEW_PROFILE_PUBLIC_KEY_UNUSABLE:
    'El perfil de firma nuevo no tiene material publico de asercion utilizable.',
  NEW_PROFILE_ALREADY_CURRENT:
    'El perfil de firma nuevo ya es el vigente del issuer.',
  NEW_PROFILE_BOUND_TO_ANOTHER_ISSUER:
    'El perfil de asercion nuevo ya pertenece a otro issuer.',
  NEW_PROFILE_KEY_VERSION_NOT_NEXT:
    'La version de clave del perfil nuevo no es la siguiente de la historia.',
  ROTATION_CONFLICT:
    'La configuracion de firma del issuer cambio durante la rotacion.'
};

export interface SignerRotationErrorContext {
  issuerId?: string;
  profileId?: string;
}

export class SignerRotationError extends Error {
  readonly code: SignerRotationErrorCode;
  readonly issuerId?: string;
  readonly profileId?: string;

  constructor(
    code: SignerRotationErrorCode,
    context: SignerRotationErrorContext = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'SignerRotationError';
    this.code = code;

    if (context.issuerId !== undefined) {
      this.issuerId = context.issuerId;
    }
    if (context.profileId !== undefined) {
      this.profileId = context.profileId;
    }
  }
}

/** Mensaje fijo asociado a un code, para aserciones de tests. */
export function safeSignerRotationMessage(
  code: SignerRotationErrorCode
): string {
  return SAFE_MESSAGES[code];
}
