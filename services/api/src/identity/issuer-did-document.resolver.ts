import { Injectable } from '@nestjs/common';
import { SignerProfilePurpose, SignerProfileStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { isDidForIssuerPath } from './did-web-issuer';
import { type IssuerDidDocumentResponseDto } from './dto/issuer-did-document-response.dto';
import {
  buildIssuerDidDocument,
  IssuerDidDocumentError,
  type IssuerAssertionKeyInput
} from './issuer-did-document.builder';

/**
 * Resolucion LOCAL del DID Document del issuer -- extraido en S8c7.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE
 * ---------------------------------------------------------------------------
 *
 * Hasta S8c6 esta logica vivia dentro de `IssuerDidController`. S8c7 necesita
 * el MISMO documento para verificar autenticidad, y la unica forma honesta de
 * garantizar que el verificador y el endpoint publico coincidan es que ambos
 * usen UNA implementacion.
 *
 * La alternativa -- que la API le haga un GET por HTTP a su propio
 * `/did/issuers/:issuerId/did.json` -- esta descartada a proposito: seria una
 * llamada de red a si misma, dependeria del DNS y del balanceador para
 * responder una consulta puramente local, y agregaria un modo de fallo que no
 * tiene nada que ver con la credential que se esta verificando.
 *
 * ---------------------------------------------------------------------------
 * SIN SECRETOS
 * ---------------------------------------------------------------------------
 *
 * Igual que el controller del que sale: solo metadata PUBLICA persistida. No
 * importa `IssuerSignerResolver`, `SignerSecretStore`, `SSMClient`, `secretRef`
 * ni `Wallet`, y un guard estructural lo congela.
 *
 * ---------------------------------------------------------------------------
 * RESULTADO TIPADO -- LA DISTINCION ES EL PUNTO
 * ---------------------------------------------------------------------------
 *
 * El controller publico colapsa los fallos en 404 o 500. El verificador NO
 * puede hacer eso, porque la taxonomia de S8c7 depende de distinguir:
 *
 *   no resoluble / indisponible   -> evidencia AUSENTE   -> INDETERMINATE
 *   documento inutilizable        -> evidencia INUTIL    -> INDETERMINATE
 *   documento valido SIN la clave -> evidencia NEGATIVA  -> INVALID
 *
 * El tercer caso es el que importa: S8c3 deja el DID resolviendo y OMITE una
 * clave comprometida. Un documento que resuelve bien y no publica
 * `#assert-N` esta diciendo activamente "esa clave no esta autorizada", y eso
 * es prueba positiva contra el proof, no falta de prueba.
 *
 * Por eso el resultado se devuelve tipado y el mapeo a HTTP se hace en el
 * controller, no aca.
 */

export type IssuerDidDocumentResolution =
  | {
      readonly kind: 'resolved';
      readonly document: IssuerDidDocumentResponseDto;
    }
  | {
      /** No hay identidad tecnica, o el DID almacenado no es de esta ruta. */
      readonly kind: 'not_resolvable';
    }
  | {
      /**
       * La identidad SI esta configurada, pero su material publico persistido
       * es incoherente. Es corrupcion interna: el documento no se puede
       * construir, asi que no se publica nada mal formado.
       */
      readonly kind: 'inconsistent_configuration';
      readonly code: IssuerDidInconsistencyCode;
    };

export type IssuerDidInconsistencyCode =
  | 'ASSERTION_PROFILE_MISSING'
  | 'ASSERTION_PROFILE_WRONG_PURPOSE'
  | 'MALFORMED_PUBLIC_KEY_MATERIAL';

@Injectable()
export class IssuerDidDocumentResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForIssuer(
    issuerId: string
  ): Promise<IssuerDidDocumentResolution> {
    if (typeof issuerId !== 'string' || issuerId.trim().length === 0) {
      return { kind: 'not_resolvable' };
    }

    const technicalIdentity =
      await this.prisma.issuerTechnicalIdentity.findUnique({
        where: { issuerId },
        // SELECT ANGOSTO, solo material PUBLICO. En particular NO pide
        // `secretRef`, ni `custody`, ni `anchorSignerProfile`, ni nada de
        // `Issuer` (ni `did` legacy ni `walletAddress`), ni User, ni
        // membership, ni credentials.
        select: {
          did: true,
          assertionSignerProfile: {
            select: {
              purpose: true,
              status: true,
              keyVersion: true,
              publicKeyX: true,
              publicKeyY: true,
              publicKeyCompressed: true
            }
          }
        }
      });

    // Sin identidad tecnica no hay DID de issuer. NO se cae a `Issuer.did`
    // legacy: un `did:example:` nunca se sirve como el DID publico nuevo.
    if (!technicalIdentity) {
      return { kind: 'not_resolvable' };
    }

    const storedDid = technicalIdentity.did;

    // El DID ALMACENADO es la autoridad: no se regenera desde
    // issuerId + configuracion actual en cada request, porque el DID es
    // identidad persistente y no un render de la configuracion vigente.
    //
    // Pero si lo persistido no es exactamente un did:web de issuer para ESTE
    // issuerId, se falla cerrado. Nunca se reescribe en silencio y nunca se
    // devuelve un DID corregido o inventado. Desde afuera esto es
    // indistinguible de "no configurado", que es justamente la respuesta mas
    // segura: no revela que existe una identidad tecnica mal configurada.
    if (!isDidForIssuerPath(storedDid, issuerId)) {
      return { kind: 'not_resolvable' };
    }

    const profile = technicalIdentity.assertionSignerProfile;

    if (!profile) {
      return {
        kind: 'inconsistent_configuration',
        code: 'ASSERTION_PROFILE_MISSING'
      };
    }

    // Un anchor jamas se publica como assertionMethod: el anchor prueba
    // anclaje, no autoria de la credential. Que la relacion de asercion
    // apunte a un anchor es corrupcion interna.
    if (profile.purpose !== SignerProfilePurpose.assertion) {
      return {
        kind: 'inconsistent_configuration',
        code: 'ASSERTION_PROFILE_WRONG_PURPOSE'
      };
    }

    const assertionKeys = publishableAssertionKeys(profile);

    try {
      return {
        kind: 'resolved',
        document: buildIssuerDidDocument({ did: storedDid, assertionKeys })
      };
    } catch (error) {
      // Material publico persistido inconsistente. El detalle de ethers y los
      // valores de la base se descartan por completo.
      if (error instanceof IssuerDidDocumentError) {
        return {
          kind: 'inconsistent_configuration',
          code: 'MALFORMED_PUBLIC_KEY_MATERIAL'
        };
      }

      throw error;
    }
  }
}

/**
 * Semantica de publicacion por estado del perfil, congelada en S8b.1:
 *
 *   active      -> se publica la clave de asercion vigente;
 *   retired     -> se sigue publicando, para que las credentials historicas
 *                  firmadas con ella puedan seguir verificandose;
 *   compromised -> NO se publica.
 *
 * S8c3 no tiene tabla de historia, asi que el perfil vinculado es el unico
 * candidato. S8c8 agregara la historia para publicar `#assert-1`,
 * `#assert-2`... a la vez; el builder ya recibe una lista.
 */
function publishableAssertionKeys(profile: {
  status: SignerProfileStatus;
  keyVersion: number;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
}): IssuerAssertionKeyInput[] {
  if (profile.status === SignerProfileStatus.compromised) {
    // El DID sigue resolviendo; simplemente no publica esta clave. Tampoco se
    // valida su material: no se va a publicar.
    return [];
  }

  return [
    {
      keyVersion: profile.keyVersion,
      publicKeyX: profile.publicKeyX,
      publicKeyY: profile.publicKeyY,
      publicKeyCompressed: profile.publicKeyCompressed
    }
  ];
}
