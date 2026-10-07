import { Injectable } from '@nestjs/common';
import { SignerProfilePurpose } from '@prisma/client';
import { type Wallet, toUtf8Bytes } from 'ethers';

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
}
