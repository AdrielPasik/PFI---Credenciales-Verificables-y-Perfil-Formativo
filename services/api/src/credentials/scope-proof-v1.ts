/**
 * Contrato PURO de `scope-proof-v1` -- congelado en S8b.1, implementado en S8c4.
 *
 * Este archivo es la UNICA fuente de los literales del profile y la UNICA
 * construccion del envelope firmado. Un segundo armado de ese string, aunque
 * fuera "equivalente", es exactamente la forma de que el firmante y el futuro
 * verificador (S8c7) se separen un byte. S8c7 debe reusar este mismo builder.
 *
 * NO tiene dependencias: ni ethers, ni Nest, ni Prisma, ni red, ni reloj. Es
 * una funcion de strings. La firma la hace el llamador con una Wallet ya
 * resuelta; aca no hay, ni puede haber, material secreto.
 *
 * ADVERTENCIA SOBRE EL ENVELOPE: es texto firmado. Cualquier cambio en el
 * orden de las lineas, en los nombres de campo, en el separador o en la
 * ausencia de salto final cambia el digest y por lo tanto invalida TODA firma
 * ya emitida. Esta congelado.
 */

import {
  CredentialProofError,
  type CredentialProofErrorContext
} from './credential-proof.error';

// ---------------------------------------------------------------------------
// CONSTANTES DEL PROFILE
// ---------------------------------------------------------------------------

export const SCOPE_PROOF_V1_PROFILE = 'scope-proof-v1';
export const SCOPE_PROOF_V1_TYPE = 'ScopeCredentialProof2026';
export const SCOPE_PROOF_V1_CRYPTOSUITE = 'ecdsa-secp256k1-eip191';
export const SCOPE_PROOF_V1_PROOF_PURPOSE = 'assertionMethod';
export const SCOPE_PROOF_V1_CANONICALIZATION_VERSION = 'canon_v2';
export const SCOPE_PROOF_V1_HASH_ALGORITHM = 'sha-256';

/** Fragmento de la assertion key, EXACTAMENTE como lo publica S8c3. */
export const SCOPE_PROOF_V1_KEY_FRAGMENT_PREFIX = 'assert-';

// ---------------------------------------------------------------------------
// FORMAS ADMITIDAS
// ---------------------------------------------------------------------------

/**
 * `canonicalHashText`: `0x` mas 64 hex EN MINUSCULA. Es mas estricto que
 * credential_v1 a proposito -- el envelope embebe el hash como TEXTO, asi que
 * dos representaciones del mismo digest producirian dos firmas distintas sobre
 * la misma credencial.
 */
const CANONICAL_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

/**
 * Misma expresion que `packages/schemas/credential_v2.schema.json`. Al exigir
 * solo este alfabeto queda garantizado, por construccion, que el
 * verificationMethod es ASCII y que no puede colar un CR ni un LF que partan
 * el envelope en lineas adicionales.
 */
const VERIFICATION_METHOD_PATTERN =
  /^did:web:[A-Za-z0-9._%:-]+#assert-[1-9][0-9]*$/;

/** Firma compacta de Ethereum: r(32) || s(32) || v(1), hex minuscula. */
const PROOF_VALUE_PATTERN = /^0x[0-9a-f]{130}$/;

/** Orden del grupo secp256k1. */
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// ---------------------------------------------------------------------------
// PROOF PERSISTIDO
// ---------------------------------------------------------------------------

/**
 * Objeto `proof` tal cual se persiste en `Credential.proof` y se serializa.
 *
 * EXACTAMENTE ocho claves. `created` fue eliminado a proposito en S8b.1:
 * `issued_at` ya viaja autenticado dentro de canon_v2, y un segundo timestamp
 * solo agregaria un campo mutable sin firmar. Tampoco lleva `canonicalHash`
 * (vive a nivel Credential), ni direccion, ni keyVersion suelta, ni nada de
 * la red.
 */
export interface ScopeProofV1 {
  readonly type: typeof SCOPE_PROOF_V1_TYPE;
  readonly profile: typeof SCOPE_PROOF_V1_PROFILE;
  readonly cryptosuite: typeof SCOPE_PROOF_V1_CRYPTOSUITE;
  readonly proofPurpose: typeof SCOPE_PROOF_V1_PROOF_PURPOSE;
  readonly verificationMethod: string;
  readonly canonicalizationVersion: typeof SCOPE_PROOF_V1_CANONICALIZATION_VERSION;
  readonly hashAlgorithm: typeof SCOPE_PROOF_V1_HASH_ALGORITHM;
  readonly proofValue: string;
}

// ---------------------------------------------------------------------------
// verificationMethod
// ---------------------------------------------------------------------------

/**
 * Construye la DID URL de la assertion key: `<storedIssuerDid>#assert-<N>`.
 *
 * `issuerDid` tiene que ser el DID ALMACENADO en `IssuerTechnicalIdentity`,
 * nunca uno recalculado contra la configuracion actual. No se normaliza, no se
 * pasa a minusculas y no se re-codifica: tiene que salir byte a byte igual al
 * `id` del verificationMethod que publica el DID Document de S8c3.
 */
export function buildScopeProofV1VerificationMethod(
  issuerDid: string,
  keyVersion: number,
  context: CredentialProofErrorContext = {}
): string {
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new CredentialProofError('INVALID_KEY_VERSION', context);
  }

  const verificationMethod =
    issuerDid + '#' + SCOPE_PROOF_V1_KEY_FRAGMENT_PREFIX + String(keyVersion);

  if (!VERIFICATION_METHOD_PATTERN.test(verificationMethod)) {
    throw new CredentialProofError('MALFORMED_VERIFICATION_METHOD', context);
  }

  return verificationMethod;
}

