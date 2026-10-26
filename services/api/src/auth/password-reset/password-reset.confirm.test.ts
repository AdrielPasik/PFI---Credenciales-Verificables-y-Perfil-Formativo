/**
 * POST /auth/password-reset/verify y /confirm -- logica (16.3 y 16.4), mas los
 * criterios de aceptacion de punta a punta: contrasena vieja, contrasena nueva, JWT
 * viejo, JWT nuevo, otro usuario y reutilizacion del token.
 *
 * El tramo de aceptacion usa el `AuthService` REAL y el `JwtService` REAL de
 * @nestjs/jwt sobre el mismo doble de Prisma, no un stub de firma.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { AuthService } from '../auth.service';
import { verifyPasswordHash } from '../password-hashing';
import { ACCOUNT_COOLDOWN_MS, PASSWORD_RESET_TTL_MS } from './password-reset.limits';
import { PasswordResetService } from './password-reset.service';
import { generatePasswordResetToken, hashPasswordResetToken } from './password-reset-token';
import {
  NEW_PASSWORD,
  OLD_PASSWORD,
  buildRecovery,
  codeOf,
  configureRecoveryEnv,
  installLogCapture,
  statusOf,
  type Recovery
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
const logs = installLogCapture();

const EMAIL = 'ada@example.com';

/** Una cuenta con un enlace emitido por el flujo REAL de solicitud. */
async function withLink(email = EMAIL) {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email, password: OLD_PASSWORD });
  await r.request(email);
  return { r, user, token: r.lastToken() };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('debia rechazarse');
}

function assertInvalidToken(error: unknown, label = ''): void {
  assert.equal(codeOf(error), 'PASSWORD_RESET_TOKEN_INVALID', label);
  assert.equal(statusOf(error), 400, label);
}

function credentialOf(r: Recovery, userId: string) {
  return r.world.state.credentials.find((row) => row.userId === userId)!;
}

// ---------------------------------------------------------------------------
// 16.3 Verificacion
// ---------------------------------------------------------------------------

test('26. a live token verifies as valid', async () => {
  const { r, token } = await withLink();

  assert.deepEqual(await r.service.verifyToken({ token }), { status: 'valid' });
});

test('27-28. an unknown token and a tampered token are the same INVALID', async () => {
  const { r, token } = await withLink();

  const unknown = await rejection(
    r.service.verifyToken({ token: generatePasswordResetToken() })
  );
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const tampered = await rejection(r.service.verifyToken({ token: flipped }));

  assertInvalidToken(unknown, 'desconocido');
  assertInvalidToken(tampered, 'manipulado');
  assert.deepEqual(
    JSON.stringify((unknown as { getResponse(): unknown }).getResponse()),
    JSON.stringify((tampered as { getResponse(): unknown }).getResponse())
  );
});

test('29. an expired token is INVALID -- at the exact 30 minute boundary', async () => {
  const { r, token } = await withLink();

  r.world.clock.advance(PASSWORD_RESET_TTL_MS - 1);
  assert.deepEqual(await r.service.verifyToken({ token }), { status: 'valid' });

  r.world.clock.advance(1); // expiresAt === ahora: ya no es "posterior" al instante actual
  assertInvalidToken(await rejection(r.service.verifyToken({ token })));
});

test('30. a consumed token is INVALID', async () => {
  const { r, token } = await withLink();
  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  assertInvalidToken(await rejection(r.service.verifyToken({ token })));
});

test('31. an invalidated token (replaced by a newer request) is INVALID', async () => {
  const { r, token: first } = await withLink();
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  await r.request(EMAIL);
  const second = r.lastToken();

  assertInvalidToken(await rejection(r.service.verifyToken({ token: first })), 'viejo');
  assert.deepEqual(await r.service.verifyToken({ token: second }), { status: 'valid' });
});

test('32. a token whose account is no longer active is INVALID', async () => {
  for (const status of [UserStatus.suspended, UserStatus.pending, UserStatus.archived]) {
    const { r, user, token } = await withLink();
    r.world.state.users.find((row) => row.id === user.id)!.status = status;

    assertInvalidToken(await rejection(r.service.verifyToken({ token })), status);
  }
});

