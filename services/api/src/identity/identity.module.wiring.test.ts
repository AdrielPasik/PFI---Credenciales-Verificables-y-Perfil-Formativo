import assert from 'node:assert/strict';
import test from 'node:test';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { DidController } from './did.controller';
import { IdentityModule } from './identity.module';
import { IssuerDidController } from './issuer-did.controller';

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

// S8c3: el plano publico del issuer se resuelve en el mismo modulo, y el
// arranque sigue sin necesitar credenciales de AWS, provider de red ni ninguna
// lectura de secretos -- este test corre sin nada de eso configurado.
test('AppModule resolves IssuerDidController beside the holder plane', async () => {
  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    const scope = applicationContext.select(IdentityModule);

    const issuerController = scope.get(IssuerDidController);
    assert.ok(issuerController);
    assert.equal(typeof issuerController.getIssuerDidDocument, 'function');

    // Los dos controllers conviven: el de holders sigue resolviendose.
    assert.ok(scope.get(DidController));
  } finally {
    await applicationContext.close();
  }
});
