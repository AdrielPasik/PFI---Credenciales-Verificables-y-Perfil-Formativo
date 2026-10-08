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
      // S8c8: carga por id EXACTO, sin pasar por ninguna identidad tecnica.
      'loadHistoricalAnchorProfile',
      'normalizePersistedAddress',
      'resolveAnchorSignerForIssuer',
      'resolveAssertionSignerForIssuer',
      'resolveForPurpose',
      // S8c8: cola compartida por la resolucion vigente y la historica.
      'resolveFromProfile',
      // S8c8: revocacion historica. Acepta active y retired, rechaza
      // compromised ANTES de leer el secreto.
      'resolveHistoricalAnchorSigner',
      // UNA sola implementacion de consistencia criptografica, compartida por
      // el cache miss y el cache hit.
      'validateWalletAgainstProfile'
    ].sort()
  );

  // S8c8 agrega UNA sola operacion de resolucion mas, y es explicita sobre su
  // semantica: `Historical` + `Anchor`. Sigue sin existir ningun
  // `resolveSigner(issuerId)` vago que permita omitir el proposito, y la
  // historica no acepta un `issuerId`: resuelve un perfil por id exacto.
  const publicApi = methods.filter((name) => name.startsWith('resolve'));
  assert.deepEqual(publicApi.sort(), [
    'resolveAnchorSignerForIssuer',
    'resolveAssertionSignerForIssuer',
    'resolveForPurpose',
    'resolveFromProfile',
    'resolveHistoricalAnchorSigner'
  ]);

  // Y ninguna de las dos resoluciones por issuer puede confundirse con la
  // historica: la historica no lleva `ForIssuer` en el nombre.
  assert.ok(!publicApi.includes('resolveSigner'));
  assert.ok(!publicApi.includes('resolveHistoricalAnchorSignerForIssuer'));
});