test('32b. a token whose account lost its credential is INVALID', async () => {
  const { r, user, token } = await withLink();
  r.world.state.credentials.splice(
    r.world.state.credentials.findIndex((row) => row.userId === user.id),
    1
  );

  assertInvalidToken(await rejection(r.service.verifyToken({ token })));
});

test('33. a malformed token is INVALID; a body that is not an object is INVALID_REQUEST_INPUT', async () => {
  const { r } = await withLink();

  for (const token of ['', 'short', 'a'.repeat(44), 'a'.repeat(42), `${'a'.repeat(42)}!`, 'a'.repeat(100_000)]) {
    assertInvalidToken(await rejection(r.service.verifyToken({ token })), token.slice(0, 10));
  }

  for (const body of [undefined, null, [], 'token', 5, {}, { token: 5 }, { token: null }, { token: ['x'] }, { token: {} }]) {
    const error = await rejection(r.service.verifyToken(body));
    assert.equal(codeOf(error), 'INVALID_REQUEST_INPUT', JSON.stringify(body));
    assert.equal(statusOf(error), 400);
  }
});

test('34. verifying NEVER consumes the token and writes nothing', async () => {
  const { r, token } = await withLink();
  const before = JSON.stringify(r.world.state);
  const statementsBefore = r.world.statements.length;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await r.service.verifyToken({ token });
  }

  assert.equal(JSON.stringify(r.world.state), before, 'el estado no cambio');
  const verifyStatements = r.world.statements.slice(statementsBefore);
  assert.ok(verifyStatements.every((name) => name === 'passwordResetToken.findUnique'));
  // Y el enlace sigue sirviendo para el cambio de contrasena.
  assert.deepEqual(await r.service.confirmReset({ token, password: NEW_PASSWORD }), {
    status: 'password_reset'
  });
});

test('35. verify returns no account data: only { status }', async () => {
  const { r, user, token } = await withLink();

  const response = await r.service.verifyToken({ token });

  assert.deepEqual(Object.keys(response), ['status']);
  const text = JSON.stringify(response);
  for (const leaked of [user.id, EMAIL, hashPasswordResetToken(token), token, 'expiresAt']) {
    assert.ok(!text.includes(leaked), leaked);
  }
});

// ---------------------------------------------------------------------------
// 16.4 Confirmacion
// ---------------------------------------------------------------------------

test('36. a live token and a valid password change the password', async () => {
  const { r, user, token } = await withLink();
  const oldHash = credentialOf(r, user.id).passwordHash;

  const response = await r.service.confirmReset({ token, password: NEW_PASSWORD });

  assert.deepEqual(response, { status: 'password_reset' });
  assert.notEqual(credentialOf(r, user.id).passwordHash, oldHash);
  assert.ok(await verifyPasswordHash(NEW_PASSWORD, credentialOf(r, user.id).passwordHash));
});

test('37-38. a password outside 8..128 characters is rejected BEFORE anything is consumed', async () => {
  const { r, user, token } = await withLink();
  const statementsBefore = r.world.statements.length;

  for (const password of ['', 'short', 'x'.repeat(7), 'x'.repeat(129), 'x'.repeat(200_000)]) {
    const error = await rejection(r.service.confirmReset({ token, password }));
    assert.equal(codeOf(error), 'PASSWORD_POLICY_VIOLATION', `${password.length} caracteres`);
    assert.equal(statusOf(error), 400);
  }

  // No se toco la base: ni siquiera se busco el token.
  assert.equal(r.world.statements.length, statementsBefore);
  assert.equal(r.world.liveTokens(user.id).length, 1);

  // Los limites exactos SI se aceptan.
  for (const password of ['x'.repeat(8), 'x'.repeat(128)]) {
    const fresh = await withLink('exact@example.com');
    assert.deepEqual(await fresh.r.service.confirmReset({ token: fresh.token, password }), {
      status: 'password_reset'
    });
  }
});

