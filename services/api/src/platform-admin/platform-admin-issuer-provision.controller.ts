import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { type AdminIssuerProvisionResponseDto } from './dto/admin-issuer-provision-response.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminIssuerProvisionService } from './platform-admin-issuer-provision.service';
import { mapProvisionIssuerRequest } from './provision-platform-admin-issuer.validator';

/**
 * Alta controlada de un Issuer -- slice S5b.
 *
 *     POST /admin/issuers
 *
 * ES LA RAZON DE EXISTIR DEL PLANO DE PLATAFORMA. Si la creacion de Issuers
 * fuera self-service, cualquiera podria dar de alta una entidad llamada
 * "Harvard" o "UADE" y emitir en su nombre. Por eso no hay ningun endpoint
 * publico ni institucional que cree Issuers: solo este, detras de
 * `PlatformAdminGuard`.
 *
 * Crea exactamente un `Issuer`, una `IssuerMembership(admin, active)` y dos
 * `AuditLog`, en una sola transaccion.
 *
 * `201 Created` por el default de Nest en `@Post`, que aca es correcto: se crea
 * un recurso. (Contrastar con S4, que necesita `@HttpCode(200)` explicito
 * porque no crea nada.)
 *
 * AUTORIZACION. `@UseGuards(AuthGuard, PlatformAdminGuard)` en ESE orden: 401
 * antes del 403 de plataforma. NO exige `IssuerMembership` -- no podria, el
 * issuer no existe todavia. Es una operacion PLATFORM LEVEL.
 *
 * ESO NO ES UN BYPASS. El PlatformAdmin no gana acceso al portal del issuer que
 * acaba de crear: lo que habilita a operarlo es la fila `IssuerMembership` que
 * el service crea explicitamente para el primer admin. Si el PlatformAdmin se
 * pone a si mismo (`initialAdminUserEmail` = su propio email, permitido), opera
 * igual POR ESA MEMBERSHIP y no por su capacidad de plataforma; si pone a otra
 * persona, el PlatformAdmin queda SIN acceso institucional al issuer que
 * provisiono.
 *
 * DOS FUENTES DE DATOS, Y EL CLIENTE SOLO CONTROLA TRES STRINGS:
 *
 *   - `name`/`legalName`/`initialAdminUserEmail` -> del body, validados;
 *   - `authorizationStatus`/`authorizedAt`       -> del servidor;
 *   - `did`/`walletAddress`                      -> `null`, por omision;
 *   - `role`/`status` de la membership           -> del servidor;
 *   - `actorId`                                  -> de `@CurrentUser()`.
 *
 * El email se vuelve a resolver server-side: `POST /admin/users/resolve` (S4)
 * es confirmacion visual previa, NUNCA autoridad -- su respuesta no lleva
 * userId justamente para que el cliente no pueda transportarlo.
 *
 * `@Controller('admin/issuers')` TERCERA VEZ, y sin colision: Nest resuelve por
 * metodo+path, asi que este `POST ''` convive con el `GET ''` de S3 y con el
 * `POST ':issuerId/memberships'` de S5a. Mantenerlos en controllers separados
 * es lo que deja al de S3 verdaderamente read-only y lo que permite que el
 * guard estructural tenga una allowlist por ARCHIVO.
 *
 * SIN PRISMA AQUI: el controller solo habla con el service, misma convencion
 * que `objectives.controller.ts` y el resto del modulo.
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('admin/issuers')
export class PlatformAdminIssuerProvisionController {
  constructor(
    private readonly issuerProvisionService: PlatformAdminIssuerProvisionService
  ) {}

  @Post()
  public async provisionIssuer(
    // `unknown` a proposito: sin `ValidationPipe` en este repo, tiparlo como
    // DTO daria una falsa sensacion de que algo lo comprobo. Quien lo comprueba
    // es el validador de la primera linea del cuerpo.
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AdminIssuerProvisionResponseDto> {
    const request = mapProvisionIssuerRequest(body);

    return this.issuerProvisionService.provisionIssuer(request, currentUser.id);
  }
}
