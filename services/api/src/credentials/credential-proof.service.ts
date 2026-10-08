import { Injectable } from '@nestjs/common';
import {
  type Prisma,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { type Wallet, getAddress, isAddress, toUtf8Bytes } from 'ethers';

import { isDidForIssuerPath } from '../identity/did-web-issuer';
import { IssuerSignerResolver } from '../signing/issuer-signer-resolver';
import { CredentialProofError } from './credential-proof.error';
import {
  assertCanonicalScopeProofValue,
  buildScopeProofV1,
  buildScopeProofV1Envelope,
  buildScopeProofV1VerificationMethod,
  type ScopeProofV1
} from './scope-proof-v1';

/**
 * Construccion del proof de autoria del emisor -- S8c4.
 *
 * Responde UNA sola pregunta:
 *
 *   "este payload canonico exacto fue firmado por la assertion key que este
 *    emisor tiene autorizada AHORA?"
 *
 * NO responde "puede esta persona emitir?". La autoridad de dominio es
 * `IssuerMembership` y se evalua ANTES, en `CredentialsService`. Tener un
 * signer configurado nunca implica membership: son planos distintos.
 *
 * ---------------------------------------------------------------------------
 * LIMITE DE TRANSACCION -- el motivo de que esto tenga DOS metodos
 * ---------------------------------------------------------------------------
 *
 * `IssuerSignerResolver` puede hacer una llamada de red a SSM cuando su cache
 * no tiene la Wallet. Esa latencia NO puede entrar en una transaccion
 * interactiva de Prisma, y menos en la del issuance actual, que en el camino
 * legacy real todavia abarca la escritura on-chain.
 *
 * Por eso la operacion esta partida:
 *
 *   `prepareAssertionSigner`  -- valida el DID y resuelve el signer.
 *                                PUEDE hacer I/O (base + SSM).
 *                                Se llama FUERA de la transaccion.
 *
 *   `createProof`             -- arma el envelope y firma.
 *                                Es computo LOCAL puro: `signMessage` sobre
 *                                una Wallet desconectada no toca la red.
 *                                Se llama DENTRO de la transaccion, sobre la
 *                                fila final, para que lo firmado y lo
 *                                persistido sean el MISMO estado.
 *
 * ---------------------------------------------------------------------------
 * CUSTODIA
 * ---------------------------------------------------------------------------
 *
 * Este servicio consume un signer YA resuelto. No lee secretos, no construye
 * Wallets a partir de material crudo, no conoce `secretRef`, no habla con SSM
 * y no toca AWS. El limite de custodia sigue siendo S8c2.
 */

/**
 * Signer de asercion listo para firmar. Estructura INTERNA: no es un DTO y no
 * puede cruzar un limite HTTP, no se loguea y no se serializa.
 *
 * Igual que la cache de S8c2, `wallet` CONTIENE material de clave en memoria
 * mientras vive el objeto. No se afirma nada sobre borrado ni sobre
 * transitoriedad: simplemente no sale de la capa de emision.
 */
export interface PreparedAssertionSigner {
  /** DID ALMACENADO del emisor, autoridad unica. Nunca recalculado. */
  readonly issuerDid: string;
  /** `<issuerDid>#assert-<keyVersion>`, exacto al que publica S8c3. */
  readonly verificationMethod: string;
  readonly profileId: string;
  readonly keyVersion: number;
  readonly wallet: Wallet;
}

@Injectable()
export class CredentialProofService {
  constructor(private readonly signerResolver: IssuerSignerResolver) {}

  /**
   * Valida la identidad publica del emisor y resuelve su assertion signer.
   *
   * ORDEN DELIBERADO: el contrato de DID de S8c3 se comprueba ANTES de pedir
   * el signer. Un DID ausente o inconsistente con la ruta publica falla
   * cerrado sin haber tocado el almacen de secretos y, por lo tanto, sin haber
   * construido ninguna Wallet.
   *
   * Un proof criptograficamente valido sobre un DID que el resolver publico
   * rechazaria NO es una salida aceptable: la credencial seria inverificable.
   */
  async prepareAssertionSigner(input: {
    issuerId: string;
    issuerDid: string | null | undefined;
    credentialId: string;
  }): Promise<PreparedAssertionSigner> {
    const context = {
      issuerId: input.issuerId,
      credentialId: input.credentialId
    };

    if (typeof input.issuerDid !== 'string' || input.issuerDid.length === 0) {
      throw new CredentialProofError('ISSUER_DID_NOT_CONFIGURED', context);
    }

    // MISMO contrato local que usa el resolver publico de S8c3. No se resuelve
    // el DID por HTTP: la API no consulta su propio endpoint. La cadena de
    // consistencia es local -- S8c2 liga el secreto a la metadata publica,
    // S8c3 publica esa metadata, y aca se referencia el MISMO perfil.
    if (!isDidForIssuerPath(input.issuerDid, input.issuerId)) {
      throw new CredentialProofError('ISSUER_DID_NOT_RESOLVABLE', context);
    }

    // SOLO asercion. La cuenta de anclaje firma transacciones y paga gas; la
    // autoria de la credencial no es asunto suyo y el llamador no puede elegir.
    const signer = await this.signerResolver.resolveAssertionSignerForIssuer(
      input.issuerId
    );

    // Defensivo: S8c2 ya garantiza el proposito, pero una confusion de
    // propositos es un error de seguridad y no se delega.
    if (signer.purpose !== SignerProfilePurpose.assertion) {
      throw new CredentialProofError('SIGNER_PURPOSE_NOT_ASSERTION', {
        ...context,
        profileId: signer.profileId
      });
    }

    const verificationMethod = buildScopeProofV1VerificationMethod(
      input.issuerDid,
      signer.keyVersion,
      { ...context, profileId: signer.profileId }
    );

    return {
      issuerDid: input.issuerDid,
      verificationMethod,
      profileId: signer.profileId,
      keyVersion: signer.keyVersion,
      wallet: signer.wallet
    };
  }

  /**
   * Firma el envelope de `scope-proof-v1` para un `canonicalHash` canon_v2.
   *
   * Computo LOCAL: `signMessage` sobre una Wallet sin provider no hace I/O.
   *
   * Se firman los BYTES UTF-8 del envelope, nunca el texto suelto ni el hash.
   * Firmar `canonicalHash` directamente -- o sus bytes crudos -- produciria una
   * firma sin separacion de dominio: la misma firma valdria para cualquier otro
   * contexto que reusara ese digest.
   */
  async createProof(
    signer: PreparedAssertionSigner,
    canonicalHash: string,
    credentialId: string
  ): Promise<ScopeProofV1> {
    const context = {
      credentialId,
      profileId: signer.profileId
    };

    const envelopeText = buildScopeProofV1Envelope(
      {
        verificationMethod: signer.verificationMethod,
        canonicalHash
      },
      context
    );

    const envelopeBytes = toUtf8Bytes(envelopeText);

    const proofValue = await signer.wallet.signMessage(envelopeBytes);

    // Forma de la firma producida, no autenticidad: 65 bytes, v en {27,28} y
    // `s` canonica. La verificacion del proof es S8c7.
    assertCanonicalScopeProofValue(proofValue, context);

    return buildScopeProofV1(
      {
        verificationMethod: signer.verificationMethod,
        proofValue
      },
      context
    );
  }

  /**
   * REVALIDACION DEL BINDING DE ASERCION dentro de la transaccion de emision
   * -- S8c8.
   *
   * ---------------------------------------------------------------------------
   * POR QUE NO ALCANZA RESOLVER ANTES
   * ---------------------------------------------------------------------------
   *
   * Desde que existe la rotacion, resolver el signer antes de abrir la
   * transaccion dejo de ser suficiente. Si una rotacion P1 -> P2 commitea
   * mientras esta emision esta en vuelo, firmar con P1 produciria una
   * credential cuya autoridad de firma ya es historica -- verificable, si, pero
   * emitida por una clave que el emisor ya habia dejado de elegir.
   *
   * `IssuerTechnicalIdentity.assertionSignerProfileId` es la autoridad para
   * firmar NUEVO. Asi que antes de que la credential quede `issued` se vuelve a
   * leer, y si cambio se aborta: ni proof persistido, ni intent de blockchain.
   *
   * La direccion contraria es legitima: si la emision commitea primero, esa
   * credential pertenece de verdad a la era de P1, y la rotacion posterior
   * procede sin tocarla.
   *
   * ---------------------------------------------------------------------------
   * SOLO METADATA PUBLICA
   * ---------------------------------------------------------------------------
   *
   * Sin SSM, sin `SignerSecretStore`, sin volver a llamar al resolver y sin
   * leer ninguna clave privada: la Wallet ya esta en memoria desde antes de la
   * transaccion. Esto es una comprobacion de CONFIGURACION, no de posesion.
   *
   * Y NO se acepta una clave historica retirada para una emision nueva:
   * publicar una clave para verificar lo que firmo no es lo mismo que
   * autorizarla a firmar algo mas.
   */
  async revalidateAssertionBinding(
    transaction: Prisma.TransactionClient,
    input: { issuerId: string; signer: PreparedAssertionSigner }
  ): Promise<void> {
    const context = { profileId: input.signer.profileId };

    const identity = await transaction.issuerTechnicalIdentity.findUnique({
      where: { issuerId: input.issuerId },
      select: {
        did: true,
        assertionSignerProfileId: true,
        assertionSignerProfile: {
          select: {
            id: true,
            purpose: true,
            status: true,
            address: true,
            keyVersion: true,
            addressVerifiedAt: true
          }
        }
      }
    });

    const profile = identity?.assertionSignerProfile;

    if (
      !identity ||
      !profile ||
      // El PUNTERO VIGENTE tiene que seguir siendo exactamente el perfil que se
      // resolvio. Una rotacion concurrente lo mueve, y eso es lo que se detecta.
      identity.assertionSignerProfileId !== input.signer.profileId ||
      profile.id !== input.signer.profileId ||
      identity.did !== input.signer.issuerDid ||
      profile.purpose !== SignerProfilePurpose.assertion ||
      profile.status !== SignerProfileStatus.active ||
      profile.addressVerifiedAt === null ||
      profile.keyVersion !== input.signer.keyVersion ||
      !addressEquals(profile.address, input.signer.wallet.address)
    ) {
      throw new CredentialProofError('ASSERTION_BINDING_CHANGED', context);
    }
  }
}

/** Comparacion de direcciones con checksum. Null nunca coincide con nada. */
function addressEquals(left: string | null, right: string): boolean {
  if (typeof left !== 'string' || !isAddress(left) || !isAddress(right)) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}
