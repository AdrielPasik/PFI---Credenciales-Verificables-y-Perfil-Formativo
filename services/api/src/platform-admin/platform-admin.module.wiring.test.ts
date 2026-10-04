/**
 * Wiring de PlatformAdminModule -- slice S1.
 *
 * Mismo patron que `issuers/issuers.module.wiring.test.ts`: se levanta el
 * `AppModule` REAL y se comprueba que el guard es resoluble y que la
 * autenticacion no quedo duplicada.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminIssuersController } from './platform-admin-issuers.controller';
import { PlatformAdminModule } from './platform-admin.module';
import { PlatformAdminReadService } from './platform-admin-read.service';
import { PlatformAdminUserResolutionController } from './platform-admin-user-resolution.controller';
import { PlatformAdminUserResolutionService } from './platform-admin-user-resolution.service';

test('PlatformAdminModule resolves AuthGuard through AuthModule without duplicating AuthService', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'wiring-test-secret';

  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    PlatformAdminModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    PlatformAdminModule
  ) as unknown[];
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    PlatformAdminModule
  ) as unknown[] | undefined;

  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    assert.equal(imports.includes(AuthModule), true);
    assert.equal(providers.includes(PlatformAdminGuard), true);

    // Nunca una segunda instancia de la autenticacion.
    assert.equal(providers.includes(AuthService), false);
    assert.equal(providers.includes(AuthGuard), false);
    // PrismaModule es @Global(): declarar PrismaService aca duplicaria el
    // provider.
    assert.equal(providers.includes(PrismaService), false);

    // S3: el MISMO modulo pasa a exponer la superficie administrativa
    // read-only. Nunca un segundo modulo admin paralelo -- de ahi que el
    // controller se registre aca y no en uno nuevo. (En S1 esta asercion
    // exigia cero controllers; S3 la invierte a proposito.)
    // S4 suma el controller de resolucion de Users al MISMO modulo (su ruta no
    // cuelga de `admin/issuers`, y un @Controller tiene un unico prefijo).
    assert.deepEqual(controllers, [
      PlatformAdminIssuersController,
      PlatformAdminUserResolutionController
    ]);
    assert.ok(applicationContext.get(PlatformAdminIssuersController));
    assert.ok(applicationContext.get(PlatformAdminReadService));
    assert.ok(applicationContext.get(PlatformAdminUserResolutionController));
    assert.ok(applicationContext.get(PlatformAdminUserResolutionService));

    // Resoluble desde el AppModule real, no solo en aislamiento.
    const platformAdminGuard = applicationContext.get(PlatformAdminGuard);
    assert.ok(platformAdminGuard);

    // Y comparte la MISMA instancia global de PrismaService.
    const prismaService = applicationContext.get(PrismaService);
    assert.equal(
      (platformAdminGuard as unknown as { prisma: PrismaService }).prisma,
      prismaService
    );
  } finally {
    await applicationContext.close();
  }
});

test('AppModule registers PlatformAdminModule exactly once', async () => {
  const appImports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    AppModule
  ) as unknown[];

  assert.equal(
    appImports.filter((imported) => imported === PlatformAdminModule).length,
    1
  );
});

test('PlatformAdminModule exports the guard so S3+ controllers can consume it', async () => {
  const exported = Reflect.getMetadata(
    MODULE_METADATA.EXPORTS,
    PlatformAdminModule
  ) as unknown[];

  assert.equal(exported.includes(PlatformAdminGuard), true);
});
