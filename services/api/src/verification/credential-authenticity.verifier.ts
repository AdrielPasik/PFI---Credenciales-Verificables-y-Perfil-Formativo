import { Injectable } from '@nestjs/common';
import { computeAddress, getAddress, toUtf8Bytes, verifyMessage } from 'ethers';

import {
  CredentialHashingService,
  type CanonicalizationVersion
} from '../credentials/credential-hashing.service';
import {
  SCOPE_PROOF_V1_CANONICALIZATION_VERSION,
  SCOPE_PROOF_V1_CRYPTOSUITE,
  SCOPE_PROOF_V1_HASH_ALGORITHM,
  SCOPE_PROOF_V1_PROFILE,
  SCOPE_PROOF_V1_PROOF_PURPOSE,
  SCOPE_PROOF_V1_TYPE,
  assertCanonicalScopeProofValue,
  buildScopeProofV1Envelope
} from '../credentials/scope-proof-v1';
import { IssuerDidDocumentResolver } from '../identity/issuer-did-document.resolver';
import {
  type CredentialAuthenticity,
  type CredentialAuthenticityReason
} from './verification-outcome';

/**
 * Verificador de AUTENTICIDAD de credenciales -- S8c7.
 *
 * ---------------------------------------------------------------------------
 * QUE RESPONDE Y QUE NO
 * ---------------------------------------------------------------------------
 *
 * Responde UNA pregunta: firmo una clave de asercion AUTORIZADA POR EL DID
 * publico del issuer exactamente este payload canonico?
 *
 * No consulta la blockchain, no conoce el ciclo de revocacion, no escribe en
 * la base y no toca el almacen de secretos. Un resultado de cadena no puede
 * cambiar lo que este componente decide, y este componente no puede cambiar la
 * evidencia de cadena.
 *
 * ---------------------------------------------------------------------------
 * SE VERIFICA CONTRA EL DID DOCUMENT, NO CONTRA SignerProfile
 * ---------------------------------------------------------------------------
 *
 * La direccion esperada se DERIVA de la JsonWebKey que el DID Document
 * publica, no de `SignerProfile.address`.
 *
 * S8c2 prueba que el secreto corresponde a su metadata. S8c3 PUBLICA que
 * clave esta autorizada. S8c7 tiene que verificar contra lo que el DID
 * autoriza publicamente, porque es justamente eso lo que cambia cuando una
 * clave se marca comprometida: S8c3 deja el DID resolviendo y OMITE la clave.
 * Leer `SignerProfile.address` esquivaria por completo ese mecanismo de
 * revocacion de clave.
 *
 * ---------------------------------------------------------------------------
 * SE RECALCULA EL HASH -- NO SE CONFIA EN EL ALMACENADO
 * ---------------------------------------------------------------------------
 *
 * Verificar la firma sobre el `canonicalHash` PERSISTIDO no detectaria que el
 * contenido de la credencial derivo respecto de su hash. Asi que el payload
 * canonico se reconstruye desde el estado autoritativo y el hash se recalcula
 * con la implementacion UNICA de canon_v2. El valor recalculado es el que se
 * compara y el que entra en el envelope: se computa UNA sola vez.
 *
 * ---------------------------------------------------------------------------
 * SOLO LECTURA Y SOLO CLAVE PUBLICA
 * ---------------------------------------------------------------------------
 *
 * Sin Prisma propio -- la unica consulta la hace el resolver de DID inyectado
 * --, sin `IssuerSignerResolver`, sin SSM, sin `Wallet`, sin clave privada y
 * sin HTTP contra el propio endpoint de DID de esta API.
 */

export const CREDENTIAL_SCHEMA_VERSION_V1 = 'credential_v1';
export const CREDENTIAL_SCHEMA_VERSION_V2 = 'credential_v2';

/** Las OCHO claves exactas del proof, sin una mas y sin una menos. */
const SCOPE_PROOF_V1_KEYS = [
  'type',
  'profile',
  'cryptosuite',
  'proofPurpose',
  'verificationMethod',
  'canonicalizationVersion',
  'hashAlgorithm',
  'proofValue'
] as const;

/** Constantes del profile. Un valor distinto es violacion de contrato. */
const SCOPE_PROOF_V1_CONSTANTS: Record<string, string> = {
  type: SCOPE_PROOF_V1_TYPE,
  profile: SCOPE_PROOF_V1_PROFILE,
  cryptosuite: SCOPE_PROOF_V1_CRYPTOSUITE,
  proofPurpose: SCOPE_PROOF_V1_PROOF_PURPOSE,
  canonicalizationVersion: SCOPE_PROOF_V1_CANONICALIZATION_VERSION,
  hashAlgorithm: SCOPE_PROOF_V1_HASH_ALGORITHM
};

