import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CredentialLatestSemanticAnalysisResponseDto } from './dto/latest-semantic-analysis-response.dto';
import { SemanticService } from './semantic.service';

/**
 * F1.5: esta ruta dejo de ser publica.
 *
 * Hasta este slice era el UNICO controller sin `@UseGuards(AuthGuard)` que no lo
 * declaraba a proposito —`auth/register` y `did/users/:userId/did.json` lo son, y
 * ambos lo dicen en un comentario—, y devolvia el analisis semantico completo,
 * `analysisJson` incluido, a cualquiera que conociera un `credentialId`.
 *
 * La autenticacion se resuelve aca; la AUTORIZACION vive en el servicio, que es
 * quien puede leer el issuer de la credencial. Conocer un id no es autoridad.
 */
@UseGuards(AuthGuard)
@Controller('credentials/:id/semantic-analysis')
export class SemanticController {
  constructor(private readonly semanticService: SemanticService) {}

  @Get('latest')
  getLatestForCredential(
    @Param('id') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CredentialLatestSemanticAnalysisResponseDto> {
    // El userId sale SIEMPRE del token, nunca de un parametro de la peticion.
    return this.semanticService.getLatestForCredential(
      credentialId,
      currentUser.id
    );
  }
}
