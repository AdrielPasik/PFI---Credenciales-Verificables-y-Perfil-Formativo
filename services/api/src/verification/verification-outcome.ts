import { CredentialStatus } from '@prisma/client';

/**
 * Modelo de resultado de la verificacion publica -- S8c7.
 *
 * ---------------------------------------------------------------------------
 * TRES PREGUNTAS DISTINTAS
 * ---------------------------------------------------------------------------
 *
 * Hasta S8c6 la verificacion publica respondia una sola cosa, y la respondia
 * leyendo la base: "existe la fila y tiene un canonicalHash". Eso no es
 * verificacion.
 *
 * S8c7 separa tres preguntas que nunca deben colapsarse:
 *
 *   AUTENTICIDAD   firmo una clave de asercion AUTORIZADA POR EL DID del
 *                  issuer exactamente este payload canonico?
 *   ESTADO         la credencial esta vigente o revocada?
 *   EVIDENCIA      que evidencia de anclaje/revocacion INDEPENDIENTE puede
 *                  observar Scope ahora mismo para este hash canonico?
 *
 * ---------------------------------------------------------------------------
 * FALSO != DESCONOCIDO
 * ---------------------------------------------------------------------------
 *
 * La distincion epistemologica es el centro de la slice:
 *
 *   INVALID        hay evidencia POSITIVA de que el artefacto esta mal --
 *                  firma que no corresponde, hash que no reproduce, DID que
 *                  resuelve bien y NO autoriza la clave referida.
 *   INDETERMINATE  no hay evidencia confiable suficiente para decidir -- el
 *                  DID no se puede resolver, el documento es inutilizable, la
 *                  credencial es de un formato anterior al firmado.
 *
 * Una caida del RPC no vuelve invalida una credencial. Un DID indisponible
 * tampoco. Y una cadena que SI registra el hash no arregla una firma mala.
 */

// ---------------------------------------------------------------------------
// ENUMS -- VALORES SERIALIZADOS CONGELADOS
// ---------------------------------------------------------------------------

export const CREDENTIAL_AUTHENTICITY_VALUES = [
  'VERIFIED',
  'INVALID',
  'INDETERMINATE'
] as const;

export type CredentialAuthenticity =
  (typeof CREDENTIAL_AUTHENTICITY_VALUES)[number];

/**
 * Estado de la credencial EN EL DOMINIO DE VERIFICACION.
 *
 * Nombre deliberadamente distinto de `CredentialStatus` de Prisma, que modela
 * `draft | issued | revoked`: son dos conjuntos distintos y tener dos simbolos
 * homonimos en el mismo codigo seria una invitacion al error. Los valores
 * serializados publicos no cambian por eso.
 */
export const VERIFICATION_CREDENTIAL_STATUS_VALUES = [
  'ACTIVE',
  'REVOKED',
  'UNKNOWN'
] as const;

export type VerificationCredentialStatus =
  (typeof VERIFICATION_CREDENTIAL_STATUS_VALUES)[number];

export const BLOCKCHAIN_EVIDENCE_VALUES = [
  'REGISTERED',
  'PENDING',
  'REVOKED_ON_CHAIN',
  'NOT_FOUND',
  'UNAVAILABLE',
  'NOT_APPLICABLE_MOCK',
  'REGISTRANT_UNEXPECTED'
] as const;

export type BlockchainEvidence = (typeof BLOCKCHAIN_EVIDENCE_VALUES)[number];

export const VERIFICATION_HEADLINE_VALUES = [
  'VERIFIED',
  'VERIFIED_WITH_LIMITED_EVIDENCE',
  'INVALID',
  'REVOKED',
  'INDETERMINATE'
] as const;

export type VerificationHeadline =
  (typeof VERIFICATION_HEADLINE_VALUES)[number];

// ---------------------------------------------------------------------------
// RAZONES -- CODIGOS FIJOS, NUNCA MENSAJES DE EXCEPCION
// ---------------------------------------------------------------------------

/**
 * Motivo de un resultado de autenticidad.
 *
 * Son codigos CERRADOS. Nunca se construyen interpolando un `error.message`,
 * una URL de RPC, un UUID de perfil ni un valor de la base: un motivo es una
 * clasificacion, no un volcado de diagnostico.
 */
