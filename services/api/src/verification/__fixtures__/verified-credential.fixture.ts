/**
 * Vector GOLDEN de verificacion -- S8c7.
 *
 * Es EXACTAMENTE la credencial congelada en S8b.1/S8c4: el mismo
 * `canonicalHash` de canon_v2, el mismo envelope de 288 bytes, el mismo
 * `proofValue` y la misma direccion recuperada. Si cualquiera de esos valores
 * cambiara, S8c4 y S8c7 fallarian a la vez, que es justamente el encadenamiento
 * que se busca: la verificacion no puede derivar de la emision.
 *
 * La JWK se deriva de `PUBLIC_TEST_KEY_ONE` -- el escalar secp256k1 1, publico
 * y reproducible, etiquetado DO NOT FUND -- y no se copia ningun material
 * criptografico nuevo al repositorio.
 */

import { PUBLIC_TEST_KEY_ONE } from '../../signing/__fixtures__/signer-test-keys';

export const VECTOR_ISSUER_ID = '3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
export const VECTOR_ISSUER_DID = `did:web:api.scopeedu.technology:did:issuers:${VECTOR_ISSUER_ID}`;
export const VECTOR_SUBJECT_DID =
  'did:web:api.scopeedu.technology:did:users:c41d8e92-7a35-4f08-b6e2-19d7c530a84b';
export const VECTOR_CREDENTIAL_ID = '8d4b1f60-2c73-4a95-8e01-5f7a9b3d6c28';

export const VECTOR_CANONICAL_HASH =
  '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca';
export const VECTOR_PROOF_VALUE =
  '0x59c5d2831ba95beeb568d98a99d4b4c4c4a0a714e63b3ce06aca16511a1f0532' +
  '21321abd6400ceb3875c05248cb3c32c41d29847aa65d2d71b17336fe662b4c31c';
export const VECTOR_VERIFICATION_METHOD = `${VECTOR_ISSUER_DID}#assert-1`;
export const VECTOR_SIGNER_ADDRESS = PUBLIC_TEST_KEY_ONE.address;

/** base64url SIN padding de los 32 bytes de cada coordenada. */
export const VECTOR_JWK_X = Buffer.from(
  PUBLIC_TEST_KEY_ONE.publicKeyX.slice(2),
  'hex'
).toString('base64url');
export const VECTOR_JWK_Y = Buffer.from(
  PUBLIC_TEST_KEY_ONE.publicKeyY.slice(2),
  'hex'
).toString('base64url');

/** El objeto `proof` persistido, con sus OCHO claves exactas. */
export function vectorProof(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ScopeCredentialProof2026',
    profile: 'scope-proof-v1',
    cryptosuite: 'ecdsa-secp256k1-eip191',
    proofPurpose: 'assertionMethod',
    verificationMethod: VECTOR_VERIFICATION_METHOD,
    canonicalizationVersion: 'canon_v2',
    hashAlgorithm: 'sha-256',
    proofValue: VECTOR_PROOF_VALUE,
    ...overrides
  };
}

/**
 * Estado persistido de la credencial, tal como lo lee la verificacion.
 *
 * Los valores reproducen el payload canonico del vector, con sus bordes
 * incluidos: el titulo trae whitespace para colapsar, `issuedAt` trae
 * milisegundos para truncar y `credentialSubject` mezcla camelCase con
 * snake_case y texto sin normalizar.
 */
export function vectorCredentialState(overrides: Record<string, unknown> = {}) {
  return {
    credentialId: VECTOR_CREDENTIAL_ID,
    schemaVersion: 'credential_v2',
    canonicalizationVersion: 'canon_v2',
    canonicalHash: VECTOR_CANONICAL_HASH,
    proof: vectorProof(),
    type: 'course',
    title: '  Programación   Avanzada  ',
    description: 'Curso de programación orientada a objetos.',
    issuedAt: new Date('2026-03-15T10:42:17.853Z'),
    hours: 60,
    credentialSubject: {
      achievementName: 'Programación Avanzada',
      institution_name: 'Universidad Argentina de la Empresa (UADE)',
      skills: ['TypeScript', 'álgebra', 'Programación'],
      competencies: ['disẽno de software'],
      grade: '9',
      completionDate: '2026-03-10',
      academicPeriod: '2026-1C'
    },
    issuerId: VECTOR_ISSUER_ID,
    issuerTechnicalDid: VECTOR_ISSUER_DID,
    subjectDid: VECTOR_SUBJECT_DID,
    ...overrides
  };
}

/** Un verificationMethod publicado, con la JWK del vector. */
export function vectorVerificationMethod(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: VECTOR_VERIFICATION_METHOD,
    type: 'JsonWebKey',
    controller: VECTOR_ISSUER_DID,
    publicKeyJwk: {
      kty: 'EC',
      crv: 'secp256k1',
      kid: 'assert-1',
      x: VECTOR_JWK_X,
      y: VECTOR_JWK_Y
    },
    ...overrides
  };
}

/** El DID Document que publica S8c3 para este issuer. */
export function vectorDidDocument(overrides: Record<string, unknown> = {}) {
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://www.w3.org/ns/cid/v1'
    ],
    id: VECTOR_ISSUER_DID,
    verificationMethod: [vectorVerificationMethod()],
    assertionMethod: [VECTOR_VERIFICATION_METHOD],
    ...overrides
  };
}
