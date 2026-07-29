import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { IssuerHolderResolutionController } from './issuer-holder-resolution.controller';
import { IssuersModule } from './issuers.module';

test('IssuersModule resolves AuthGuard through AuthModule without duplicating AuthService', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    IssuersModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    IssuersModule
  ) as unknown[];

  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    assert.equal(imports.includes(AuthModule), true);
    assert.equal(providers.includes(AuthService), false);
    assert.equal(providers.includes(AuthGuard), false);

    const authService = applicationContext.get(AuthService);
    const authGuard = applicationContext.get(AuthGuard);
    const controller = applicationContext.get(
      IssuerHolderResolutionController
    );

    assert.ok(controller);
    assert.equal(
      (authGuard as unknown as { authService: AuthService }).authService,
      authService
    );
  } finally {
    await applicationContext.close();
  }
});
