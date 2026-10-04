/**
 * Validador de `POST /admin/issuers/:issuerId/memberships` -- slice S5a.
 *
 * Es la frontera mas estrecha del repo: UN campo. El issuer sale del path, el
 * rol y el status los fija el servidor, el actor sale del token.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { mapGrantIssuerMembershipRequest } from './grant-platform-admin-membership.validator';

// ---------------------------------------------------------------------------
// 1-2. Aceptacion y normalizacion
// ---------------------------------------------------------------------------

test('1: acepta { userEmail } valido y devuelve el email normalizado', () => {
  assert.equal(
    mapGrantIssuerMembershipRequest({ userEmail: 'juan@uade.edu.ar' }),
    'juan@uade.edu.ar'
  );
});

test('2: normaliza con trim + lowercase, igual que S4 y auth', () => {
  assert.equal(
    mapGrantIssuerMembershipRequest({ userEmail: '  Juan@UADE.edu.AR  ' }),
    'juan@uade.edu.ar'
  );
  assert.equal(
    mapGrantIssuerMembershipRequest({ userEmail: '\tADRIEL@EXAMPLE.COM\n' }),
    'adriel@example.com'
  );
});

test('devuelve un string pelado: nada del body cruza al service', () => {
  const resultado = mapGrantIssuerMembershipRequest({
    userEmail: 'juan@uade.edu.ar'
  });

  assert.equal(typeof resultado, 'string');
});

// ---------------------------------------------------------------------------
// 3-5. Email invalido
// ---------------------------------------------------------------------------

test('3-5: userEmail vacio, solo espacios o con formato invalido -> 400', () => {
  for (const userEmail of [
    '',
    '   ',
    '\t\n',
    'sin-arroba',
    'a@b',
    '@dominio.com',
    'persona@',
    'persona @dominio.com',
    'dos@@dominio.com'
  ]) {
    assert.throws(
      () => mapGrantIssuerMembershipRequest({ userEmail }),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(userEmail)}`
    );
  }
});

test('userEmail de tipo no-string -> 400', () => {
  for (const userEmail of [undefined, null, 42, true, {}, [], ['a@b.co']]) {
    assert.throws(
      () => mapGrantIssuerMembershipRequest({ userEmail }),
      BadRequestException
    );
  }
});

test('body sin la clave userEmail -> 400', () => {
  assert.throws(
    () => mapGrantIssuerMembershipRequest({}),
    BadRequestException
  );
});

// ---------------------------------------------------------------------------
// 6-8. Body que no es un objeto plano
// ---------------------------------------------------------------------------

test('6-8: body null, array o string -> 400', () => {
  for (const body of [
    null,
    undefined,
    [],
    [{ userEmail: 'a@b.co' }],
    'juan@uade.edu.ar',
    42,
    true
  ]) {
    assert.throws(
      () => mapGrantIssuerMembershipRequest(body),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(body)}`
    );
  }
});

// ---------------------------------------------------------------------------
// 9-17. Claves prohibidas, con el motivo real
// ---------------------------------------------------------------------------

const CLAVES_PROHIBIDAS: Array<[string, RegExp]> = [
  // Autoridad: actor del token, sujeto por email.
  ['userId', /el actor sale del token y el sujeto se resuelve por email/],
  ['actorId', /el actor sale del token/],
  ['actorUserId', /el actor sale del token/],
  ['adminUserId', /el actor sale del token/],
  ['platformAdminUserId', /el actor sale del token/],
  ['createdBy', /el actor sale del token/],
  ['createdByUserId', /el actor sale del token/],
  ['grantedBy', /el actor sale del token/],
  ['grantedByUserId', /el actor sale del token/],
  // Lo que el servidor fija -- el corazon del slice.
  ['role', /lo establece el servidor/],
  ['status', /lo establece el servidor/],
  ['membershipRole', /lo establece el servidor/],
  ['membershipStatus', /lo establece el servidor/],
  ['authorizationStatus', /lo establece el servidor/],
  ['platformAdmin', /lo establece el servidor/],
  ['isPlatformAdmin', /lo establece el servidor/],
  // UX, no autorizacion: entrada EXPLICITA, con su propio motivo. Nombrar la
  // clave para rechazarla refuerza la invariante de O1 en vez de violarla.
  ['onboardingIntent', /intencion de onboarding, no autorizacion/],
  // El issuer sale de la ruta.
  ['issuerId', /sale de la ruta/],
  ['issuer', /sale de la ruta/],
  // Identidad tecnica y cadena.
  ['did', /identidad tecnica no se configura/],
  ['walletAddress', /identidad tecnica no se configura/],
  ['network', /identidad tecnica no se configura/],
  ['blockchainNetwork', /identidad tecnica no se configura/],
  ['chainId', /identidad tecnica no se configura/],
  ['contractAddress', /identidad tecnica no se configura/],
  ['issuerAddress', /identidad tecnica no se configura/],
  // Secretos.
  ['password', /nunca puede enviarse/],
  ['passwordHash', /nunca puede enviarse/],
  ['authCredential', /nunca puede enviarse/],
  ['accessToken', /nunca puede enviarse/],
  ['token', /nunca puede enviarse/],
  // Server-owned.
  ['id', /lo establece el servidor/],
  ['createdAt', /lo establece el servidor/],
  ['updatedAt', /lo establece el servidor/],
  ['metadata', /lo establece el servidor/],
  // Desconocidas.
  ['email', /no forma parte del contrato publico/],
  ['userIds', /no forma parte del contrato publico/],
  ['cualquierCosa', /no forma parte del contrato publico/]
];

for (const [key, motivo] of CLAVES_PROHIBIDAS) {
  test(`9-17: la clave "${key}" se RECHAZA con 400 y el motivo real`, () => {
    assert.throws(
      () =>
        mapGrantIssuerMembershipRequest({
          userEmail: 'juan@uade.edu.ar',
          [key]: 'cualquier-valor'
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match((error as Error).message, motivo);
        return true;
      }
    );
  });
}

test('onboardingIntent en el body -> 400 explicito, con su motivo propio', () => {
  // El caso concreto del micro-slice: la clave se rechaza por su categoria,
  // no por el camino generico de "campo desconocido".
  assert.throws(
    () =>
      mapGrantIssuerMembershipRequest({
        userEmail: 'persona@dominio.com',
        onboardingIntent: 'institutional'
      }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(
        (error as Error).message,
        /body\.onboardingIntent no forma parte del contrato: es intencion de onboarding, no autorizacion\./
      );
      return true;
    }
  );

  // Tambien con el otro valor del enum, y con un valor arbitrario.
  for (const value of ['personal', 'institutional', null, true, 42]) {
    assert.throws(
      () =>
        mapGrantIssuerMembershipRequest({
          userEmail: 'persona@dominio.com',
          onboardingIntent: value
        }),
      BadRequestException,
      `deberia rechazar onboardingIntent=${JSON.stringify(value)}`
    );
  }
});

test('`email` a secas no sirve: el campo se llama userEmail', () => {
  // Es el error de tipeo mas probable, y tiene que fallar explicitamente en vez
  // de resolver a "falta userEmail".
  assert.throws(
    () => mapGrantIssuerMembershipRequest({ email: 'juan@uade.edu.ar' }),
    BadRequestException
  );
});

test('una clave prohibida se rechaza aunque sea la unica del body', () => {
  for (const key of ['userId', 'role', 'status', 'issuerId']) {
    assert.throws(
      () => mapGrantIssuerMembershipRequest({ [key]: 'x' }),
      BadRequestException
    );
  }
});

test('las claves prohibidas no se ignoran: el userEmail valido NO sobrevive', () => {
  // Si el validador fuera permisivo, el cliente creeria que su `role: viewer`
  // fue tenido en cuenta.
  for (const key of ['role', 'status', 'userId', 'issuerId', 'onboardingIntent']) {
    assert.throws(
      () =>
        mapGrantIssuerMembershipRequest({
          userEmail: 'juan@uade.edu.ar',
          [key]: 'x'
        }),
      BadRequestException,
      `${key} deberia hacer fallar el request entero`
    );
  }
});

test('la tabla cubre todas las claves que el contrato nombra', () => {
  const cubiertas = new Set(CLAVES_PROHIBIDAS.map(([key]) => key));

  for (const key of [
    'userId',
    'issuerId',
    'role',
    'status',
    'membershipRole',
    'membershipStatus',
    'platformAdmin',
    'onboardingIntent',
    'authorizationStatus',
    'did',
    'walletAddress',
    'actorId',
    'createdBy',
    'metadata',
    'network',
    'chainId',
    'password',
    'passwordHash',
    'authCredential'
  ]) {
    assert.ok(cubiertas.has(key), `falta cubrir la clave ${key}`);
  }
});