test('37b. a body of the wrong shape is INVALID_REQUEST_INPUT', async () => {
  const { r, token } = await withLink();

  for (const body of [undefined, null, [], {}, { token }, { password: NEW_PASSWORD }, { token, password: 12345678 }, { token, password: null }, { token, password: ['x'] }]) {
    const error = await rejection(r.service.confirmReset(body));
    assert.equal(codeOf(error), 'INVALID_REQUEST_INPUT', JSON.stringify(body));
  }
});

test('39. an invalid token is INVALID and spends no password hashing', async () => {
  const { r, user } = await withLink();
  const rollbacksBefore = r.world.rollbacks;

  const error = await rejection(
    r.service.confirmReset({ token: generatePasswordResetToken(), password: NEW_PASSWORD })
  );

  assertInvalidToken(error);
  // La preverificacion lo corta antes de abrir una transaccion.
  assert.equal(r.world.rollbacks, rollbacksBefore);
  assert.equal(credentialOf(r, user.id).sessionVersion, 0);
});

test('40. an expired token cannot change the password', async () => {
  const { r, user, token } = await withLink();
  const oldHash = credentialOf(r, user.id).passwordHash;
  r.world.clock.advance(PASSWORD_RESET_TTL_MS + 1_000);

  assertInvalidToken(await rejection(r.service.confirmReset({ token, password: NEW_PASSWORD })));

  assert.equal(credentialOf(r, user.id).passwordHash, oldHash);
  assert.equal(credentialOf(r, user.id).sessionVersion, 0);
});

test('40b. a token that expires WHILE the password is being hashed is not consumed', async () => {
  const { r, user, token } = await withLink();
  const oldHash = credentialOf(r, user.id).passwordHash;
  // El servicio lee el reloj dos veces en una confirmacion: (1) en la
  // preverificacion y (2) al abrir la transaccion, DESPUES de scrypt. Este reloj
  // devuelve "ahora" la primera vez y "ahora + 30 min" a partir de la segunda: el
  // tiempo que pasa mientras la contrasena se hashea.
  let reads = 0;
  const lateClock = () =>
    new Date(r.world.clock.now.getTime() + (reads++ === 0 ? 0 : PASSWORD_RESET_TTL_MS));
  const late = new PasswordResetService(r.world.prisma as never, r.transport, r.tasks, lateClock);

  assertInvalidToken(await rejection(late.confirmReset({ token, password: NEW_PASSWORD })));
  assert.equal(reads, 2, 'la preverificacion y la transaccion leen el reloj por separado');

  assert.equal(credentialOf(r, user.id).passwordHash, oldHash);
  assert.equal(r.world.state.tokens[0].consumedAt, null);
});

test('41. a token cannot be used twice', async () => {
  const { r, user, token } = await withLink();
  await r.service.confirmReset({ token, password: NEW_PASSWORD });
  const afterFirst = credentialOf(r, user.id).passwordHash;

  const error = await rejection(
    r.service.confirmReset({ token, password: 'AnotherPassword789' })
  );

  assertInvalidToken(error);
  assert.equal(credentialOf(r, user.id).passwordHash, afterFirst, 'la segunda no cambio nada');
  assert.equal(credentialOf(r, user.id).sessionVersion, 1, 'sessionVersion subio una sola vez');
});

test('42. the consume is a CONDITIONAL update on id + unconsumed + uninvalidated + unexpired + active account', async () => {
  const { r, token } = await withLink();
  const callsBefore = r.world.calls.length;

  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  // El primer updateMany sobre tokens, dentro de la confirmacion, es el consumo.
  const consume = r.world.calls
    .slice(callsBefore)
    .find((call) => call.statement === 'passwordResetToken.updateMany')!.args as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.equal(consume.where.id, r.world.state.tokens[0].id);
  assert.equal(consume.where.consumedAt, null);
  assert.equal(consume.where.invalidatedAt, null);
  assert.ok(consume.where.expiresAt && 'gt' in (consume.where.expiresAt as object));
  assert.deepEqual(consume.where.user, { is: { status: UserStatus.active } });
  assert.deepEqual(Object.keys(consume.data), ['consumedAt']);
});

