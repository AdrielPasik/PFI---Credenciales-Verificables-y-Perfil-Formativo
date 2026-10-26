/**
 * Guardian estructural de la emision y verificacion de access tokens.
 *
 * La invalidacion de sesiones por `sessionVersion` solo es real si TODO token
 * pasa por el mismo emisor y por el mismo verificador. Estos tests miran el
 * codigo fuente (sin comentarios) y rompen si alguien agrega un segundo camino:
 *
 *   - un segundo `signAsync` que emita un token sin el claim `sv`;
 *   - un segundo `verifyAsync` que acepte tokens sin comparar la version;
 *   - una segunda consulta a la base en el camino de cada request autenticado;
 *   - la version filtrada a un DTO publico.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const SRC = join(__dirname, '..', '..');
const SERVICE = join('auth', 'auth.service.ts');

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

function read(relativePath: string): string {
  return stripComments(readFileSync(join(SRC, relativePath), 'utf8'));
}

/** Todo el codigo productivo de src/: sin tests, sin fixtures de test. */
function productionFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .filter((entry) => !entry.split(sep).includes('__fixtures__'))
    .map((entry) => relative(SRC, join(SRC, entry)));
}

function filesMatching(pattern: RegExp): string[] {
  return productionFiles().filter((file) => pattern.test(read(file)));
}

function countOf(code: string, pattern: RegExp): number {
  return [...code.matchAll(pattern)].length;
}

// `jwtService.verifyAsync<JwtPayload>(token, ...)` lleva un generico entre el
// nombre y el parentesis: un patron `\.verifyAsync\(` no lo veria y el guardian
// daria una falsa seguridad.
const SIGN_CALL = /\.signAsync\s*(?:<[^>]*>)?\s*\(/;
const VERIFY_CALL = /\.verifyAsync\s*(?:<[^>]*>)?\s*\(/;

test('exactly ONE place in the API signs access tokens, and it is AuthService', () => {
  assert.deepEqual(filesMatching(SIGN_CALL), [SERVICE]);
  assert.equal(countOf(read(SERVICE), new RegExp(SIGN_CALL, 'g')), 1);
});

test('exactly ONE place in the API verifies access tokens, and it is AuthService', () => {
  assert.deepEqual(filesMatching(VERIFY_CALL), [SERVICE]);
  assert.equal(countOf(read(SERVICE), new RegExp(VERIFY_CALL, 'g')), 1);
});

test('only the auth module touches JwtService', () => {
  const offenders = filesMatching(/\bJwtService\b/).filter(
    (file) => !file.startsWith('auth' + sep)
  );

  assert.deepEqual(offenders, []);
});

test('the single signing call lives inside signAccessToken, and login + register both go through it', () => {
  const code = read(SERVICE);
  const signer = code.indexOf('private async signAccessToken(');

  assert.ok(signer > -1, 'signAccessToken tiene que existir');
  assert.ok(
    code.search(SIGN_CALL) > signer,
    'signAsync solo dentro de signAccessToken'
  );
  // login y register: dos llamadas, ninguna otra.
  assert.equal(countOf(code, /this\.signAccessToken\(/g), 2);
});

test('signAccessToken always writes the sv claim', () => {
  const code = read(SERVICE);
  const signer = code.slice(code.indexOf('private async signAccessToken('));

  assert.match(signer, /sub:\s*userId,\s*sv:\s*sessionVersion/);
});

test('resolveAuthenticatedUser reads the user with ONE query and selects the version in it', () => {
  const code = read(SERVICE);
  const start = code.indexOf('async resolveAuthenticatedUser(');
  const end = code.indexOf('private async signAccessToken(');
  const body = code.slice(start, end);

  assert.ok(start > -1 && end > start);
  // Una sola consulta a la base en todo el camino de cada request autenticado.
  assert.equal(countOf(body, /this\.prisma\./g), 1);
  assert.match(body, /this\.prisma\.user\.findUnique\(/);
  // La version viaja en ese mismo select.
  assert.match(
    body,
    /authCredential:\s*\{\s*select:\s*\{\s*sessionVersion:\s*true\s*\}\s*\}/
  );
});

test('resolveAuthenticatedUser keeps every previous check and ADDS the version comparison', () => {
  const code = read(SERVICE);
  const body = code.slice(
    code.indexOf('async resolveAuthenticatedUser('),
    code.indexOf('private async signAccessToken(')
  );

  // Los chequeos que ya existian siguen en pie.
  assert.match(body, /verifyAsync/);
  assert.match(body, /payload\.sub/);
  assert.match(body, /Usuario autenticado no valido\./);
  assert.match(body, /UserStatus\.active/);
  // La comparacion se suma DESPUES del chequeo de estado.
  assert.ok(
    body.indexOf('UserStatus.active') < body.indexOf('presentedSessionVersion ??'),
    'la version se compara despues de validar el estado'
  );
});

test('every rejection of an access token uses the one public message', () => {
  const code = read(SERVICE);
  const body = code.slice(
    code.indexOf('async resolveAuthenticatedUser('),
    code.indexOf('private async signAccessToken(')
  );

  // Ningun rechazo de token arma un mensaje propio con la version.
  assert.doesNotMatch(body, /Unauthorized\w*\(\s*`/);
  assert.doesNotMatch(body, /Unauthorized\w*\([^)]*sessionVersion/);
  assert.doesNotMatch(body, /Unauthorized\w*\([^)]*presentedSessionVersion/);
});

test('the session version never reaches a public DTO or the auth controller', () => {
  const publicSurface = [
    join('auth', 'auth.controller.ts'),
    ...productionFiles().filter((file) =>
      file.startsWith(join('auth', 'dto') + sep)
    )
  ];

  assert.ok(publicSurface.length > 1);
  for (const file of publicSurface) {
    assert.doesNotMatch(read(file), /sessionVersion|\bsv\b/, file);
  }
});

test('toAuthUserResponse projects fields by name, so the version cannot ride along', () => {
  const code = read(SERVICE);
  const projection = code.slice(code.indexOf('private toAuthUserResponse('));

  assert.doesNotMatch(projection, /\.\.\.user/);
  assert.doesNotMatch(projection, /sessionVersion/);
});
