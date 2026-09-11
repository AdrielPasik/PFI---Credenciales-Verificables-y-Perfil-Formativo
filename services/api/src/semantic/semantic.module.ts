import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { SemanticController } from './semantic.controller';
import { SemanticService } from './semantic.service';

// F1.5: `AuthModule` para el `AuthGuard` del controller, `IssuersModule` para
// reutilizar la comprobacion de membresia que ya usa el resto de la superficie
// de emisor. `IssuersModule` solo importa `AuthModule`, asi que no hay ciclo.
@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [SemanticController],
  providers: [SemanticService],
  exports: [SemanticService]
})
export class SemanticModule {}
