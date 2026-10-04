import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminReadService } from './platform-admin-read.service';

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
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformAdminIssuersController],
  providers: [PlatformAdminGuard, PlatformAdminReadService],
  exports: [PlatformAdminGuard]
})
export class PlatformAdminModule {}
