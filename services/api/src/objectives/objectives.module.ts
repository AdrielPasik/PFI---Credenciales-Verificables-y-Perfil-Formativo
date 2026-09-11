import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ObjectivesController } from './objectives.controller';
import { ObjectivesService } from './objectives.service';

// F2.2: ahora existe un consumidor real del servicio de F2.1, asi que el modulo
// deja de ser codigo muerto. Delta minimo: importa `AuthModule` para el
// `AuthGuard` —`PrismaModule` es @Global()— y no exporta nada, porque todavia
// nadie fuera de aqui inyecta `ObjectivesService`.
@Module({
  imports: [AuthModule],
  controllers: [ObjectivesController],
  providers: [ObjectivesService]
})
export class ObjectivesModule {}