export const CREDENTIAL_AUTHENTICITY_REASON_VALUES = [
  'PROOF_VERIFIED',
  /** credential_v1 legitima: nunca se firmo. No es un defecto. */
  'LEGACY_UNSIGNED_CREDENTIAL',
  /** schemaVersion que este verificador no conoce. No se interpreta como v2. */
  'UNSUPPORTED_CREDENTIAL_VERSION',
  'CANONICALIZATION_VERSION_INCONSISTENT',
  'CANONICAL_PAYLOAD_UNREPRODUCIBLE',
  'CANONICAL_HASH_MISMATCH',
  'PROOF_MISSING',
  'PROOF_CONTRACT_VIOLATION',
  'PROOF_VALUE_NOT_CANONICAL',
  'VERIFICATION_METHOD_MALFORMED',
  'VERIFICATION_METHOD_FOREIGN_DID',
  'ISSUER_DID_NOT_RESOLVABLE',
  'ISSUER_DID_DOCUMENT_UNUSABLE',
  'ASSERTION_KEY_NOT_PUBLISHED',
  'ASSERTION_KEY_NOT_AUTHORIZED',
  'ASSERTION_KEY_MATERIAL_UNUSABLE',
  'SIGNATURE_MISMATCH'
] as const;

export type CredentialAuthenticityReason =
  (typeof CREDENTIAL_AUTHENTICITY_REASON_VALUES)[number];

export const BLOCKCHAIN_EVIDENCE_REASON_VALUES = [
  'CHAIN_STATE_OBSERVED',
  'MOCK_EVIDENCE_RECORD',
  'NO_BLOCKCHAIN_RECORD',
  /**
   * Mas de un BlockchainRecord para la misma credential. El dominio crea
   * exactamente uno, asi que esto es una anomalia de integridad y no una
   * coleccion cronologica: no se elige ninguna fila.
   */
  'AMBIGUOUS_BLOCKCHAIN_RECORDS',
  'DEPLOYMENT_UNRESOLVED',
  'EXPECTED_REGISTRANT_UNRESOLVED',
  /** El hash del record no es el canonicalHash de la credential. */
  'RECORD_HASH_CORRELATION_FAILED',
  'RPC_UNAVAILABLE',
  'CHAIN_NOT_REGISTERED',
  'REGISTRANT_MISMATCH',
  'PENDING_INTENT_NOT_YET_ON_CHAIN'
] as const;

export type BlockchainEvidenceReason =
  (typeof BLOCKCHAIN_EVIDENCE_REASON_VALUES)[number];

// ---------------------------------------------------------------------------
// ESTADO -- MONOTONICO RESPECTO DE REVOCACION CONFIABLE
// ---------------------------------------------------------------------------

/**
 * Deriva el estado de verificacion.
 *
 * Mapeo base de la base de datos:
 *
 *   issued  -> ACTIVE
 *   revoked -> REVOKED
 *   otro    -> UNKNOWN
 *
 * Y una sola regla de monotonia: una revocacion OBSERVADA en la cadena bajo el
 * registrante esperado gana sobre un `issued` local que todavia no se puso al
 * dia. La direccion contraria NO existe: una cadena que dice "no revocada" no
 * resucita una credencial que el emisor revoco, porque el emisor es la
 * autoridad de revocacion y el anclaje es evidencia, no permiso.
 *
 * Y una indisponibilidad NUNCA degrada el estado: si no se puede leer la
 * cadena, el estado local sigue siendo el estado. Convertir ACTIVE en UNKNOWN
 * por un timeout de RPC seria exactamente el error que esta slice existe para
 * eliminar -- confundir "no se pudo observar" con "no se sabe nada".
 */
