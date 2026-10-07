// S8c3: DID Document del ISSUER. Plano distinto del de holders: el documento
// de un User sigue siendo id-only (ver did-document-response.dto.ts) y NO gana
// claves por esto.
//
// Representacion congelada en S8b.1. El modelo de datos es W3C DID Core
// (Recommendation) y el tipo de verification method `JsonWebKey` con
// `publicKeyJwk` viene del modelo de Controlled Identifiers; `did:web` define
// como el DID mapea a la ubicacion HTTPS del did.json. Nada de esto convierte a
// Scope en W3C Verifiable Credentials, y `did:web` NO es una Recommendation del
// W3C: es un borrador del Credentials Community Group.
//
// Se sirve como JSON; no hay procesador JSON-LD, ni expansion, ni URDNA2015.

/**
 * JWK publica de una clave de asercion secp256k1.
 *
 * EXACTAMENTE cinco claves. Deliberadamente AUSENTES:
 *
 *   `alg`  -- RFC 8812 obliga a que, si esta, valga `ES256K`, que es JOSE/JWS
 *             ECDSA-secp256k1-SHA256. El proof de Scope es `scope-proof-v1`
 *             (EIP-191 + keccak256), asi que declarar `alg` lo etiquetaria mal.
 *             La JWK publica una CLAVE, no el formato de firma.
 *   `use`  -- la relacion `assertionMethod` ya expresa el proposito.
 *   `d`    -- y ningun otro miembro de la clase de informacion privada. DID
 *             Core lo prohibe explicitamente.
 *
 * Tampoco `blockchainAccountId` ni `publicKeyMultibase`: la clave de asercion
 * es una clave de autenticidad OFF-CHAIN, y DID Core prohibe que un
 * verification method lleve dos propiedades de material para la misma clave.
 */
export interface IssuerPublicKeyJwkDto {
  readonly kty: 'EC';
  readonly crv: 'secp256k1';
  /** Igual al fragmento del verification method: `assert-<keyVersion>`. */
  readonly kid: string;
  /** Coordenada X, 32 bytes en base64url SIN padding. */
  readonly x: string;
  /** Coordenada Y, 32 bytes en base64url SIN padding. */
  readonly y: string;
}

export interface IssuerDidVerificationMethodDto {
  /** `<issuerDid>#assert-<keyVersion>`, exacto. */
  readonly id: string;
  readonly type: 'JsonWebKey';
  /** El DID del issuer, nunca Issuer.id ni una address. */
  readonly controller: string;
  readonly publicKeyJwk: IssuerPublicKeyJwkDto;
}

/**
 * `verificationMethod` y `assertionMethod` son OPCIONALES, y eso es honesto:
 * cuando la unica clave de asercion vinculada esta comprometida, el DID SIGUE
 * resolviendo pero no publica esa clave.
 *
 * En ese caso las propiedades se OMITEN. No se emiten como arrays vacios:
 * DID Core dice que, si estan presentes, su valor debe ser un conjunto de UNA
 * O MAS verification methods.
 *
 * Semantica buscada: el DID resuelve y el `#assert-N` referenciado no esta ->
 * un verificador concluye VERIFICATION_METHOD_NOT_FOUND -> INVALID; en lugar
 * de un 404 -> DID_DOCUMENT_UNAVAILABLE -> INDETERMINATE. Es la semantica de
 * clave comprometida congelada en S8b.1.
 */
export interface IssuerDidDocumentResponseDto {
  readonly '@context': readonly [
    'https://www.w3.org/ns/did/v1',
    'https://www.w3.org/ns/cid/v1'
  ];
  readonly id: string;
  readonly verificationMethod?: readonly IssuerDidVerificationMethodDto[];
  readonly assertionMethod?: readonly string[];
}
