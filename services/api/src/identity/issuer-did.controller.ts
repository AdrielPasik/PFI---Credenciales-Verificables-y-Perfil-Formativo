import {
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param
} from '@nestjs/common';
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
 * Resolver publico del DID del issuer -- S8c3.
 *
 * PUBLICO A PROPOSITO, sin ningun guard: resolver un did:web es por definicion
 * una operacion publica, porque cualquier verificador externo debe poder
 * hacerlo conociendo unicamente el DID. Sin AuthGuard, sin PlatformAdminGuard,
 * sin membership, sin sesion, sin wallet y sin provider de blockchain.
 *
 * SIN ACCESO A SECRETOS. El documento se construye exclusivamente con metadata
 * PUBLICA persistida. Este archivo no importa -- y un guard estructural lo
 * congela -- `IssuerSignerResolver`, `SignerSecretStore`, `SSMClient`,
 * `secretRef`, `Wallet` ni nada relacionado con claves privadas.
 *
 * SEPARACION DE PLANOS. Este endpoint responde "que clave(s) publica(s) de
 * asercion publica esta identidad tecnica". NO responde "puede este issuer
 * emitir ahora": eso es `authorizationStatus`, `readyToIssue` y
 * `IssuerMembership`, y ninguno de los tres se consulta aca.
 *
 * Por eso tampoco se exige `IssuerTechnicalIdentity.status === active`: una
 * credential emitida historicamente puede seguir necesitando su clave de
 * asercion despues de que la identidad quede `disabled` o
 * `rotation_required`. Publicar identidad != permiso de emitir.
 */
@Controller('did/issuers')
export class IssuerDidController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':issuerId/did.json')
  // `application/did+ld+json`: el documento lleva @context y es la
  // representacion JSON-LD del modelo de datos DID. No hay procesador JSON-LD:
  // el payload es el objeto determinista que define esta slice.
  @Header('Content-Type', 'application/did+ld+json')
  // `no-store` conservador: si un SignerProfile pasa a `compromised`, su clave
  // tiene que dejar de publicarse YA. Una cache HTTP o un CDN intermedio no
  // deben poder postergar esa transicion. Una politica de cache/revalidacion
  // mas fina es asunto de verificacion (S8c7) o de una slice de deployment.
  @Header('Cache-Control', 'no-store')
  async getIssuerDidDocument(
    @Param('issuerId') issuerId: string
  ): Promise<IssuerDidDocumentResponseDto> {
    if (typeof issuerId !== 'string' || issuerId.trim().length === 0) {
      throw notResolvable();
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
      throw notResolvable();
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
      throw notResolvable();
    }

    const assertionKeys = this.resolvePublishableAssertionKeys(
      technicalIdentity.assertionSignerProfile
    );

    try {
      return buildIssuerDidDocument({ did: storedDid, assertionKeys });
    } catch (error) {
      // Material publico persistido inconsistente. Es corrupcion interna, no
      // un 404: la identidad SI esta configurada. Nunca se publica una JWK mal
      // formada, y el detalle no sale al cliente.
      if (error instanceof IssuerDidDocumentError) {
        throw inconsistentConfiguration();
      }
      throw error;
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
  private resolvePublishableAssertionKeys(
    profile: {
      purpose: SignerProfilePurpose;
      status: SignerProfileStatus;
      keyVersion: number;
      publicKeyX: string | null;
      publicKeyY: string | null;
      publicKeyCompressed: string | null;
    } | null
  ): IssuerAssertionKeyInput[] {
    if (!profile) {
      throw inconsistentConfiguration();
    }

    // Un anchor jamas se publica como assertionMethod: el anchor prueba
    // anclaje, no autoria de la credential. Que la relacion de asercion
    // apunte a un anchor es corrupcion interna.
    if (profile.purpose !== SignerProfilePurpose.assertion) {
      throw inconsistentConfiguration();
    }

    if (profile.status === SignerProfileStatus.compromised) {
      // El DID sigue resolviendo; simplemente no publica esta clave. Tampoco
      // se valida su material: no se va a publicar.
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
}

/**
 * Respuesta uniforme para todo lo que no es resoluble. Deliberadamente no
 * distingue "no existe el issuer" de "existe pero su DID almacenado no
 * corresponde a esta ruta": esa distincion seria informacion de configuracion
 * tecnica interna.
 */
function notResolvable(): NotFoundException {
  return new NotFoundException(
    'No se encontro un DID Document para ese emisor.'
  );
}

function inconsistentConfiguration(): InternalServerErrorException {
  return new InternalServerErrorException(
    'No se pudo construir el DID Document del emisor.'
  );
}
