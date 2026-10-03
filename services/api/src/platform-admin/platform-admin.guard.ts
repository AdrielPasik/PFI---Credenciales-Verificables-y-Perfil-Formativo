import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';

import { type AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Guard del PLANO DE PLATAFORMA -- slice S1.
 *
 * Autoriza unicamente la capacidad global `PlatformAdmin`. No autoriza, ni
 * puede autorizar, ninguna operacion sobre un `Issuer` concreto: ese es el
 * PLANO INSTITUCIONAL y sigue siendo exclusivamente de `IssuersService`
 * (`assertUserCan*ForIssuer` -> membership activa + rol admin|operator +
 * issuer authorized). Los dos planos no se cruzan:
 *
 *   - un `IssuerMembership(role = admin)` NO otorga esta capacidad -- este
 *     guard consulta solo la tabla `PlatformAdmin`, que no tiene `issuerId`;
 *   - un `PlatformAdmin` NO gana permisos operativos sobre ningun issuer --
 *     `IssuersService` nunca consulta `platformAdmin`, y este guard no se
 *     aplica a ninguna ruta `issuers/:issuerId/*`. Para OPERAR un issuer, un
 *     PlatformAdmin necesita su propia `IssuerMembership`, igual que cualquier
 *     otro User.
 *
 * USO. Siempre `@UseGuards(AuthGuard, PlatformAdminGuard)`, en ESE orden, para
 * que un request sin token valido resuelva 401 antes de llegar a este 403.
 *
 * EL ACTOR SALE EXCLUSIVAMENTE DE LA IDENTIDAD AUTENTICADA. `request.user` lo
 * setea `AuthGuard` tras verificar la firma del JWT y RELEER el `User` de la
 * base (ver `AuthService.resolveAuthenticatedUser`). Este guard nunca lee un
 * id de actor desde `@Param`, `@Query`, el body ni un header: un cliente no
 * puede proponer en nombre de quien actua. Si `request.user` no esta -- o sea,
 * si alguien montara este guard SIN `AuthGuard` por delante -- se responde 401,
 * nunca 500 y nunca `true`: fail-closed por omision de configuracion.
 *
 * SIN CACHE Y SIN CLAIMS EN EL TOKEN. El grant se resuelve contra la base en
 * CADA request. Es deliberado y es la propiedad que hace que `JwtPayload` siga
 * siendo solo `{ sub }` (no se toca ni `JwtPayload` ni `AuthenticatedUser`):
 * borrar la fila de `PlatformAdmin` revoca el acceso de inmediato, sin esperar
 * a que expire ningun token emitido antes. Cachearlo cambiaria esa garantia por
 * una query que, al ser un `findUnique` sobre `PlatformAdmin_userId_key`, no es
 * el cuello de botella de ninguna request administrativa.
 *
 * S1 NO INCLUYE NINGUN ENDPOINT. Este guard existe, esta wireado y testeado,
 * pero todavia no protege ninguna ruta: los controllers `/admin` llegan en
 * S3+. Y ningun codigo productivo ESCRIBE `PlatformAdmin` -- la concesion es
 * out-of-band (S2), lo que hace que el auto-escalamiento sea imposible por
 * construccion y no por validacion. Eso lo congela
 * `__guards__/platform-admin-write-surface.test.ts`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Bearer token requerido.');
    }

    const grant = await this.prisma.platformAdmin.findUnique({
      where: {
        userId
      },
      select: {
        id: true
      }
    });

    if (!grant) {
      throw new ForbiddenException(
        'Operacion restringida a la administracion de plataforma.'
      );
    }

    return true;
  }
}
