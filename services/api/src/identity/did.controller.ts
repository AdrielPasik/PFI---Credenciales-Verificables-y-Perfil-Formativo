import { Controller, Get, NotFoundException, Param } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { type DidDocumentResponseDto } from './dto/did-document-response.dto';
import { isDidForUserPath } from './did-web';

// A2.1: publico a proposito -- sin @UseGuards(AuthGuard). Resolver
// did:web es por definicion un endpoint publico (cualquier verificador
// externo debe poder resolverlo sin autenticarse contra Traza). READ
// ONLY: nunca provisiona un DID (eso solo ocurre en register/issue via
// ensureDidForUser) ni muta User. Nunca expone email/firstName/lastName/
// displayName/status/Credentials -- unicamente el DID Document minimo.
@Controller('did/users')
export class DidController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':userId/did.json')
  async getDidDocument(
    @Param('userId') userId: string
  ): Promise<DidDocumentResponseDto> {
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      throw new NotFoundException('No se encontro un DID Document para ese usuario.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { did: true }
    });

    // User.did es la unica autoridad: nunca se recalcula contra la
    // configuracion actual. Si el valor persistido no es exactamente un
    // did:web para este userId (null, did:example de fixture, u otro
    // metodo legado), se responde 404 en vez de transformarlo
    // silenciosamente en un documento inventado.
    if (!user?.did || !isDidForUserPath(user.did, userId)) {
      throw new NotFoundException(
        'No se encontro un DID Document para ese usuario.'
      );
    }

    return {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: user.did
    };
  }
}