/** `<did>#assert-<N>`, con N entero positivo sin ceros a la izquierda. */
const VERIFICATION_METHOD_PATTERN = /^(did:web:[^#\s]+)#assert-([1-9][0-9]*)$/;

/** base64url SIN padding de 32 bytes: 43 caracteres del alfabeto url-safe. */
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Estado AUTORITATIVO persistido con el que se reconstruye canon_v2. */
export interface CredentialAuthenticityInput {
  readonly credentialId: string;
  readonly schemaVersion: string;
  readonly canonicalizationVersion: string | null;
  readonly canonicalHash: string | null;
  readonly proof: unknown;
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  readonly issuedAt: Date | null;
  readonly hours: { toFixed?: (digits?: number) => string; toString: () => string } | null;
  readonly credentialSubject: unknown;
  /** `IssuerTechnicalIdentity.did`. NUNCA el `Issuer.did` legacy. */
  readonly issuerId: string;
  readonly issuerTechnicalDid: string | null;
  /** `User.did` PERSISTIDO. Nunca se crea uno al verificar. */
  readonly subjectDid: string | null;
}

export interface CredentialAuthenticityResult {
  readonly authenticity: CredentialAuthenticity;
  readonly reason: CredentialAuthenticityReason;
  /**
   * Hash canonico RECALCULADO, disponible solo cuando reprodujo el persistido.
   * Es el unico valor que la evidencia de cadena debe buscar.
   */
  readonly recomputedCanonicalHash: string | null;
  /** `verificationMethod` del proof, cuando resulto bien formado. */
  readonly verificationMethod: string | null;
}

@Injectable()
export class CredentialAuthenticityVerifier {
  constructor(
    private readonly hashingService: CredentialHashingService,
    private readonly didResolver: IssuerDidDocumentResolver
  ) {}

  async verify(
    input: CredentialAuthenticityInput
  ): Promise<CredentialAuthenticityResult> {
    // -----------------------------------------------------------------------
    // DESPACHO POR VERSION DECLARADA -- addendum A
    // -----------------------------------------------------------------------
    //
    // La version DECLARADA gobierna la interpretacion. Que exista un JSON en
    // la columna `proof` no convierte una credential_v1 en v2: eso seria
    // deducir el protocolo de la presencia de un dato, que es exactamente como
    // se construyen las confusiones de version.
    if (input.schemaVersion === CREDENTIAL_SCHEMA_VERSION_V1) {
      return indeterminate('LEGACY_UNSIGNED_CREDENTIAL');
    }

    if (input.schemaVersion !== CREDENTIAL_SCHEMA_VERSION_V2) {
      // Un protocolo futuro que este verificador no entiende no es una
      // credencial invalida: es evidencia que no se puede evaluar.
      return indeterminate('UNSUPPORTED_CREDENTIAL_VERSION');
    }

    // Declarada v2 -> tiene que cumplir el contrato v2 COMPLETO. Un
    // `canon_v1` aca no es "fallback legacy": es una v2 incoherente.
    if (
      input.canonicalizationVersion !== SCOPE_PROOF_V1_CANONICALIZATION_VERSION
    ) {
      return invalid('CANONICALIZATION_VERSION_INCONSISTENT');
    }

    // -----------------------------------------------------------------------
    // CONTRATO DEL OBJETO proof
    // -----------------------------------------------------------------------
    const proof = parseScopeProofV1(input.proof);
    if (proof.kind === 'missing') {
      return invalid('PROOF_MISSING');
    }
    if (proof.kind === 'malformed') {
      return invalid('PROOF_CONTRACT_VIOLATION');
    }

    // Forma de la firma ANTES de cualquier operacion criptografica: una `s`
    // alta, una `v` fuera de {27,28} o un largo incorrecto se rechazan aca y
    // nunca llegan a `verifyMessage`, que lanzaria con un mensaje crudo.
    try {
      assertCanonicalScopeProofValue(proof.proof.proofValue);
    } catch {
      return invalid('PROOF_VALUE_NOT_CANONICAL');
    }

    // -----------------------------------------------------------------------
    // RECALCULO DE canon_v2 -- UNA SOLA VEZ
    // -----------------------------------------------------------------------
    const recomputed = this.recomputeCanonicalHash(input);
    if (recomputed === null) {
      // No se puede reconstruir el payload canonico desde el estado
      // persistido: el artefacto declarado v2 no reproduce. Es un defecto del
      // artefacto, no una indisponibilidad de infraestructura.
      return invalid('CANONICAL_PAYLOAD_UNREPRODUCIBLE');
    }

    if (
      typeof input.canonicalHash !== 'string' ||
      recomputed !== input.canonicalHash.toLowerCase()
    ) {
      // CORTOCIRCUITO DELIBERADO: con el hash en contradiccion no se resuelve
      // el DID ni se verifica la firma. Ya hay evidencia positiva de deriva
      // entre contenido y hash, y ningun estado de cadena puede rescatarla.
      return invalid('CANONICAL_HASH_MISMATCH');
    }

    // -----------------------------------------------------------------------
    // verificationMethod: FORMA Y PERTENENCIA
    // -----------------------------------------------------------------------
    const parsedMethod = VERIFICATION_METHOD_PATTERN.exec(
      proof.proof.verificationMethod
    );
    if (!parsedMethod) {
      return invalid('VERIFICATION_METHOD_MALFORMED', recomputed);
    }

    const [verificationMethod, methodBaseDid, keyVersion] = parsedMethod;
    const issuerDid = input.issuerTechnicalDid;

    if (typeof issuerDid !== 'string' || issuerDid.length === 0) {
      // Credencial declarada v2 sin DID tecnico persistido: el payload
      // canonico exige `issuer_did`, asi que no reproduce.
      return invalid('CANONICAL_PAYLOAD_UNREPRODUCIBLE');
    }

    // Comparacion EXACTA, byte a byte. No se normaliza, no se baja a
    // minusculas y no se recodifica: dos DID que solo coinciden despues de
    // normalizar son dos identidades distintas.
    if (methodBaseDid !== issuerDid) {
      return invalid('VERIFICATION_METHOD_FOREIGN_DID', recomputed);
    }

    // -----------------------------------------------------------------------
    // RESOLUCION LOCAL DEL DID DOCUMENT
    // -----------------------------------------------------------------------
    const document = await this.resolveIssuerDidDocument(input.issuerId);
    if (document.kind === 'unavailable') {
      return indeterminate(
        'ISSUER_DID_NOT_RESOLVABLE',
        recomputed,
        verificationMethod
      );
    }
    if (document.kind === 'unusable') {
      return indeterminate(
        'ISSUER_DID_DOCUMENT_UNUSABLE',
        recomputed,
        verificationMethod
      );
    }

    // El documento puede publicar varias claves -- el builder de S8c3 ya
    // acepta una lista para S8c8. Se selecciona la que el proof REFIERE, por
    // id exacto: nunca la primera, nunca la ultima, nunca la de keyVersion mas
    // alta. Preguntar "es la clave vigente del issuer?" seria la pregunta
    // equivocada; la correcta es "autoriza el DID esta clave?".
    const method = (document.document.verificationMethod ?? []).find(
      (candidate) => candidate.id === verificationMethod
    );

    if (!method) {
      // El DID resuelve BIEN y no publica la clave referida. Es evidencia
      // NEGATIVA, no falta de evidencia: asi se ve una clave comprometida que
      // S8c3 dejo de publicar.
      return invalid('ASSERTION_KEY_NOT_PUBLISHED', recomputed, verificationMethod);
    }

    // Presencia != autorizacion. Un verificationMethod puede existir en el
    // documento para otro proposito.
    if (!(document.document.assertionMethod ?? []).includes(verificationMethod)) {
      return invalid('ASSERTION_KEY_NOT_AUTHORIZED', recomputed, verificationMethod);
    }

    // -----------------------------------------------------------------------
    // JWK -> DIRECCION ESPERADA
    // -----------------------------------------------------------------------
    const expectedAddress = deriveAddressFromVerificationMethod({
      method,
      issuerDid,
      keyVersion
    });

    if (expectedAddress === null) {
      // El documento resolvio pero su material publico es inutilizable. Eso
      // es infraestructura/configuracion roto, no un defecto de la credencial:
      // no se la declara invalida por eso.
      return indeterminate(
        'ASSERTION_KEY_MATERIAL_UNUSABLE',
        recomputed,
        verificationMethod
      );
    }

    // -----------------------------------------------------------------------
    // EIP-191 SOBRE EL ENVELOPE EXACTO
    // -----------------------------------------------------------------------
    //
    // El envelope lo arma `buildScopeProofV1Envelope` de S8c4 -- no hay una
    // segunda implementacion de esas seis lineas -- con el hash RECALCULADO y
    // el `verificationMethod` exacto del proof.
    let recoveredAddress: string;
    try {
      const envelope = buildScopeProofV1Envelope({
        verificationMethod,
        canonicalHash: recomputed
      });

      recoveredAddress = verifyMessage(
        toUtf8Bytes(envelope),
        proof.proof.proofValue
      );
    } catch {
      // La forma del proofValue ya se valido arriba, asi que llegar aca es un
      // material irrecuperable. El error crudo de ethers se descarta.
      return invalid('SIGNATURE_MISMATCH', recomputed, verificationMethod);
    }

    if (getAddress(recoveredAddress) !== expectedAddress) {
      return invalid('SIGNATURE_MISMATCH', recomputed, verificationMethod);
    }

    return {
      authenticity: 'VERIFIED',
      reason: 'PROOF_VERIFIED',
      recomputedCanonicalHash: recomputed,
      verificationMethod
    };
  }

  /**
   * Recalcula canon_v2 desde el estado autoritativo persistido.
   *
   * Usa la implementacion UNICA de `CredentialHashingService`: no hay un
   * segundo canonicalizador en el codigo de verificacion.
   *
   * `null` significa "el payload canonico no se puede reconstruir". El servicio
   * de hashing lanza `BadRequestException` cuando falta un campo requerido;
   * aca eso NO puede convertirse en un 400 de la ruta publica, porque el
   * problema es el artefacto almacenado y no la solicitud del verificador.
   */
  private recomputeCanonicalHash(
    input: CredentialAuthenticityInput
  ): string | null {
    if (
      typeof input.issuerTechnicalDid !== 'string' ||
      typeof input.subjectDid !== 'string' ||
      !(input.issuedAt instanceof Date) ||
      !isJsonObject(input.credentialSubject)
    ) {
      return null;
    }

    try {
      const result = this.hashingService.createCanonicalHashForVersion(
        {
          credentialId: input.credentialId,
          schemaVersion: input.schemaVersion,
          type: input.type,
          issuerDid: input.issuerTechnicalDid,
          subjectDid: input.subjectDid,
          title: input.title,
          description: input.description,
          issuedAt: input.issuedAt,
          hours: input.hours,
          credentialSubject: input.credentialSubject
        },
        CredentialHashingService.CANONICALIZATION_VERSION_V2 as CanonicalizationVersion
      );

      return result.canonicalHash;
    } catch {
      return null;
    }
  }

  /**
   * Obtiene el DID Document por el resolver LOCAL -- la misma implementacion
   * que publica `GET /did/issuers/:issuerId/did.json`.
   *
   * Nunca por HTTP contra esta propia API: seria una llamada de red a si misma
   * y agregaria un modo de fallo ajeno a la credencial verificada.
   */
  private async resolveIssuerDidDocument(issuerId: string): Promise<
    | {
        kind: 'resolved';
        document: {
          verificationMethod?: readonly IssuerDidVerificationMethodLike[];
          assertionMethod?: readonly string[];
        };
      }
    | { kind: 'unavailable' }
    | { kind: 'unusable' }
  > {
    let resolution: Awaited<
      ReturnType<IssuerDidDocumentResolver['resolveForIssuer']>
    >;

    try {
      resolution = await this.didResolver.resolveForIssuer(issuerId);
    } catch {
      // Fallo de infraestructura al resolver. No se afirma nada sobre la
      // credencial y el error crudo no sale.
      return { kind: 'unavailable' };
    }

    if (resolution.kind === 'not_resolvable') {
      return { kind: 'unavailable' };
    }

    if (resolution.kind === 'inconsistent_configuration') {
      // El documento existe conceptualmente pero no se pudo construir: es
      // evidencia INUTILIZABLE, no evidencia negativa.
      return { kind: 'unusable' };
    }

    return { kind: 'resolved', document: resolution.document };
  }
}

interface IssuerDidVerificationMethodLike {
  readonly id: string;
  readonly type?: string;
  readonly controller?: string;
  readonly publicKeyJwk?: unknown;
}

// ---------------------------------------------------------------------------
// CONTRATO DEL proof
// ---------------------------------------------------------------------------

type ParsedProof =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | {
      kind: 'proof';
      proof: { verificationMethod: string; proofValue: string };
    };

/**
 * Valida el objeto `proof` contra el contrato EXACTO de scope-proof-v1.
 *
 * Las ocho claves, ni una mas ni una menos, con las seis constantes del profile
 * en su valor exacto. `created`, `canonicalHash`, `jws`, `alg`,
 * `issuerAddress`, `txHash` o cualquier metadata de anclaje hacen fallar el
 * contrato: un proof con campos extra no es un scope-proof-v1, y aceptarlo
 * "porque los que importan estan" abriria la puerta a firmar una cosa y
 * presentar otra.
 */
function parseScopeProofV1(value: unknown): ParsedProof {
  if (value === null || value === undefined) {
    return { kind: 'missing' };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'malformed' };
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();

  if (keys.length !== SCOPE_PROOF_V1_KEYS.length) {
    return { kind: 'malformed' };
  }

  const expectedKeys = [...SCOPE_PROOF_V1_KEYS].sort();
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (keys[index] !== expectedKeys[index]) {
      return { kind: 'malformed' };
    }
  }

  for (const [key, expected] of Object.entries(SCOPE_PROOF_V1_CONSTANTS)) {
    if (candidate[key] !== expected) {
      return { kind: 'malformed' };
    }
  }

  const verificationMethod = candidate.verificationMethod;
  const proofValue = candidate.proofValue;

  if (typeof verificationMethod !== 'string' || typeof proofValue !== 'string') {
    return { kind: 'malformed' };
  }

  return { kind: 'proof', proof: { verificationMethod, proofValue } };
}

// ---------------------------------------------------------------------------
// JWK -> DIRECCION
// ---------------------------------------------------------------------------

/**
 * Deriva la direccion esperada desde la JsonWebKey publicada.
 *
 * Exige el contrato completo de S8c3/S8b.1:
 *
 *   type        JsonWebKey
 *   controller  el DID del issuer, exacto
 *   kty         EC
 *   crv         secp256k1
 *   kid         el fragmento sin '#'
 *   x, y        base64url SIN padding, 32 bytes cada una
 *   sin `d`     nunca material privado en un documento publico
 *
 * Y despues el algoritmo congelado:
 *
 *   0x04 || X || Y  ->  keccak256  ->  ultimos 20 bytes  ->  EIP-55
 *
 * `computeAddress` de ethers es exactamente eso, y falla si (x, y) no esta
 * sobre secp256k1 -- asi que una clave fuera de la curva devuelve `null` en vez
 * de una direccion inventada.
 *
 * `null` = material inutilizable. Deliberadamente NO distingue los motivos
 * hacia afuera: el consumidor lo traduce a INDETERMINATE, porque un documento
 * publico roto no es un defecto de la credencial.
 */
function deriveAddressFromVerificationMethod(input: {
  method: IssuerDidVerificationMethodLike;
  issuerDid: string;
  keyVersion: string;
}): string | null {
  const { method, issuerDid, keyVersion } = input;

  if (method.type !== 'JsonWebKey' || method.controller !== issuerDid) {
    return null;
  }

  if (!isJsonObject(method.publicKeyJwk)) {
    return null;
  }

  const jwk = method.publicKeyJwk as Record<string, unknown>;

  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1') {
    return null;
  }

  if (jwk.kid !== `assert-${keyVersion}`) {
    return null;
  }

  // Nunca se acepta material privado en un documento publico.
  if ('d' in jwk) {
    return null;
  }

  const x = decodeBase64Url32(jwk.x);
  const y = decodeBase64Url32(jwk.y);

  if (!x || !y) {
    return null;
  }

  try {
    return getAddress(computeAddress(`0x04${x}${y}`));
  } catch {
    // (x, y) no esta sobre la curva. El mensaje de ethers se descarta.
    return null;
  }
}

