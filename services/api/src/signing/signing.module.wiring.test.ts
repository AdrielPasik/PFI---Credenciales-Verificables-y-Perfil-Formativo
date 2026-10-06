/**
 * Wiring del modulo de firma -- S8c2.
 *
 * Arranca el AppModule REAL y comprueba dos cosas a la vez:
 *
 *   1. el modulo se resuelve, es decir el camino nuevo existe y es inyectable;
 *   2. arrancar la aplicacion NO lee ningun secreto y NO toca AWS.
 *
 * El punto 2 es el que importa para esta slice: registrar el modulo tiene que
 * ser inocuo. Construir el cliente del SDK no abre conexiones ni resuelve
 * credenciales, y la recuperacion del secreto es perezosa -- ocurre unicamente
 * cuando alguien llama explicitamente a un metodo `resolve*`, y en S8c2 nadie
 * lo hace.
 *
 * El entorno de este test no tiene credenciales de AWS, asi que si el arranque
 * intentara hablar con SSM fallaria aca.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { IssuerSignerResolver } from './issuer-signer-resolver';
import { SIGNER_SECRET_STORE } from './signer-secret-store.port';
import { SigningModule } from './signing.module';

test('AppModule wires SigningModule y resuelve el resolver y el almacen', async () => {
  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    const scope = applicationContext.select(SigningModule);

    const resolver = scope.get(IssuerSignerResolver);
    assert.ok(resolver);
    assert.equal(typeof resolver.resolveAssertionSignerForIssuer, 'function');
    assert.equal(typeof resolver.resolveAnchorSignerForIssuer, 'function');

    const store = scope.get(SIGNER_SECRET_STORE);
    assert.ok(store);
    assert.equal(typeof store.getPrivateKey, 'function');
  } finally {
    await applicationContext.close();
  }
});

test('el resolver expone SOLO las dos operaciones de resolucion por proposito', () => {
  const methods = Object.getOwnPropertyNames(
    IssuerSignerResolver.prototype
  ).filter((name) => name !== 'constructor');

  // No existe un `resolveSigner(issuerId)` vago que permita confundir
  // asercion con anclaje: el proposito no se puede omitir por descuido.
  assert.deepEqual(
    methods.sort(),
    [
      'buildVerifiedWallet',
      'loadActiveProfile',
      'normalizePersistedAddress',
      'resolveAnchorSignerForIssuer',
      'resolveAssertionSignerForIssuer',
      'resolveForPurpose',
      // UNA sola implementacion de consistencia criptografica, compartida por
      // el cache miss y el cache hit.
      'validateWalletAgainstProfile'
    ].sort()
  );

  const publicApi = methods.filter((name) => name.startsWith('resolve'));
  assert.deepEqual(publicApi.sort(), [
    'resolveAnchorSignerForIssuer',
    'resolveAssertionSignerForIssuer',
    'resolveForPurpose'
  ]);
});
