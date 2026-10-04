/**
 * Validador de `POST /admin/issuers` -- slice S5b.
 *
 * Lo que se defiende: exactamente tres campos entran, normalizados; y TODO lo
 * que define la autoridad del Issuer recien creado (`authorizationStatus`,
 * `authorizedAt`, `did`, `walletAddress`) o de su primer admin
 * (`role`, `status`) es inalcanzable para el cliente.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { mapProvisionIssuerRequest } from './provision-platform-admin-issuer.validator';

const VALIDO = {
  name: 'Universidad X',
  legalName: 'Universidad X',
  initialAdminUserEmail: 'admin@universidadx.edu'
};

// ---------------------------------------------------------------------------
// 1-4. Aceptacion y normalizacion
// ---------------------------------------------------------------------------

test('1: acepta el request valido y devuelve los tres campos', () => {
  assert.deepEqual(mapProvisionIssuerRequest(VALIDO), {
    name: 'Universidad X',
    legalName: 'Universidad X',
    initialAdminUserEmail: 'admin@universidadx.edu'
  });
});

test('2: trim de name, y colapso de espacios internos', () => {
  assert.equal(
    mapProvisionIssuerRequest({ ...VALIDO, name: '  Universidad X  ' }).name,
    'Universidad X'
  );
  assert.equal(
    mapProvisionIssuerRequest({ ...VALIDO, name: 'Universidad   X' }).name,
    'Universidad X'
  );
  assert.equal(
    mapProvisionIssuerRequest({ ...VALIDO, name: '\tUniversidad\nX ' }).name,
    'Universidad X'
  );
});

test('3: trim de legalName, y colapso de espacios internos', () => {
  assert.equal(
    mapProvisionIssuerRequest({
      ...VALIDO,
      legalName: '  Universidad X S.A.  '
    }).legalName,
    'Universidad X S.A.'
  );
  assert.equal(
    mapProvisionIssuerRequest({
      ...VALIDO,
      legalName: 'Universidad   X   S.A.'
    }).legalName,
    'Universidad X S.A.'
  );
});

test('NO se toca mayusculas ni acentos del nombre: una razon social es un dato', () => {
  const { name, legalName } = mapProvisionIssuerRequest({
    ...VALIDO,
    name: 'Universidad Nacional de Córdoba (UNC)',
    legalName: 'UNIVERSIDAD NACIONAL DE CÓRDOBA'
  });

  assert.equal(name, 'Universidad Nacional de Córdoba (UNC)');
  assert.equal(legalName, 'UNIVERSIDAD NACIONAL DE CÓRDOBA');
});

test('4: normaliza el email con trim + lowercase, igual que S4 y S5a', () => {
  assert.equal(
    mapProvisionIssuerRequest({
      ...VALIDO,
      initialAdminUserEmail: '  Admin@UniversidadX.EDU  '
    }).initialAdminUserEmail,
    'admin@universidadx.edu'
  );
  assert.equal(
    mapProvisionIssuerRequest({
      ...VALIDO,
      initialAdminUserEmail: '\tADRIEL@EXAMPLE.COM\n'
    }).initialAdminUserEmail,
    'adriel@example.com'
  );
});

test('devuelve un objeto NUEVO de exactamente tres claves: nada del body cruza', () => {
  const resultado = mapProvisionIssuerRequest(VALIDO);

  assert.deepEqual(Object.keys(resultado).sort(), [
    'initialAdminUserEmail',
    'legalName',
    'name'
  ]);
});

// ---------------------------------------------------------------------------
// 5-6. name / legalName vacios o invalidos
// ---------------------------------------------------------------------------

test('5: name vacio, solo espacios o no-string -> 400', () => {
  for (const name of ['', '   ', '\t\n', '  \r  ', undefined, null, 42, true, {}, []]) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, name }),
      BadRequestException,
      `deberia rechazar name=${JSON.stringify(name)}`
    );
  }
});

test('6: legalName vacio, solo espacios o no-string -> 400', () => {
  // La columna es nullable, pero ESTE endpoint lo exige: un alta controlada es
  // exactamente el momento en que la razon social existe.
  for (const legalName of ['', '   ', '\t\n', undefined, null, 42, true, {}, []]) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, legalName }),
      BadRequestException,
      `deberia rechazar legalName=${JSON.stringify(legalName)}`
    );
  }
});

test('name/legalName absurdamente largos -> 400: las columnas son `text`, la base no acota', () => {
  const largo = 'U'.repeat(513);

  assert.throws(
    () => mapProvisionIssuerRequest({ ...VALIDO, name: largo }),
    BadRequestException
  );
  assert.throws(
    () => mapProvisionIssuerRequest({ ...VALIDO, legalName: largo }),
    BadRequestException
  );
  // El limite es inclusivo: 512 pasa.
  assert.equal(
    mapProvisionIssuerRequest({ ...VALIDO, name: 'U'.repeat(512) }).name.length,
    512
  );
});

// ---------------------------------------------------------------------------
// 7. Email invalido
// ---------------------------------------------------------------------------

test('7: initialAdminUserEmail vacio o con formato invalido -> 400', () => {
  for (const initialAdminUserEmail of [
    '',
    '   ',
    'sin-arroba',
    'a@b',
    '@dominio.com',
    'persona@',
    'persona @dominio.com',
    'dos@@dominio.com',
    undefined,
    null,
    42,
    true,
    {},
    [],
    ['a@b.co']
  ]) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, initialAdminUserEmail }),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(initialAdminUserEmail)}`
    );
  }
});

test('falta cualquiera de los tres campos -> 400', () => {
  for (const key of ['name', 'legalName', 'initialAdminUserEmail']) {
    const body: Record<string, unknown> = { ...VALIDO };
    delete body[key];

    assert.throws(
      () => mapProvisionIssuerRequest(body),
      BadRequestException,
      `deberia exigir ${key}`
    );
  }
  assert.throws(() => mapProvisionIssuerRequest({}), BadRequestException);
});

// ---------------------------------------------------------------------------
// 8-10. Body que no es un objeto plano
// ---------------------------------------------------------------------------

test('8-10: body null, array o string -> 400', () => {
  for (const body of [
    null,
    undefined,
    [],
    [VALIDO],
    'Universidad X',
    42,
    true
  ]) {
    assert.throws(
      () => mapProvisionIssuerRequest(body),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(body)}`
    );
  }
});

// ---------------------------------------------------------------------------
// 11-21. Claves prohibidas, con el motivo real
// ---------------------------------------------------------------------------

const CLAVES_PROHIBIDAS: Array<[string, RegExp]> = [
  // 12, 19 -- autoridad: actor del token, primer admin por email.
  ['userId', /el actor sale del token y el primer admin se resuelve por email/],
  ['initialAdminUserId', /el primer admin se resuelve por email/],
  ['actorId', /el actor sale del token/],
  ['actorUserId', /el actor sale del token/],
  ['adminUserId', /el actor sale del token/],
  ['platformAdminUserId', /el actor sale del token/],
  ['createdBy', /el actor sale del token/],
  ['createdByUserId', /el actor sale del token/],
  ['grantedBy', /el actor sale del token/],
  ['grantedByUserId', /el actor sale del token/],
  // 14-16 -- lo que el servidor fija. El corazon del slice.
  ['authorizationStatus', /lo establece el servidor/],
  ['authorizedAt', /lo establece el servidor/],
  ['revokedAt', /lo establece el servidor/],
  ['role', /lo establece el servidor/],
  ['status', /lo establece el servidor/],
  ['membershipRole', /lo establece el servidor/],
  ['membershipStatus', /lo establece el servidor/],
  ['initialAdminRole', /lo establece el servidor/],
  ['initialAdminStatus', /lo establece el servidor/],
  ['platformAdmin', /lo establece el servidor/],
  ['isPlatformAdmin', /lo establece el servidor/],
  // 18 -- UX, no autorizacion: entrada EXPLICITA, con su propio motivo.
  ['onboardingIntent', /intencion de onboarding, no autorizacion/],
  // 13 -- este endpoint CREA el issuer.
  ['issuerId', /este endpoint CREA el issuer/],
  ['issuer', /este endpoint CREA el issuer/],
  ['id', /este endpoint CREA el issuer/],
  // 17 -- identidad tecnica y cadena.
  ['did', /identidad tecnica no se configura/],
  ['walletAddress', /identidad tecnica no se configura/],
  ['network', /identidad tecnica no se configura/],
  ['blockchainNetwork', /identidad tecnica no se configura/],
  ['chainId', /identidad tecnica no se configura/],
  ['contractAddress', /identidad tecnica no se configura/],
  ['issuerAddress', /identidad tecnica no se configura/],
  // 21 -- secretos.
  ['password', /nunca puede enviarse/],
  ['passwordHash', /nunca puede enviarse/],
  ['authCredential', /nunca puede enviarse/],
  ['accessToken', /nunca puede enviarse/],
  ['token', /nunca puede enviarse/],
  // 20 -- server-owned y relaciones.
  ['createdAt', /lo establece el servidor/],
  ['updatedAt', /lo establece el servidor/],
  ['metadata', /lo establece el servidor/],
  ['memberships', /lo establece el servidor/],
  ['academicCourses', /lo establece el servidor/],
  ['programs', /lo establece el servidor/],
  ['courseTemplates', /lo establece el servidor/],
  ['credentials', /lo establece el servidor/],
  // 11 -- desconocidas.
  ['slug', /no forma parte del contrato publico/],
  ['email', /no forma parte del contrato publico/],
  ['adminEmail', /no forma parte del contrato publico/],
  ['verificationStatus', /no forma parte del contrato publico/],
  ['kyb', /no forma parte del contrato publico/],
  ['cualquierCosa', /no forma parte del contrato publico/]
];

for (const [key, motivo] of CLAVES_PROHIBIDAS) {
  test(`11-21: la clave "${key}" se RECHAZA con 400 y el motivo real`, () => {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, [key]: 'cualquier-valor' }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match((error as Error).message, motivo);
        return true;
      }
    );
  });
}

test('18: onboardingIntent -> 400 explicito, con su motivo propio', () => {
  // No cae por el camino generico de "campo desconocido": se rechaza por su
  // categoria, porque confundir intencion de onboarding con autorizacion es
  // exactamente el error que O1 tiene que seguir haciendo imposible.
  assert.throws(
    () =>
      mapProvisionIssuerRequest({
        ...VALIDO,
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

  for (const value of ['personal', 'institutional', null, true, 42]) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, onboardingIntent: value }),
      BadRequestException,
      `deberia rechazar onboardingIntent=${JSON.stringify(value)}`
    );
  }
});

test('las claves prohibidas no se ignoran: el request valido NO sobrevive', () => {
  // Si el validador fuera permisivo, el cliente creeria que su
  // `authorizationStatus: 'authorized'` o su `did` fue tenido en cuenta.
  for (const key of [
    'authorizationStatus',
    'authorizedAt',
    'did',
    'walletAddress',
    'role',
    'status',
    'userId',
    'metadata',
    'onboardingIntent'
  ]) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, [key]: 'x' }),
      BadRequestException,
      `${key} deberia hacer fallar el request entero`
    );
  }
});

test('una clave prohibida se rechaza aunque sea la unica del body', () => {
  for (const key of ['authorizationStatus', 'did', 'role', 'issuerId']) {
    assert.throws(
      () => mapProvisionIssuerRequest({ [key]: 'x' }),
      BadRequestException
    );
  }
});

test('no se acepta un userId en lugar del email: la resolucion es server-side', () => {
  assert.throws(
    () =>
      mapProvisionIssuerRequest({
        name: 'Universidad X',
        legalName: 'Universidad X',
        userId: 'user-uuid-real'
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      mapProvisionIssuerRequest({
        name: 'Universidad X',
        legalName: 'Universidad X',
        initialAdminUserId: 'user-uuid-real'
      }),
    BadRequestException
  );
});

test('`verificationStatus` y `kyb` se rechazan: ese concepto no existe en Scope', () => {
  // `authorized` es habilitacion OPERACIONAL. No hay verificacion
  // institucional modelada, y este endpoint no la inventa.
  for (const key of ['verificationStatus', 'kyb', 'verified', 'accredited']) {
    assert.throws(
      () => mapProvisionIssuerRequest({ ...VALIDO, [key]: true }),
      BadRequestException
    );
  }
});

test('la tabla cubre todas las claves que el contrato nombra', () => {
  const cubiertas = new Set(CLAVES_PROHIBIDAS.map(([key]) => key));

  for (const key of [
    'issuerId',
    'userId',
    'role',
    'status',
    'membershipRole',
    'membershipStatus',
    'authorizationStatus',
    'authorizedAt',
    'did',
    'walletAddress',
    'platformAdmin',
    'onboardingIntent',
    'actorId',
    'createdBy',
    'metadata',
    'network',
    'blockchainNetwork',
    'chainId',
    'contractAddress',
    'issuerAddress',
    'password',
    'passwordHash',
    'authCredential',
    'accessToken',
    'token'
  ]) {
    assert.ok(cubiertas.has(key), `falta cubrir la clave ${key}`);
  }
});
