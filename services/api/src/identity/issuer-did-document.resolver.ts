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
 * Resolucion LOCAL del DID Document del issuer -- S8c3, con HISTORIA en S8c8.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE COMO SERVICIO
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
 * S8c8: SE PUBLICA LA HISTORIA, NO SOLO LA CLAVE VIGENTE
 * ---------------------------------------------------------------------------
 *
 * Una credential ya emitida referencia `#assert-N`. Despues de rotar, la clave
 * vigente es otra, y si el documento publicara unicamente la vigente esa
 * credential dejaria de verificar -- sin que nada malo haya pasado.
 *
 * Asi que se publican TODAS las claves de asercion historicamente vinculadas al
 * issuer cuyo estado lo permite:
 *
 *   active      -> se publica (es la vigente);
 *   retired     -> se publica, para que lo firmado con ella siga verificando;
 *   compromised -> NO se publica.
 *
 * La omision de una clave comprometida es evidencia NEGATIVA deliberada: el DID
 * sigue resolviendo y dice activamente "esa clave no esta autorizada", que es
 * lo que S8c7 traduce a `INVALID / ASSERTION_KEY_NOT_PUBLISHED`.
 *
 * ---------------------------------------------------------------------------
 * VIGENTE != PUBLICADA
 * ---------------------------------------------------------------------------
 *
 * El documento NO agrega ningun campo "current". Publicar una clave significa
 * "esta autorizada para verificar lo que firmo"; FIRMAR algo nuevo lo decide
 * `IssuerTechnicalIdentity.assertionSignerProfileId` y nada mas.
 *
 * De ahi el invariante mas fuerte de S8c8: una clave vinculada que siga
 * `active` y NO sea la vigente seria una clave con autorizacion publica plena
 * sobre la que nadie reclama autoridad de firma. Eso es configuracion
 * incoherente y falla cerrado -- no se publica "por si acaso".
 *
 * ---------------------------------------------------------------------------
 * SIN SECRETOS
 * ---------------------------------------------------------------------------
 *
 * Solo metadata PUBLICA persistida. No importa `IssuerSignerResolver`,
 * `SignerSecretStore`, `SSMClient`, `secretRef` ni `Wallet`, y un guard
 * estructural lo congela.
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
  | 'MALFORMED_PUBLIC_KEY_MATERIAL'
  /** El puntero vigente no tiene binding historico con este issuer. */
  | 'CURRENT_ASSERTION_NOT_BOUND'
  /** La clave vigente esta `retired`: nadie puede firmar nuevo. */
  | 'CURRENT_ASSERTION_RETIRED'
  /** Una clave vinculada sigue `active` sin ser la vigente. */
  | 'ACTIVE_NON_CURRENT_ASSERTION_KEY'
  /** Dos claves de la historia resolverian al mismo `#assert-N`. */
  | 'DUPLICATE_ASSERTION_KEY_VERSION'
  | 'INVALID_ASSERTION_KEY_VERSION';

/** Metadata PUBLICA de un perfil vinculado. Nada privado. */
export const boundProfileSelect = {
  id: true,
  purpose: true,
  status: true,
  keyVersion: true,
  publicKeyX: true,
  publicKeyY: true,
  publicKeyCompressed: true
} as const;

export interface BoundAssertionProfile {
  readonly id: string;
  readonly purpose: SignerProfilePurpose;
  readonly status: SignerProfileStatus;
  readonly keyVersion: number;
  readonly publicKeyX: string | null;
  readonly publicKeyY: string | null;
  readonly publicKeyCompressed: string | null;
}

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
        // `Issuer` mas alla de la historia de asercion (ni `did` legacy ni
        // `walletAddress`), ni User, ni membership, ni credentials.
        select: {
          did: true,
          // El PUNTERO VIGENTE. Es la autoridad de firma nueva y no se deriva
          // de la historia.
          assertionSignerProfileId: true,
          issuer: {
            select: {
              assertionKeyBindings: {
                select: { signerProfile: { select: boundProfileSelect } }
              }
            }
          }
        }
      });

    // Sin identidad tecnica no hay DID de issuer. NO se cae a `Issuer.did`
    // legacy: un `did:example:` nunca se sirve como el DID publico nuevo.
    if (!technicalIdentity) {
      return { kind: 'not_resolvable' };
    }

    return evaluateIssuerDidPublication({
      issuerId,
      did: technicalIdentity.did,
      currentProfileId: technicalIdentity.assertionSignerProfileId,
      bound: technicalIdentity.issuer.assertionKeyBindings.map(
        (binding) => binding.signerProfile as BoundAssertionProfile
      )
    });
  }
}

