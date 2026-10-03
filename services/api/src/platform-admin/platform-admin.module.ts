import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from './platform-admin.guard';

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
 * S1 no declara `controllers`: la capacidad existe y es resoluble, pero
 * todavia no protege ninguna ruta. `PlatformAdminGuard` se exporta para que los
 * controllers de S3+ lo consuman.
 */
@Module({
  imports: [AuthModule],
  providers: [PlatformAdminGuard],
  exports: [PlatformAdminGuard]
})
export class PlatformAdminModule {}