export function deriveCredentialStatus(input: {
  persistedStatus: CredentialStatus;
  blockchainEvidence: BlockchainEvidence;
}): VerificationCredentialStatus {
  if (input.blockchainEvidence === 'REVOKED_ON_CHAIN') {
    return 'REVOKED';
  }

  if (input.persistedStatus === CredentialStatus.revoked) {
    return 'REVOKED';
  }

  if (input.persistedStatus === CredentialStatus.issued) {
    return 'ACTIVE';
  }

  // `draft` no llega aca -- la ruta publica lo trata como inexistente -- y
  // cualquier estado futuro que este verificador no conozca no se adivina.
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// HEADLINE -- UNA SOLA FUNCION PURA
// ---------------------------------------------------------------------------

/**
 * Deriva el titular. SIN dependencias: ni Prisma, ni red, ni reloj.
 *
 * PRECEDENCIA, en este orden exacto:
 *
 *   1. autenticidad INVALID        -> INVALID
 *   2. estado REVOKED              -> REVOKED
 *   3. autenticidad INDETERMINATE  -> INDETERMINATE
 *   4. estado UNKNOWN              -> INDETERMINATE
 *   5. VERIFIED + ACTIVE, segun la evidencia de cadena.
 *
 * POR QUE INVALID VA PRIMERO. Si el artefacto es positivamente invalido, no se
 * puede titular REVOKED: eso insinuaria que fue una credencial valida que
 * despues se revoco. Una credencial manipulada sigue siendo invalida.
 *
 * POR QUE REVOKED LE GANA A INDETERMINATE. Si la autenticidad quedo
 * indeterminada porque el DID no se pudo resolver, pero SI hay estado de
 * revocacion confiable, "revocada" es el titular accionable y seguro. Salvo
 * que la autenticidad sea positivamente invalida, que sigue ganando.
 *
 * POR QUE NOT_FOUND ES "EVIDENCIA LIMITADA" Y NO INVALIDEZ. Una firma valida
 * del emisor autentica la credencial independientemente de que el anclaje
 * externo se pueda encontrar ahora. Redefinir autenticidad como existencia en
 * la cadena seria cambiar la pregunta.
 *
 * POR QUE REGISTRANT_UNEXPECTED ES INDETERMINATE. La firma puede ser valida,
 * pero existe evidencia en la cadena bajo un registrante que CONTRADICE la
 * procedencia historica del anclaje. Eso no es "evidencia limitada": es
 * evidencia en conflicto, y es mas fuerte que una ausencia.
 */
export function deriveVerificationHeadline(input: {
  authenticity: CredentialAuthenticity;
  status: VerificationCredentialStatus;
  blockchainEvidence: BlockchainEvidence;
}): VerificationHeadline {
  if (input.authenticity === 'INVALID') {
    return 'INVALID';
  }

  if (input.status === 'REVOKED') {
    return 'REVOKED';
  }

  if (input.authenticity === 'INDETERMINATE') {
    return 'INDETERMINATE';
  }

  if (input.status === 'UNKNOWN') {
    return 'INDETERMINATE';
  }

  // Aca: autenticidad VERIFIED y estado ACTIVE.
  switch (input.blockchainEvidence) {
    case 'REGISTERED':
      return 'VERIFIED';

    case 'PENDING':
    case 'NOT_FOUND':
    case 'UNAVAILABLE':
    case 'NOT_APPLICABLE_MOCK':
      return 'VERIFIED_WITH_LIMITED_EVIDENCE';

    case 'REGISTRANT_UNEXPECTED':
      return 'INDETERMINATE';

    case 'REVOKED_ON_CHAIN':
      // Inalcanzable: `deriveCredentialStatus` ya convirtio esto en REVOKED y
      // la regla 2 lo habria capturado. Se guarda de forma defensiva en vez de
      // caer en el caso de "evidencia limitada", que seria una mentira.
      return 'REVOKED';
  }
}

// ---------------------------------------------------------------------------
// PROYECCION DE COMPATIBILIDAD
// ---------------------------------------------------------------------------

/**
 * Valores historicos de `verification.result`.
 *
 * El adaptador web vigente valida este conjunto CERRADO: agregar un cuarto
 * valor rompe la pagina de verificacion en el navegador. Asi que el campo se
 * conserva tal cual y se DERIVA del titular.
 */
export type PublicCredentialVerificationResult =
  | 'valid_issued'
  | 'revoked'
  | 'not_verifiable';

/**
 * Proyeccion de compatibilidad del titular al enum legacy.
 *
 * El modelo autoritativo es `{authenticity, status, blockchainEvidence,
 * headline}`. Este enum es una PROYECCION con menos resolucion que se mantiene
 * solo porque hay un consumidor desplegado que lo valida.
 *
 * Deliberadamente NO reimplementa la vieja regla de base de datos. Si lo
 * hiciera habria dos verdades en la misma respuesta: una fina y nueva, y otra
 * gruesa calculada por otro camino. Un guard estructural congela que este sea
 * el unico origen del campo.
 *
 * Consecuencia conocida y aceptada: una credential_v1 legitima pasa de
 * `valid_issued` a `not_verifiable`, porque su autenticidad es INDETERMINATE.
 * El enum no tiene forma de decir "formato anterior, sin prueba criptografica";
 * el titular y la razon si, y el texto de la respuesta lo dice con claridad.
 */
export function deriveLegacyVerificationResult(
  headline: VerificationHeadline
): PublicCredentialVerificationResult {
  switch (headline) {
    case 'REVOKED':
      return 'revoked';

    case 'VERIFIED':
    case 'VERIFIED_WITH_LIMITED_EVIDENCE':
      return 'valid_issued';

    case 'INVALID':
    case 'INDETERMINATE':
      return 'not_verifiable';
  }
}