// ---------------------------------------------------------------------------
// ENVELOPE -- SEIS LINEAS, BYTE EXACTO
// ---------------------------------------------------------------------------

/**
 * Envelope con separacion de dominio de `scope-proof-v1`.
 *
 * Exactamente seis lineas, separadas por LF, SIN salto final:
 *
 *   scope-proof-v1
 *   proofPurpose=assertionMethod
 *   verificationMethod=<DID URL exacta>
 *   canonicalizationVersion=canon_v2
 *   hashAlgorithm=sha-256
 *   canonicalHash=<0x + 64 hex minuscula>
 *
 * Las constantes se inyectan desde aca: el llamador NO elige el profile, ni el
 * proofPurpose, ni la version de canonicalizacion, ni el algoritmo de hash.
 * Solo aporta los dos datos que varian por credencial.
 *
 * `type` y `cryptosuite` NO viajan en el envelope: son constantes fijas del
 * profile, y el profile si va firmado -- es la primera linea.
 */
export function buildScopeProofV1Envelope(
  input: {
    verificationMethod: string;
    canonicalHash: string;
  },
  context: CredentialProofErrorContext = {}
): string {
  if (!VERIFICATION_METHOD_PATTERN.test(input.verificationMethod)) {
    throw new CredentialProofError('MALFORMED_VERIFICATION_METHOD', context);
  }

  if (!CANONICAL_HASH_PATTERN.test(input.canonicalHash)) {
    throw new CredentialProofError('MALFORMED_CANONICAL_HASH', context);
  }

  const envelope = [
    SCOPE_PROOF_V1_PROFILE,
    'proofPurpose=' + SCOPE_PROOF_V1_PROOF_PURPOSE,
    'verificationMethod=' + input.verificationMethod,
    'canonicalizationVersion=' + SCOPE_PROOF_V1_CANONICALIZATION_VERSION,
    'hashAlgorithm=' + SCOPE_PROOF_V1_HASH_ALGORITHM,
    'canonicalHash=' + input.canonicalHash
  ].join('\n');

  // Invariante ASCII, comprobada sobre el envelope YA ARMADO y no solo sobre
  // sus partes. Un CR (0x0d) rompe el contrato "LF only" sin cambiar el
  // recuento de lineas, asi que falla cerrado igual que cualquier otro byte
  // fuera de rango. Nunca se normaliza para hacerlo entrar.
  assertAsciiEnvelope(envelope, context);

  return envelope;
}

function assertAsciiEnvelope(
  envelope: string,
  context: CredentialProofErrorContext
): void {
  for (let index = 0; index < envelope.length; index += 1) {
    const codeUnit = envelope.charCodeAt(index);

    if (codeUnit > 0x7f || codeUnit === 0x0d) {
      throw new CredentialProofError('ENVELOPE_NOT_ASCII', context);
    }
  }
}

// ---------------------------------------------------------------------------
// FIRMA PRODUCIDA
// ---------------------------------------------------------------------------

/**
 * Comprueba la forma de la firma compacta: 65 bytes, `v` en {27,28} y `s`
 * canonica (`s <= n/2`).
 *
 * Es una verificacion de FORMA, no de autenticidad: no recupera la direccion y
 * no decide si el proof es valido. Eso es S8c7. Aca solo se evita persistir un
 * `proofValue` que no respete la forma congelada -- en particular una `s` alta,
 * que haria la firma maleable.
 *
 * Se parsea el hex directamente para que este modulo siga sin dependencias.
 */
export function assertCanonicalScopeProofValue(
  proofValue: string,
  context: CredentialProofErrorContext = {}
): void {
  if (!PROOF_VALUE_PATTERN.test(proofValue)) {
    throw new CredentialProofError('MALFORMED_PROOF_VALUE', context);
  }

  const hex = proofValue.slice(2);
  const s = BigInt('0x' + hex.slice(64, 128));
  const v = Number.parseInt(hex.slice(128, 130), 16);

  if (v !== 27 && v !== 28) {
    throw new CredentialProofError('NON_CANONICAL_SIGNATURE', context);
  }

  if (s === 0n || s > SECP256K1_N / 2n) {
    throw new CredentialProofError('NON_CANONICAL_SIGNATURE', context);
  }
}

// ---------------------------------------------------------------------------
// OBJETO proof
// ---------------------------------------------------------------------------

/**
 * Ensambla el objeto `proof` persistible. Las seis constantes del profile las
 * pone esta funcion; el llamador solo aporta `verificationMethod` y la firma.
 */
export function buildScopeProofV1(
  input: {
    verificationMethod: string;
    proofValue: string;
  },
  context: CredentialProofErrorContext = {}
): ScopeProofV1 {
  if (!VERIFICATION_METHOD_PATTERN.test(input.verificationMethod)) {
    throw new CredentialProofError('MALFORMED_VERIFICATION_METHOD', context);
  }

  assertCanonicalScopeProofValue(input.proofValue, context);

  return {
    type: SCOPE_PROOF_V1_TYPE,
    profile: SCOPE_PROOF_V1_PROFILE,
    cryptosuite: SCOPE_PROOF_V1_CRYPTOSUITE,
    proofPurpose: SCOPE_PROOF_V1_PROOF_PURPOSE,
    verificationMethod: input.verificationMethod,
    canonicalizationVersion: SCOPE_PROOF_V1_CANONICALIZATION_VERSION,
    hashAlgorithm: SCOPE_PROOF_V1_HASH_ALGORITHM,
    proofValue: input.proofValue
  };
}