test('43. when another transaction consumed the token in between (count 0), NOTHING changes', async () => {
  const { r, user, token } = await withLink();
  const oldHash = credentialOf(r, user.id).passwordHash;
  // Simula que otra confirmacion gano la carrera justo antes de MI consumo.
  r.world.before('passwordResetToken.updateMany', () => {
    r.world.state.tokens[0].consumedAt = new Date(r.world.clock.now);
  });

  const error = await rejection(r.service.confirmReset({ token, password: NEW_PASSWORD }));

  assertInvalidToken(error);
  assert.equal(credentialOf(r, user.id).passwordHash, oldHash, 'la contrasena no cambio');
  assert.equal(credentialOf(r, user.id).sessionVersion, 0, 'sessionVersion no subio');
  assert.equal(r.world.rollbacks, 1);
  // Ni siquiera se intento tocar la credencial.
  assert.ok(!r.world.statements.includes('authCredential.updateMany'));
});

test('44. a failure updating the credential ROLLS BACK the consume: the token is still usable', async () => {
  const { r, user, token } = await withLink();
  const oldHash = credentialOf(r, user.id).passwordHash;
  r.world.failNext('authCredential.updateMany', new Error('connection lost'));

  const error = await rejection(r.service.confirmReset({ token, password: NEW_PASSWORD }));

  assert.match(String((error as Error).message), /connection lost/, 'es un 500, no un INVALID');
  assert.equal(r.world.rollbacks, 1);
  assert.equal(r.world.state.tokens[0].consumedAt, null, 'el consumo se revirtio');
  assert.equal(credentialOf(r, user.id).passwordHash, oldHash);
  assert.equal(credentialOf(r, user.id).sessionVersion, 0);

  // 56. Y como no se consumio, un reintento funciona.
  assert.deepEqual(await r.service.confirmReset({ token, password: NEW_PASSWORD }), {
    status: 'password_reset'
  });
});

test('44b. if the credential row vanished mid-flight (count 0), the consume is rolled back', async () => {
  const { r, user, token } = await withLink();
  r.world.before('authCredential.updateMany', () => {
    r.world.state.credentials.splice(0, r.world.state.credentials.length);
  });

  assertInvalidToken(await rejection(r.service.confirmReset({ token, password: NEW_PASSWORD })));

  assert.equal(r.world.state.tokens[0].consumedAt, null);
  assert.equal(r.world.rollbacks, 1);
  assert.equal(user.id.length > 0, true);
});

test('45. sessionVersion goes up by exactly one', async () => {
  const { r, user, token } = await withLink();
  assert.equal(credentialOf(r, user.id).sessionVersion, 0);

  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  assert.equal(credentialOf(r, user.id).sessionVersion, 1);
});

test('46. every other live token of the account is invalidated; other accounts are untouched', async () => {
  const { r, user, token } = await withLink();
  const other = await r.world.seedUser({ email: 'otra@example.com' });
  await r.request('otra@example.com');
  // Un segundo token vigente de la misma cuenta (no deberia existir por la
  // politica, pero si existiera, tampoco puede sobrevivir al restablecimiento).
  r.world.state.tokens.push({
    id: 'stray',
    userId: user.id,
    tokenHash: 'stray-hash',
    createdAt: new Date(r.world.clock.now),
    expiresAt: new Date(r.world.clock.now.getTime() + PASSWORD_RESET_TTL_MS),
    consumedAt: null,
    invalidatedAt: null
  });

  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  assert.equal(r.world.liveTokens(user.id).length, 0);
  assert.equal(r.world.liveTokens(other.id).length, 1, 'el token de OTRA cuenta sigue vigente');
  assert.equal(credentialOf(r, other.id).sessionVersion, 0);
});

test('47. the new password is hashed with the existing scrypt mechanism', async () => {
  const { r, user, token } = await withLink();

  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  const stored = credentialOf(r, user.id).passwordHash;
  assert.match(stored, /^scrypt:v1:16384:8:1:[0-9a-f]+:[0-9a-f]+$/);
  assert.notEqual(stored, NEW_PASSWORD);
  assert.ok(!stored.includes(NEW_PASSWORD));
  assert.ok(await verifyPasswordHash(NEW_PASSWORD, stored));
});

