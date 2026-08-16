import assert from 'node:assert/strict';
import test from 'node:test';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { DidController } from './did.controller';
import { IdentityModule } from './identity.module';

test('AppModule wires IdentityModule and resolves DidController with PrismaService', async () => {
  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    const controller = applicationContext.select(IdentityModule).get(DidController);
    assert.ok(controller);
  } finally {
    await applicationContext.close();
  }
});
