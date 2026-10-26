import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';

import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { BackgroundTaskRunner } from './password-reset/background-task-runner';
import { THROTTLE_WINDOW_MS, TOKEN_THROTTLE_LIMIT } from './password-reset/password-reset.limits';
import { PasswordResetController } from './password-reset/password-reset.controller';
import { PasswordResetService } from './password-reset/password-reset.service';
import {
  PasswordResetRequestThrottlerGuard,
  PasswordResetTokenThrottlerGuard
} from './password-reset/password-reset-throttler.guard';

@Module({
  imports: [
    JwtModule.register({}),
    MailModule,
    // Solo PROVEE el almacenamiento y las opciones que necesitan los guards de
    // recuperacion. NO registra ningun APP_GUARD: login, registro y el resto del
    // API no tienen limite de peticiones por esto. Los limites reales viven en
    // `PasswordResetThrottlerGuard` (esta entrada es el valor nominal que el
    // modulo exige, y esos guards lo sobreescriben).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: THROTTLE_WINDOW_MS, limit: TOKEN_THROTTLE_LIMIT }
    ])
  ],
  providers: [
    AuthService,
    AuthGuard,
    BackgroundTaskRunner,
    PasswordResetService,
    PasswordResetRequestThrottlerGuard,
    PasswordResetTokenThrottlerGuard
  ],
  controllers: [AuthController, PasswordResetController],
  exports: [AuthService, AuthGuard]
})
export class AuthModule {}
