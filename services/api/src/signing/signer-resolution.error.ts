/**
 * Errores tipados de resolucion de signer -- S8c2.
 *
 * Misma forma que `DocumentStorageError`: un `code` estable mas un mensaje.
 * Deliberadamente NO es una `HttpException`: nada de esto cruza todavia un
 * limite HTTP, y cuando lo haga sera la capa de arriba la que decida el mapeo.
 *
 * INVARIANTE DE SEGURIDAD: el mensaje sale SIEMPRE de `SAFE_MESSAGES`, que es
 * un mapa de literales fijos. Nunca se interpola nada en el mensaje, asi que
 * por construccion no puede contener la private key, el `secretRef`, el cuerpo
 * de la respuesta de SSM ni un dump de una excepcion de AWS.
 *
 * El contexto util para operar (issuerId, profileId, nombre de la clase de
 * error de AWS) viaja en propiedades SEPARADAS, nunca dentro del mensaje, y es
 * responsabilidad del llamador decidir si lo loguea.
 */

export type SignerResolutionErrorCode =
  // Identidad tecnica del issuer
  | 'TECHNICAL_IDENTITY_NOT_CONFIGURED'
  | 'TECHNICAL_IDENTITY_INACTIVE'
  // Perfil de firma
  | 'SIGNER_PROFILE_NOT_CONFIGURED'
  | 'SIGNER_PROFILE_INACTIVE'
  | 'SIGNER_PURPOSE_MISMATCH'
  | 'SIGNER_ADDRESS_NOT_VERIFIED'
  // Acceso al secreto
  | 'SIGNER_SECRET_REFERENCE_REJECTED'
  | 'SIGNER_SECRET_UNAVAILABLE'
  | 'SIGNER_SECRET_INVALID'
  // Consistencia criptografica
  | 'SIGNER_ADDRESS_MISMATCH'
  | 'SIGNER_PUBLIC_KEY_MISMATCH';

const SAFE_MESSAGES: Record<SignerResolutionErrorCode, string> = {
  TECHNICAL_IDENTITY_NOT_CONFIGURED:
    'El issuer no tiene una identidad tecnica configurada.',
  TECHNICAL_IDENTITY_INACTIVE:
    'La identidad tecnica del issuer no esta activa.',
  SIGNER_PROFILE_NOT_CONFIGURED:
    'La identidad tecnica no tiene un perfil de firma para ese proposito.',
  SIGNER_PROFILE_INACTIVE: 'El perfil de firma no esta activo.',
  SIGNER_PURPOSE_MISMATCH:
    'El perfil de firma no corresponde al proposito solicitado.',
  SIGNER_ADDRESS_NOT_VERIFIED:
    'El perfil de firma no completo la verificacion de su direccion.',
  SIGNER_SECRET_REFERENCE_REJECTED:
    'La referencia al secreto del perfil de firma no es admisible.',
  SIGNER_SECRET_UNAVAILABLE:
    'No se pudo obtener el material de firma desde el almacen de secretos.',
  SIGNER_SECRET_INVALID:
    'El material de firma obtenido no es una clave privada valida.',
  SIGNER_ADDRESS_MISMATCH:
    'La direccion derivada del material de firma no coincide con la registrada.',
  SIGNER_PUBLIC_KEY_MISMATCH:
    'La clave publica derivada del material de firma no coincide con la registrada.'
};

/**
 * Identificadores seguros, opcionales. Nunca material secreto.
 *
 * `awsErrorName` es SOLO el nombre de la clase de error del SDK
 * (p. ej. `ParameterNotFound`), nunca su mensaje: un mensaje de AWS puede
 * arrastrar metadata de infraestructura.
 */
export interface SignerResolutionErrorContext {
  issuerId?: string;
  profileId?: string;
  awsErrorName?: string;
}

export class SignerResolutionError extends Error {
  readonly code: SignerResolutionErrorCode;
  readonly issuerId?: string;
  readonly profileId?: string;
  readonly awsErrorName?: string;

  constructor(
    code: SignerResolutionErrorCode,
    context: SignerResolutionErrorContext = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'SignerResolutionError';
    this.code = code;

    if (context.issuerId !== undefined) {
      this.issuerId = context.issuerId;
    }
    if (context.profileId !== undefined) {
      this.profileId = context.profileId;
    }
    if (context.awsErrorName !== undefined) {
      this.awsErrorName = context.awsErrorName;
    }
  }
}

/** Mensaje fijo asociado a un code, para aserciones de tests. */
export function safeSignerResolutionMessage(
  code: SignerResolutionErrorCode
): string {
  return SAFE_MESSAGES[code];
}