test('48. confirm creates no session: the response carries no token of any kind', async () => {
  const { r, token } = await withLink();

  const response = await r.service.confirmReset({ token, password: NEW_PASSWORD });

  assert.deepEqual(response, { status: 'password_reset' });
  assert.deepEqual(Object.keys(response), ['status']);
});

test('the client cannot choose WHO is reset: extra userId / email fields are ignored', async () => {
  const { r, user, token } = await withLink();
  const victim = await r.world.seedUser({ email: 'victima@example.com', password: OLD_PASSWORD });
  const victimHash = credentialOf(r, victim.id).passwordHash;

  await r.service.confirmReset({
    token,
    password: NEW_PASSWORD,
    userId: victim.id,
    email: 'victima@example.com',
    sessionVersion: 99
  });

  assert.equal(credentialOf(r, victim.id).passwordHash, victimHash, 'la victima no cambio');
  assert.equal(credentialOf(r, victim.id).sessionVersion, 0);
  assert.equal(credentialOf(r, user.id).sessionVersion, 1, 'cambio la dueña del token, +1');
});

// ---------------------------------------------------------------------------
// 49-53. Aceptacion de punta a punta con AuthService y JwtService reales
// ---------------------------------------------------------------------------

test('49-53. old password rejected, new accepted, old JWT rejected, new JWT accepted, other user untouched, token not reusable', async () => {
  const { r, token } = await withLink();
  const bystander = await r.world.seedUser({ email: 'tercero@example.com', password: 'BystanderPass1' });
  const auth = new AuthService(r.world.prisma as never, new JwtService({}));

  const oldSession = await auth.login({ email: EMAIL, password: OLD_PASSWORD });
  const bystanderSession = await auth.login({ email: 'tercero@example.com', password: 'BystanderPass1' });
  assert.equal((await auth.resolveAuthenticatedUser(oldSession.accessToken)).email, EMAIL);

  await r.service.confirmReset({ token, password: NEW_PASSWORD });

  // 49. contrasena anterior: rechazada.
  await assert.rejects(
    auth.login({ email: EMAIL, password: OLD_PASSWORD }),
    (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401
  );
  // 50. contrasena nueva: aceptada, y su JWT lleva la version nueva.
  const newSession = await auth.login({ email: EMAIL, password: NEW_PASSWORD });
  assert.equal(new JwtService({}).decode(newSession.accessToken).sv, 1);
  // 51. JWT anterior: rechazado, con el mensaje de siempre.
  await assert.rejects(
    auth.resolveAuthenticatedUser(oldSession.accessToken),
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      error.getStatus() === 401 &&
      error.message === 'Token invalido o expirado.'
  );
  // 52. JWT nuevo: aceptado.
  assert.equal((await auth.resolveAuthenticatedUser(newSession.accessToken)).email, EMAIL);
  // 53. otro usuario: ni su sesion ni su contrasena se afectaron.
  assert.equal(
    (await auth.resolveAuthenticatedUser(bystanderSession.accessToken)).id,
    bystander.id
  );
  await auth.login({ email: 'tercero@example.com', password: 'BystanderPass1' });
  // El token consumido no se reutiliza.
  assertInvalidToken(
    await rejection(r.service.confirmReset({ token, password: 'AnotherPassword789' }))
  );
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

test('confirm and verify log operational events without secrets', async () => {
  const { r, token } = await withLink();
  const start = logs.length;

  await r.service.verifyToken({ token });
  await rejection(r.service.confirmReset({ token: generatePasswordResetToken(), password: NEW_PASSWORD }));
  await r.service.confirmReset({ token, password: NEW_PASSWORD });
  await rejection(r.service.confirmReset({ token, password: NEW_PASSWORD }));

  const written = logs.slice(start).join('\n');
  assert.match(written, /confirm\.succeeded/);
  for (const secret of [token, hashPasswordResetToken(token), NEW_PASSWORD, EMAIL]) {
    assert.ok(!written.includes(secret), secret.slice(0, 12));
  }
  assert.doesNotMatch(written, /scrypt:v1/);
});
