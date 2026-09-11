/**
 * Wiring de `ObjectivesModule` — F2.2.
 *
 * Sigue el precedente de `text-evidence.module.wiring.test.ts`: comprueba los
 * metadatos declarados y, sobre todo, que el grafo real de Nest resuelva desde
 * `AppModule` — que es lo que detecta ciclos y dependencias faltantes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { ObjectivesController } from './objectives.controller';
import { ObjectivesModule } from './objectives.module';
import { ObjectivesService } from './objectives.service';

test('ObjectivesModule declares the minimum wiring', () => {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, ObjectivesModule) as unknown[];
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    ObjectivesModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    ObjectivesModule
  ) as unknown[];
  const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ObjectivesModule) as
    | unknown[]
    | undefined;

  // Sólo `AuthModule`: `PrismaModule` es @Global(), así que no hace falta
  // importarlo, y no hay ninguna otra dependencia.
  assert.deepEqual(imports, [AuthModule]);
  assert.deepEqual(controllers, [ObjectivesController]);
  assert.deepEqual(providers, [ObjectivesService]);
  // No se exporta nada: todavía nadie fuera de este módulo lo inyecta.
  assert.equal(exported, undefined);
});

test('ObjectivesModule resolves from AppModule without cycles', async () => {
  const context = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false
  });

  try {
    assert.ok(context.get(ObjectivesController));
    assert.ok(context.get(ObjectivesService));
  } finally {
    await context.close();
  }
});
