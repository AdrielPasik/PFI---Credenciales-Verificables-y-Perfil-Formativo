import { SigningKey } from 'ethers';

import {
  type IssuerDidDocumentResponseDto,
  type IssuerDidVerificationMethodDto,
  type IssuerPublicKeyJwkDto
} from './dto/issuer-did-document-response.dto';

/**
 * Constructor PURO del DID Document del issuer -- S8c3.
 *
 * Sin base de datos, sin red, sin secretos. Entra material PUBLICO persistido y
 * sale el documento congelado en S8b.1.
 *
 * Lo unico que usa de `ethers` son utilidades de clave PUBLICA: comprime un
 * punto para comprobar que las coordenadas persistidas son consistentes entre
 * si y estan realmente sobre la curva. No construye ninguna `Wallet`, no toca
 * ninguna clave privada, no lee el secret store y no hace I/O.
 */

/** Contratos de S8c1: hex `0x`-prefijado en MINUSCULA. */
const COORDINATE_PATTERN = /^0x[0-9a-f]{64}$/;
const COMPRESSED_PATTERN = /^0x0[23][0-9a-f]{64}$/;

const DID_CONTEXTS = [
  'https://www.w3.org/ns/did/v1',
  'https://www.w3.org/ns/cid/v1'
] as const;

/** Error de datos persistidos inconsistentes. Nunca lleva valores de la base. */
export class IssuerDidDocumentError extends Error {
  constructor(readonly code: IssuerDidDocumentErrorCode) {
    super('La identidad tecnica del issuer tiene configuracion inconsistente.');
    this.name = 'IssuerDidDocumentError';
  }
}

export type IssuerDidDocumentErrorCode =
  | 'INVALID_KEY_VERSION'
  | 'MALFORMED_PUBLIC_COORDINATE'
  | 'MALFORMED_COMPRESSED_PUBLIC_KEY'
  | 'PUBLIC_KEY_NOT_ON_CURVE'
  | 'COMPRESSED_PUBLIC_KEY_MISMATCH';

/**
 * Una clave de asercion publicable.
 *
 * S8c3 pasa COMO MAXIMO una -- no hay tabla de historia todavia -- pero la
 * entrada es una lista a proposito, para que S8c8 pueda publicar `#assert-1` y
 * `#assert-2` simultaneamente sin rediseñar nada.
 */
export interface IssuerAssertionKeyInput {
  readonly keyVersion: number;
  readonly publicKeyX: string | null;
  readonly publicKeyY: string | null;
  readonly publicKeyCompressed: string | null;
}

export interface BuildIssuerDidDocumentInput {
  /** El DID ALMACENADO. Nunca se recalcula desde la configuracion actual. */
  readonly did: string;
  readonly assertionKeys: readonly IssuerAssertionKeyInput[];
}

export function buildIssuerDidDocument(
  input: BuildIssuerDidDocumentInput
): IssuerDidDocumentResponseDto {
  const verificationMethod = input.assertionKeys.map((key) =>
    buildVerificationMethod(input.did, key)
  );

  // Sin claves publicables el DID SIGUE resolviendo, pero las propiedades se
  // OMITEN en vez de emitirse vacias.
  if (verificationMethod.length === 0) {
    return {
      '@context': DID_CONTEXTS,
      id: input.did
    };
  }

  return {
    '@context': DID_CONTEXTS,
    id: input.did,
    verificationMethod,
    // Referencia por id, no un segundo objeto embebido: una sola fuente de
    // material publico en el documento.
    assertionMethod: verificationMethod.map((method) => method.id)
  };
}

function buildVerificationMethod(
  did: string,
  key: IssuerAssertionKeyInput
): IssuerDidVerificationMethodDto {
  const fragment = `assert-${assertPositiveIntegerKeyVersion(key.keyVersion)}`;

  return {
    // Exacto: el DID almacenado tal cual, sin normalizar, sin bajar a
    // minusculas y sin recodificar.
    id: `${did}#${fragment}`,
    type: 'JsonWebKey',
    controller: did,
    publicKeyJwk: buildPublicKeyJwk(fragment, key)
  };
}

function assertPositiveIntegerKeyVersion(keyVersion: number): number {
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new IssuerDidDocumentError('INVALID_KEY_VERSION');
  }

  return keyVersion;
}

function buildPublicKeyJwk(
  fragment: string,
  key: IssuerAssertionKeyInput
): IssuerPublicKeyJwkDto {
  const x = assertCoordinate(key.publicKeyX);
  const y = assertCoordinate(key.publicKeyY);
  const compressed = assertCompressed(key.publicKeyCompressed);

  // Consistencia del material publico, con utilidades de clave publica
  // unicamente. `computePublicKey` falla si el par (x, y) no esta sobre
  // secp256k1, y comprimirlo permite comparar contra lo persistido.
  let derivedCompressed: string;
  try {
    derivedCompressed = SigningKey.computePublicKey(`0x04${x}${y}`, true);
  } catch {
    // El mensaje de ethers se descarta por completo.
    throw new IssuerDidDocumentError('PUBLIC_KEY_NOT_ON_CURVE');
  }

  if (derivedCompressed !== compressed) {
    throw new IssuerDidDocumentError('COMPRESSED_PUBLIC_KEY_MISMATCH');
  }

  return {
    kty: 'EC',
    crv: 'secp256k1',
    kid: fragment,
    // Se DECODIFICA el hex primero: lo que se codifica en base64url son los 32
    // bytes de la coordenada, nunca los caracteres del texto "0x....".
    x: hexToBase64Url(x),
    y: hexToBase64Url(y)
  };
}

function assertCoordinate(value: string | null): string {
  if (value === null || !COORDINATE_PATTERN.test(value)) {
    throw new IssuerDidDocumentError('MALFORMED_PUBLIC_COORDINATE');
  }

  return value.slice(2);
}

function assertCompressed(value: string | null): string {
  if (value === null || !COMPRESSED_PATTERN.test(value)) {
    throw new IssuerDidDocumentError('MALFORMED_COMPRESSED_PUBLIC_KEY');
  }

  return value;
}

/** 32 bytes -> base64url SIN padding. */
function hexToBase64Url(hexWithoutPrefix: string): string {
  const bytes = Buffer.from(hexWithoutPrefix, 'hex');

  if (bytes.length !== 32) {
    throw new IssuerDidDocumentError('MALFORMED_PUBLIC_COORDINATE');
  }

  return bytes.toString('base64url');
}
