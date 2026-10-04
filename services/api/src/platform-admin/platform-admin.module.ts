import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';
import { PlatformAdminMembershipGrantController } from './platform-admin-membership-grant.controller';
import { PlatformAdminMembershipGrantService } from './platform-admin-membership-grant.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminReadService } from './platform-admin-read.service';
import { PlatformAdminUserResolutionController } from './platform-admin-user-resolution.controller';
import { PlatformAdminUserResolutionService } from './platform-admin-user-resolution.service';

/**
 * Modulo del plano de plataforma -- slice S1.
 *
 * WIRING MINIMO, con los mismos precedentes que `IssuersModule`:
 *
 *   - `imports: [AuthModule]` y nada mas. `AuthModule` ya EXPORTA `AuthService`
 *     y `AuthGuard`, asi que los controllers `/admin` de S3+ van a poder usar
 *     `@UseGuards(AuthGuard, PlatformAdminGuard)` sin que este modulo cambie.
 *     Nunca se re-proveen `AuthService` ni `AuthGuard` aca: eso crearia una
 *     segunda instancia de la autenticacion. Lo congela el wiring test.
 *
 *   - `PrismaModule` NO se importa: es `@Global()` y ya exporta `PrismaService`
 *     desde el `AppModule`. Declararlo aca duplicaria el provider.
 *
 * S3 agrega la superficie administrativa READ-ONLY sobre el MISMO modulo: un
 * controller y un service de lectura, nunca un segundo modulo admin paralelo.
 * `PlatformAdminGuard` no se movio ni se re-declaro.
 *
 * S4 suma la resolucion de Users por email -- tambien read-only y tambien en
 * este modulo. Controller propio en vez de un metodo mas en el de issuers
 * porque la ruta no cuelga de `admin/issuers`: es `admin/users/resolve`, y un
 * `@Controller` tiene un unico prefijo.
 *
 * S5a suma el PRIMER writer del modulo. Comparte el prefijo `admin/issuers`
 * con el controller de lecturas, pero vive en un controller APARTE a proposito:
 * Nest resuelve rutas por metodo+path, asi que `GET :issuerId/memberships` y
 * `POST :issuerId/memberships` no colisionan, y mantenerlos separados deja al
 * controller de S3 verdaderamente read-only -- lo que el guard estructural del
 * modulo comprueba archivo por archivo.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    PlatformAdminIssuersController,
    PlatformAdminUserResolutionController,
    PlatformAdminMembershipGrantController
  ],
  providers: [
    PlatformAdminGuard,
    PlatformAdminReadService,
    PlatformAdminUserResolutionService,
    PlatformAdminMembershipGrantService
  ],
  exports: [PlatformAdminGuard]
})
export class PlatformAdminModule {}
