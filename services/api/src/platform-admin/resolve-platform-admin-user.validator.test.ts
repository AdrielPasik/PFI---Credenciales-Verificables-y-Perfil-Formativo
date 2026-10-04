/**
 * Validador de `POST /admin/users/resolve` -- slice S4.
 *
 * La frontera HTTP es estricta: una clave ajena al contrato se RECHAZA con 400,
 * nunca se ignora en silencio.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { mapResolvePlatformAdminUserRequest } from './resolve-platform-admin-user.validator';

// ---------------------------------------------------------------------------
// Aceptacion y normalizacion
// ---------------------------------------------------------------------------

test('1: acepta { email } valido y devuelve el email normalizado', () => {
  assert.equal(
    mapResolvePlatformAdminUserRequest({ email: 'persona@dominio.com' }),
    'persona@dominio.com'
  );
});

test('2: normaliza con trim + lowercase, igual que el resto del repo', () => {
  assert.equal(
    mapResolvePlatformAdminUserRequest({ email: '  Persona@Dominio.com  ' }),
    'persona@dominio.com'
  );
  assert.equal(
    mapResolvePlatformAdminUserRequest({ email: 'EMISOR.UADE@UADE.EDU.AR' }),
    'emisor.uade@uade.edu.ar'
  );
  assert.equal(
    mapResolvePlatformAdminUserRequest({ email: '\tada@example.com\n' }),
    'ada@example.com'
  );
});

test('devuelve un string pelado, nunca un objeto: nada del body cruza al service', () => {
  const resultado = mapResolvePlatformAdminUserRequest({
    email: 'persona@dominio.com'
  });

  assert.equal(typeof resultado, 'string');
});

// ---------------------------------------------------------------------------
// Email invalido
// ---------------------------------------------------------------------------

test('3-5: email vacio, solo espacios o con formato invalido -> 400', () => {
  const invalidos: unknown[] = [
    '',
    '   ',
    '\t\n',
    'sin-arroba',
    'a@b',
    '@dominio.com',
    'persona@',
    'persona @dominio.com',
    'persona@dominio .com',
    'dos@@dominio.com'
  ];

  for (const email of invalidos) {
    assert.throws(
      () => mapResolvePlatformAdminUserRequest({ email }),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(email)}`
    );
  }
});

test('email de tipo no-string -> 400', () => {
  for (const email of [undefined, null, 42, true, {}, [], ['a@b.co']]) {
    assert.throws(
      () => mapResolvePlatformAdminUserRequest({ email }),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(email)}`
    );
  }
});

test('body sin la clave email -> 400', () => {
  assert.throws(
    () => mapResolvePlatformAdminUserRequest({}),
    BadRequestException
  );
});

// ---------------------------------------------------------------------------
// Body que no es un objeto plano
// ---------------------------------------------------------------------------

test('6-8: body null, array o string -> 400', () => {
  for (const body of [
    null,
    undefined,
    [],
    [{ email: 'a@b.co' }],
    'persona@dominio.com',
    42,
    true
  ]) {
    assert.throws(
      () => mapResolvePlatformAdminUserRequest(body),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(body)}`
    );
  }
});

// ---------------------------------------------------------------------------
// 9-16: claves prohibidas -- tabla parametrizada
// ---------------------------------------------------------------------------

/**
 * Cada clave con el motivo por el que esta prohibida. El mensaje importa: quien
 * manda `platformAdminUserId` no escribio mal una clave, se equivoco de modelo
 * de confianza.
 */
const CLAVES_PROHIBIDAS: Array<[string, RegExp]> = [
  // Autoridad: sale del token.
  ['userId', /la identidad sale del token/],
  ['actorUserId', /la identidad sale del token/],
  ['platformAdminUserId', /la identidad sale del token/],
  ['creatorUserId', /la identidad sale del token/],
  ['adminUserId', /la identidad sale del token/],
  // Capacidades y estados que el servidor posee.
  ['role', /lo establece el servidor/],
  ['status', /lo establece el servidor/],
  ['membershipRole', /lo establece el servidor/],
  ['membershipStatus', /lo establece el servidor/],
  ['authorizationStatus', /lo establece el servidor/],
  ['platformAdmin', /lo establece el servidor/],
  ['isPlatformAdmin', /lo establece el servidor/],
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
  // Contexto institucional: este endpoint es de plataforma.
  ['issuerId', /resolucion de plataforma, no institucional/],
  ['issuer', /resolucion de plataforma, no institucional/],
  ['credentialId', /resolucion de plataforma, no institucional/],
  ['memberships', /resolucion de plataforma, no institucional/],
  ['issuerMemberships', /resolucion de plataforma, no institucional/],
  // Desconocidas.
  ['query', /no forma parte del contrato publico/],
  ['limit', /no forma parte del contrato publico/],
  ['emailLike', /no forma parte del contrato publico/],
  ['id', /no forma parte del contrato publico/],
  ['metadata', /no forma parte del contrato publico/],
  ['cualquierCosa', /no forma parte del contrato publico/]
];

for (const [key, motivo] of CLAVES_PROHIBIDAS) {
  test(`9-16: la clave "${key}" se RECHAZA con 400 y el motivo real`, () => {
    // Con un email valido al lado, para que quede claro que lo que falla es la
    // clave extra y no el email.
    assert.throws(
      () =>
        mapResolvePlatformAdminUserRequest({
          email: 'persona@dominio.com',
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

test('una clave prohibida se rechaza incluso si es la unica del body', () => {
  assert.throws(
    () => mapResolvePlatformAdminUserRequest({ userId: 'user-1' }),
    BadRequestException
  );
});

test('las claves prohibidas no se ignoran en silencio: el email valido NO sobrevive', () => {
  // Si el validador fuera permisivo, esto devolveria el email y el cliente
  // creeria que el servidor tuvo en cuenta su `role`.
  for (const key of ['userId', 'role', 'did', 'passwordHash', 'issuerId']) {
    assert.throws(
      () =>
        mapResolvePlatformAdminUserRequest({
          email: 'persona@dominio.com',
          [key]: 'x'
        }),
      BadRequestException,
      `${key} deberia hacer fallar el request entero`
    );
  }
});

test('la cobertura de la tabla incluye todas las claves que el contrato nombra', () => {
  // Guard del propio test: si el contrato agrega una clave prohibida y nadie la
  // suma aca, esto no lo detecta -- pero si alguien BORRA una de la tabla, si.
  const cubiertas = new Set(CLAVES_PROHIBIDAS.map(([key]) => key));

  for (const key of [
    'userId',
    'actorUserId',
    'platformAdminUserId',
    'creatorUserId',
    'role',
    'status',
    'issuerId',
    'authorizationStatus',
    'did',
    'walletAddress',
    'password',
    'passwordHash',
    'authCredential',
    'platformAdmin',
    'isPlatformAdmin',
    'membershipRole',
    'membershipStatus',
    'network',
    'blockchainNetwork',
    'chainId'
  ]) {
    assert.ok(cubiertas.has(key), `falta cubrir la clave ${key}`);
  }
});