/**
 * Evaluacion PURA de la publicacion del DID Document -- extraida en S8c9.
 *
 * Es la UNICA implementacion de "este DID con esta historia de asercion se
 * puede publicar coherentemente". La usa el resolver del endpoint publico y la
 * usa la readiness de emision de S8c9: si fueran dos implementaciones, una
 * podria declarar "listo para emitir" a un issuer cuyo DID el endpoint publico
 * rechaza, y la credencial emitida seria inverificable.
 *
 * Sin base de datos, sin red, sin secretos. Extraer la funcion no cambia ninguna
 * semantica de S8c3/S8c7/S8c8: es el mismo cuerpo que antes vivia dentro de
 * `resolveForIssuer`.
 */
export function evaluateIssuerDidPublication(input: {
  issuerId: string;
  did: string;
  currentProfileId: string;
  bound: readonly BoundAssertionProfile[];
}): IssuerDidDocumentResolution {
  // El DID ALMACENADO es la autoridad: no se regenera desde
  // issuerId + configuracion actual, porque el DID es identidad persistente y
  // no un render de la configuracion vigente. La rotacion cambia los
  // verificationMethod del documento, nunca el DID.
  //
  // Si lo persistido no es exactamente un did:web de issuer para ESTE
  // issuerId, se falla cerrado. Nunca se reescribe en silencio y nunca se
  // devuelve un DID corregido o inventado.
  if (!isDidForIssuerPath(input.did, input.issuerId)) {
    return { kind: 'not_resolvable' };
  }

  const validation = validateAssertionHistory({
    bound: input.bound,
    currentProfileId: input.currentProfileId
  });

  if (validation.kind === 'invalid') {
    return { kind: 'inconsistent_configuration', code: validation.code };
  }

  try {
    return {
      kind: 'resolved',
      document: buildIssuerDidDocument({
        did: input.did,
        assertionKeys: validation.publishable
      })
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

type AssertionHistoryValidation =
  | { kind: 'valid'; publishable: IssuerAssertionKeyInput[] }
  | { kind: 'invalid'; code: IssuerDidInconsistencyCode };

/**
 * Valida TODA la historia de asercion antes de construir el documento.
 *
 * El orden importa: primero las propiedades que hacen el conjunto
 * interpretable (proposito, version, unicidad del fragmento), despues la
 * coherencia del puntero vigente, y solo al final se arma la lista publicable.
 *
 * ESTADO SANO:
 *
 *   exactamente UNA vigente `active`
 *   + cero o mas `retired`
 *   + cero o mas `compromised` omitidas.
 *
 * ESTADO DE RECUPERACION, tambien valido:
 *
 *   la vigente es `compromised`
 *   + cero `active`
 *   + las `retired` historicas se siguen publicando.
 *
 * El DID resuelve igual en ese estado. Convertir una clave vigente comprometida
 * en una caida total del DID castigaria al verificador de credentials viejas
 * por un incidente que no las afecta, y romperia la semantica que S8c3/S8c7
 * congelaron.
 */
function validateAssertionHistory(input: {
  bound: readonly BoundAssertionProfile[];
  currentProfileId: string;
}): AssertionHistoryValidation {
  const { bound, currentProfileId } = input;

  if (bound.length === 0) {
    // Hay identidad tecnica pero ningun binding: o la migracion no corrio, o
    // alguien borro historia. No se publica un documento vacio como si fuera
    // una respuesta valida.
    return { kind: 'invalid', code: 'ASSERTION_PROFILE_MISSING' };
  }

  for (const profile of bound) {
    // Un anchor jamas se publica como assertionMethod: el anchor prueba
    // anclaje, no autoria de la credential. Que la historia de asercion
    // contenga un anchor es una confusion de planos, no un dato corrupto de
    // una clave concreta, asi que se exige para TODA la historia incluso si la
    // clave no se fuera a publicar.
    if (profile.purpose !== SignerProfilePurpose.assertion) {
      return { kind: 'invalid', code: 'ASSERTION_PROFILE_WRONG_PURPOSE' };
    }
  }

  const current = bound.find((profile) => profile.id === currentProfileId);

  // El puntero vigente TIENE que estar en la historia. Si no esta, o la
  // rotacion se hizo por fuera de la primitiva, o el binding se borro.
  if (!current) {
    return { kind: 'invalid', code: 'CURRENT_ASSERTION_NOT_BOUND' };
  }

  // Una clave vigente `retired` es contradictoria: `retired` significa "no se
  // elige para operaciones nuevas", y el puntero vigente significa exactamente
  // lo contrario. No se reactiva, no se rota en silencio y no se elige otra.
  if (current.status === SignerProfileStatus.retired) {
    return { kind: 'invalid', code: 'CURRENT_ASSERTION_RETIRED' };
  }

  for (const profile of bound) {
    // INVARIANTE DE S8c8: `assertionMethod` es autorizacion publica. Una clave
    // vinculada que siga `active` sin ser la vigente quedaria plenamente
    // autorizada en el documento sin que nadie reclame autoridad de firma sobre
    // ella. Eso difumina justamente la distincion que esta slice protege.
    if (
      profile.status === SignerProfileStatus.active &&
      profile.id !== currentProfileId
    ) {
      return { kind: 'invalid', code: 'ACTIVE_NON_CURRENT_ASSERTION_KEY' };
    }
  }

  // PUBLICABLES: `active` y `retired`. Las comprometidas se omiten, y de ellas
  // NO se valida nada mas -- ni el material publico ni el fragmento. Exigirle
  // coherencia a una clave que no se va a publicar convertiria un incidente de
  // seguridad en una caida total del DID, y eso castigaria al verificador de
  // credentials viejas por algo que no las afecta.
  const published = bound.filter(
    (profile) => profile.status !== SignerProfileStatus.compromised
  );

  const seenKeyVersions = new Set<number>();

  for (const profile of published) {
    // `keyVersion` ES el fragmento `#assert-N`. Sin un entero positivo no hay
    // nada que publicar.
    if (!Number.isInteger(profile.keyVersion) || profile.keyVersion < 1) {
      return { kind: 'invalid', code: 'INVALID_ASSERTION_KEY_VERSION' };
    }

    // Dos claves PUBLICADAS del mismo issuer con la misma version resolverian
    // al MISMO `#assert-N`. Un documento asi seria ambiguo sobre que clave
    // autoriza que, y un verificador elegiria una de las dos por accidente de
    // orden. Falla cerrado antes de publicar.
    if (seenKeyVersions.has(profile.keyVersion)) {
      return { kind: 'invalid', code: 'DUPLICATE_ASSERTION_KEY_VERSION' };
    }
    seenKeyVersions.add(profile.keyVersion);
  }

  const publishable = published
    // ORDEN DETERMINISTA por version ascendente. Es presentacion unicamente:
    // el orden NO define cual es la vigente.
    .slice()
    .sort((left, right) => left.keyVersion - right.keyVersion)
    .map((profile) => ({
      keyVersion: profile.keyVersion,
      publicKeyX: profile.publicKeyX,
      publicKeyY: profile.publicKeyY,
      publicKeyCompressed: profile.publicKeyCompressed
    }));

  return { kind: 'valid', publishable };
}
