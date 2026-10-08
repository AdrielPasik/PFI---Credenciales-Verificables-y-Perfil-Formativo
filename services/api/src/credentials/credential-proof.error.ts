/**
 * Errores tipados de construccion del proof de credential -- S8c4.
 *
 * Misma forma que `SignerResolutionError`: un `code` estable mas un mensaje
 * que sale SIEMPRE de `SAFE_MESSAGES`, un mapa de literales fijos.
 *
 * INVARIANTE DE SEGURIDAD: no se interpola NADA en el mensaje. Por
 * construccion no puede arrastrar el `canonicalHash` de una credencial ajena,
 * un `secretRef`, una direccion, una clave publica persistida ni el cuerpo de
 * una excepcion de AWS. El contexto util para operar viaja en propiedades
 * separadas y es el llamador el que decide si lo loguea.
 *
 * Deliberadamente NO es una `HttpException`: el mapeo a codigo HTTP lo decide
 * la capa de emision, que es la que conoce las convenciones de su API.
 */

export type CredentialProofErrorCode =
  // Identidad publica del issuer (contrato de S8c3, evaluado en local)
  | 'ISSUER_DID_NOT_CONFIGURED'
  | 'ISSUER_DID_NOT_RESOLVABLE'
  // Signer resuelto
  | 'SIGNER_PURPOSE_NOT_ASSERTION'
  | 'INVALID_KEY_VERSION'
  // S8c8: la clave de asercion vigente cambio durante la emision
  | 'ASSERTION_BINDING_CHANGED'
  // Envelope scope-proof-v1
  | 'MALFORMED_VERIFICATION_METHOD'
  | 'MALFORMED_CANONICAL_HASH'
  | 'ENVELOPE_NOT_ASCII'
  // Firma producida
  | 'MALFORMED_PROOF_VALUE'
  | 'NON_CANONICAL_SIGNATURE';

/**
 * Los tres mensajes de configuracion/consistencia son DELIBERADAMENTE
 * indistinguibles entre si en texto: un emisor mal configurado no debe poder
 * averiguar, desde la respuesta, si lo que falla es el DID almacenado, el
 * proposito del perfil o la correspondencia criptografica.
 */
const SAFE_MESSAGES: Record<CredentialProofErrorCode, string> = {
  ASSERTION_BINDING_CHANGED:
    'La clave de asercion del emisor cambio durante la emision.',
  ISSUER_DID_NOT_CONFIGURED:
    'El emisor no tiene una identidad tecnica publicable configurada.',
  ISSUER_DID_NOT_RESOLVABLE:
    'El emisor no tiene una identidad tecnica publicable configurada.',
  SIGNER_PURPOSE_NOT_ASSERTION:
    'El perfil de firma resuelto no es el de asercion del emisor.',
  INVALID_KEY_VERSION:
    'La version de clave del perfil de firma no es utilizable.',
  MALFORMED_VERIFICATION_METHOD:
    'El metodo de verificacion del emisor no tiene una forma admisible.',
  MALFORMED_CANONICAL_HASH:
    'El hash canonico no tiene la representacion exigida por canon_v2.',
  ENVELOPE_NOT_ASCII:
    'El envelope de firma contiene bytes fuera del rango admitido.',
  MALFORMED_PROOF_VALUE: 'La firma producida no tiene la forma compacta exigida.',
  NON_CANONICAL_SIGNATURE: 'La firma producida no es canonica.'
};

/** Identificadores seguros, opcionales. Nunca material secreto. */
export interface CredentialProofErrorContext {
  issuerId?: string;
  credentialId?: string;
  profileId?: string;
}

export class CredentialProofError extends Error {
  readonly code: CredentialProofErrorCode;
  readonly issuerId?: string;
  readonly credentialId?: string;
  readonly profileId?: string;

  constructor(
    code: CredentialProofErrorCode,
    context: CredentialProofErrorContext = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'CredentialProofError';
    this.code = code;

    if (context.issuerId !== undefined) {
      this.issuerId = context.issuerId;
    }
    if (context.credentialId !== undefined) {
      this.credentialId = context.credentialId;
    }
    if (context.profileId !== undefined) {
      this.profileId = context.profileId;
    }
  }
}

/** Mensaje fijo asociado a un code, para aserciones de tests. */
export function safeCredentialProofMessage(
  code: CredentialProofErrorCode
): string {
  return SAFE_MESSAGES[code];
}
