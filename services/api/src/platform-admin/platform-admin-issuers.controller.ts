import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AdminIssuerListResponseDto } from './dto/admin-issuer-summary-response.dto';
import { type AdminIssuerMembershipsResponseDto } from './dto/admin-issuer-memberships-response.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminReadService } from './platform-admin-read.service';

/**
 * Superficie administrativa de PLATAFORMA -- slice S3. Solo lecturas.
 *
 *     GET /admin/issuers
 *     GET /admin/issuers/:issuerId/memberships
 *
 * Sin `POST`, sin `PATCH`, sin `PUT`, sin `DELETE`: S3 no muta ningun dato de
 * dominio. El provisioning llega en S5a/S5b.
 *
 * AUTORIZACION. `@UseGuards(AuthGuard, PlatformAdminGuard)` en ESE orden, para
 * que un request sin token valido resuelva 401 antes de llegar al 403 de
 * plataforma. `AuthGuard` setea `request.user` releyendo el User de la base;
 * `PlatformAdminGuard` resuelve la capacidad contra la tabla `PlatformAdmin`
 * en cada request, nunca desde un claim del token.
 *
 * EL `issuerId` DEL PATH NO ES AUTORIDAD AQUI, y eso es deliberado: estas
 * lecturas NO exigen que el Platform Admin tenga `IssuerMembership` sobre el
 * issuer consultado. Es una operacion de plataforma, no institucional -- el
 * sentido de estos endpoints es justamente poder observar issuers de los que no
 * se es miembro. El plano institucional queda intacto: `IssuersService` sigue
 * siendo la unica autoridad de todo `issuers/:issuerId/*`, no aprende nada de
 * `platformAdmin`, y este guard no se aplica a ninguna de esas rutas.
 *
 * SIN PRISMA AQUI. El controller solo habla con `PlatformAdminReadService`,
 * misma convencion que `objectives.controller.ts`.
 *
 * SIN AUDITLOG. S3 es read-only: auditar cada GET no registraria ninguna
 * decision y solo haria crecer la tabla. `AuditLog` se escribe cuando hay una
 * MUTACION administrativa (S5a/S5b).
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/issuers')
export class PlatformAdminIssuersController {
  constructor(
    private readonly platformAdminReadService: PlatformAdminReadService
  ) {}

  @Get()
  listIssuers(): Promise<AdminIssuerListResponseDto> {
    return this.platformAdminReadService.listIssuers();
  }

  @Get(':issuerId/memberships')
  listIssuerMemberships(
    @Param('issuerId') issuerId: string
  ): Promise<AdminIssuerMembershipsResponseDto> {
    return this.platformAdminReadService.listIssuerMemberships(issuerId);
  }
}
