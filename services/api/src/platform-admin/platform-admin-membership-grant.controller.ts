import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { type AdminMembershipGrantResponseDto } from './dto/admin-membership-grant-response.dto';
import { mapGrantIssuerMembershipRequest } from './grant-platform-admin-membership.validator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminMembershipGrantService } from './platform-admin-membership-grant.service';

/**
 * Concesion administrativa de membership -- slice S5a.
 *
 *     POST /admin/issuers/:issuerId/memberships
 *
 * PRIMER ENDPOINT DE PLATAFORMA QUE MUTA AUTORIDAD INSTITUCIONAL. Crea
 * exactamente una `IssuerMembership(admin, active)` y exactamente un
 * `AuditLog`, en una sola transaccion.
 *
 * `201 Created` por el default de Nest en `@Post`, que aca es correcto: se crea
 * un recurso. (Contrastar con S4, que necesita `@HttpCode(200)` explicito
 * porque no crea nada.)
 *
 * AUTORIZACION. `@UseGuards(AuthGuard, PlatformAdminGuard)` en ESE orden: 401
 * antes del 403 de plataforma. NO exige que el actor tenga `IssuerMembership`
 * sobre el issuer de destino -- es deliberado, es una operacion de plataforma, y
 * es justamente lo que permite dar acceso a un issuer del que nadie es miembro
 * todavia.
 *
 * ESO NO ES UN BYPASS. El PlatformAdmin no gana acceso al portal del issuer por
 * ejecutar esto: lo que gana el SUJETO del grant es una fila durable
 * `IssuerMembership`, y a partir de ahi opera por el camino institucional
 * normal (`IssuersService`), igual que cualquier otro User. Un PlatformAdmin
 * que se asigne a si mismo tambien termina operando POR LA MEMBERSHIP, no por
 * la capacidad de plataforma.
 *
 * TRES FUENTES DE DATOS, NINGUNA DEL CLIENTE MAS QUE EL EMAIL:
 *
 *   - `issuerId`      -> del path, nunca del body;
 *   - `role`/`status` -> del servidor (`admin`/`active`), nunca del body;
 *   - `actorId`       -> de `@CurrentUser()`, que setea `AuthGuard`;
 *   - `userEmail`     -> lo unico que manda el cliente, y se vuelve a resolver
 *                        server-side (S4 es confirmacion visual previa, NUNCA
 *                        autoridad: su respuesta no lleva userId justamente
 *                        para que el cliente no pueda transportarlo).
 *
 * SIN PRISMA AQUI: el controller solo habla con el service, misma convencion
 * que `objectives.controller.ts` y el resto del modulo.
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/issuers')
export class PlatformAdminMembershipGrantController {
  constructor(
    private readonly membershipGrantService: PlatformAdminMembershipGrantService
  ) {}

  @Post(':issuerId/memberships')
  public async grantMembership(
    @Param('issuerId') issuerId: string,
    // `unknown` a proposito: sin `ValidationPipe` en este repo, tiparlo como
    // DTO daria una falsa sensacion de que algo lo comprobo. Quien lo comprueba
    // es el validador de la linea siguiente.
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AdminMembershipGrantResponseDto> {
    const userEmail = mapGrantIssuerMembershipRequest(body);

    return this.membershipGrantService.grantMembership(
      issuerId,
      userEmail,
      currentUser.id
    );
  }
}
