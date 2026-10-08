import {
  Controller,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param
} from '@nestjs/common';

import { type IssuerDidDocumentResponseDto } from './dto/issuer-did-document-response.dto';
import { IssuerDidDocumentResolver } from './issuer-did-document.resolver';

/**
 * Resolver publico del DID del issuer -- S8c3.
 *
 * PUBLICO A PROPOSITO, sin ningun guard: resolver un did:web es por definicion
 * una operacion publica, porque cualquier verificador externo debe poder
 * hacerlo conociendo unicamente el DID. Sin AuthGuard, sin PlatformAdminGuard,
 * sin membership, sin sesion, sin wallet y sin provider de blockchain.
 *
 * SIN ACCESO A SECRETOS. El documento se construye exclusivamente con metadata
 * PUBLICA persistida. Ni este archivo ni el resolver importan -- y un guard
 * estructural lo congela -- `IssuerSignerResolver`, `SignerSecretStore`,
 * `SSMClient`, `secretRef`, `Wallet` ni nada relacionado con claves privadas.
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
 *
 * ---------------------------------------------------------------------------
 * S8c7: LA RESOLUCION VIVE EN UN SERVICIO
 * ---------------------------------------------------------------------------
 *
 * La consulta, la politica de publicacion por estado y la construccion del
 * documento se movieron a `IssuerDidDocumentResolver`, para que el verificador
 * publico de credentials obtenga el documento por la MISMA implementacion y no
 * por un HTTP a esta propia API.
 *
 * Este controller queda como lo que es: la proyeccion HTTP. El mapeo de
 * resultados a status es EXACTAMENTE el de antes --
 *
 *   not_resolvable              -> 404
 *   inconsistent_configuration  -> 500
 *   resolved                    -> 200 + el mismo cuerpo
 *
 * -- y los headers no cambian.
 */
@Controller('did/issuers')
export class IssuerDidController {
  constructor(private readonly resolver: IssuerDidDocumentResolver) {}

  @Get(':issuerId/did.json')
  // `application/did+ld+json`: el documento lleva @context y es la
  // representacion JSON-LD del modelo de datos DID. No hay procesador JSON-LD:
  // el payload es el objeto determinista que define esta slice.
  @Header('Content-Type', 'application/did+ld+json')
  // `no-store` conservador: si un SignerProfile pasa a `compromised`, su clave
  // tiene que dejar de publicarse YA. Una cache HTTP o un CDN intermedio no
  // deben poder postergar esa transicion. S8c7 aplica el mismo criterio a la
  // verificacion publica de credentials, por la misma razon.
  @Header('Cache-Control', 'no-store')
  async getIssuerDidDocument(
    @Param('issuerId') issuerId: string
  ): Promise<IssuerDidDocumentResponseDto> {
    const resolution = await this.resolver.resolveForIssuer(issuerId);

    if (resolution.kind === 'not_resolvable') {
      throw notResolvable();
    }

    if (resolution.kind === 'inconsistent_configuration') {
      // La identidad SI esta configurada, asi que no es un 404. Nunca se
      // publica una JWK mal formada, y el detalle no sale al cliente.
      throw inconsistentConfiguration();
    }

    return resolution.document;
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