/**
 * Decodifica una coordenada base64url SIN padding a 32 bytes de hex.
 *
 * Se re-codifica y se compara para rechazar representaciones no canonicas: con
 * `Buffer.from(..., 'base64url')` una cadena con padding, con caracteres del
 * alfabeto estandar (`+`, `/`) o con bits de relleno distintos de cero
 * decodificaria igual, y entonces dos textos distintos describirian la misma
 * clave.
 */
function decodeBase64Url32(value: unknown): string | null {
  if (typeof value !== 'string' || !BASE64URL_32_BYTES_PATTERN.test(value)) {
    return null;
  }

  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) {
    return null;
  }

  return bytes.toString('hex');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

// ---------------------------------------------------------------------------
// CONSTRUCTORES DE RESULTADO
// ---------------------------------------------------------------------------

function invalid(
  reason: CredentialAuthenticityReason,
  recomputedCanonicalHash: string | null = null,
  verificationMethod: string | null = null
): CredentialAuthenticityResult {
  return {
    authenticity: 'INVALID',
    reason,
    recomputedCanonicalHash,
    verificationMethod
  };
}

function indeterminate(
  reason: CredentialAuthenticityReason,
  recomputedCanonicalHash: string | null = null,
  verificationMethod: string | null = null
): CredentialAuthenticityResult {
  return {
    authenticity: 'INDETERMINATE',
    reason,
    recomputedCanonicalHash,
    verificationMethod
  };
}
