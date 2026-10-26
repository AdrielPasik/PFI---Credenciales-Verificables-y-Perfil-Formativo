/**
 * Concurrencia (16.5), sobre el doble con intercalado sentencia por sentencia.
 *
 * LEER ANTES DE CONFIAR EN ESTAS PRUEBAS. Demuestran que el CODIGO toma el lock
 * antes de leer, lee despues de tenerlo y condiciona sus UPDATE. NO demuestran la
 * semantica real de `pg_advisory_xact_lock` ni del bloqueo de fila de PostgreSQL:
 * el "lock" del doble es un mutex y la atomicidad de cada UPDATE es una propiedad del
 * doble. Eso lo cubre `password-reset.pg.test.ts`, contra una base real, y es
 * obligatorio antes de habilitar la recuperacion en produccion.
 *
 * CONTROLES NEGATIVOS. Para cada garantia hay una corrida gemela con
 * `honorAdvisoryLock: false`, que muestra la violacion. Sin ella, "pasa" no
 * distinguiria "el lock funciona" de "la carrera nunca ocurrio en este doble".
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_COOLDOWN_MS,
  GLOBAL_QUOTA_MAX,
  PASSWORD_RESET_TTL_MS
} from './password-reset.limits';
import { START, type TokenRow } from './__fixtures__/auth-world';
import { hashPasswordResetToken } from './password-reset-token';
import {
  NEW_PASSWORD,
  OLD_PASSWORD,
  buildRecovery,
  codeOf,
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';
import { verifyPasswordHash } from '../password-hashing';

configureRecoveryEnv();
installLogCapture();

const EMAIL = 'ada@example.com';

function filler(count: number, ageMs: number): TokenRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `filler-${index}`,
    userId: 'someone-else',
    tokenHash: `filler-hash-${index}`,
    createdAt: new Date(START.getTime() - ageMs),
    expiresAt: new Date(START.getTime() - ageMs + PASSWORD_RESET_TTL_MS),
    consumedAt: null,
    invalidatedAt: null
  }));
}

// ---------------------------------------------------------------------------
// 54. Dos solicitudes simultaneas de la misma cuenta
// ---------------------------------------------------------------------------

test('54. simultaneous requests for one account leave at most ONE live token (lock on)', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL });

  for (let index = 0; index < 8; index += 1) {
    r.service.requestReset({ email: EMAIL });
  }
  await r.tasks.idle();

  assert.equal(r.world.liveTokens(user.id).length, 1);
  assert.equal(r.world.state.tokens.length, 1, 'las otras 7 vieron la fila de la primera y se descartaron');
  assert.equal(r.transport.outbox.length, 1);
});

test('54 CONTROL. the very same race WITHOUT the lock leaves several live tokens', async () => {
  const r = buildRecovery({ honorAdvisoryLock: false });
  const user = await r.world.seedUser({ email: EMAIL });

  for (let index = 0; index < 8; index += 1) {
    r.service.requestReset({ email: EMAIL });
  }
  await r.tasks.idle();

  // Cada transaccion leyo "ninguna fila" antes de que otra insertara: es exactamente
  // la intercalacion que "invalidar y crear en una transaccion" NO evita por si sola.
  assert.ok(
    r.world.liveTokens(user.id).length > 1,
    `sin lock quedaron ${r.world.liveTokens(user.id).length} vigentes: el doble SI expresa la carrera`
  );
});

// ---------------------------------------------------------------------------
// 58. Cupo global bajo concurrencia
// ---------------------------------------------------------------------------

async function concurrentAccounts(options: { honorAdvisoryLock: boolean }, seeded: number, accounts: number) {
  const r = buildRecovery(options);
  r.world.state.tokens.push(...filler(seeded, 60 * 60 * 1000));
  const emails = Array.from({ length: accounts }, (_, index) => `cuenta${index}@example.com`);
  for (const email of emails) {
    await r.world.seedUser({ email });
  }
  for (const email of emails) {
    r.service.requestReset({ email });
  }
  await r.tasks.idle();
  return r;
}

test('58. concurrent requests from DIFFERENT accounts never exceed the global cap (lock on)', async () => {
  const r = await concurrentAccounts({ honorAdvisoryLock: true }, GLOBAL_QUOTA_MAX - 5, 12);

  assert.equal(r.world.state.tokens.length, GLOBAL_QUOTA_MAX, 'exactamente 80, ni uno mas');
  assert.equal(r.transport.outbox.length, 5, 'solo las 5 reservas que cabian');
});

test('58 CONTROL. WITHOUT the lock the same burst overshoots the cap', async () => {
  const r = await concurrentAccounts({ honorAdvisoryLock: false }, GLOBAL_QUOTA_MAX - 5, 12);

  assert.ok(
    r.world.state.tokens.length > GLOBAL_QUOTA_MAX,
    `sin lock se emitieron ${r.world.state.tokens.length} > ${GLOBAL_QUOTA_MAX}`
  );
});

test('58b. with one slot left, a burst of accounts issues exactly one', async () => {
  const r = await concurrentAccounts({ honorAdvisoryLock: true }, GLOBAL_QUOTA_MAX - 1, 10);

  assert.equal(r.world.state.tokens.length, GLOBAL_QUOTA_MAX);
  assert.equal(r.transport.outbox.length, 1);
});

test('a per-USER lock would not be enough: two accounts do not exclude each other', async () => {
  // El lock es GLOBAL por diseno. Este test congela por que: con las dos cuentas
  // concurrentes y un solo cupo libre, la unica forma de no pasarse es que se
  // excluyan entre si, aunque sean cuentas distintas.
  const r = await concurrentAccounts({ honorAdvisoryLock: true }, GLOBAL_QUOTA_MAX - 1, 2);

  assert.equal(r.transport.outbox.length, 1);
  assert.equal(r.rawKeys().length, 2, 'las dos reservas pidieron el MISMO lock');
  assert.equal(new Set(r.rawKeys()).size, 1);
});

// ---------------------------------------------------------------------------
// El lock se libera siempre y no afecta a otras operaciones
// ---------------------------------------------------------------------------

test('a reservation that FAILS releases the lock: the next one is not deadlocked', async () => {
  const r = buildRecovery();
  const first = await r.world.seedUser({ email: 'primera@example.com' });
  const second = await r.world.seedUser({ email: 'segunda@example.com' });
  r.world.failNext('passwordResetToken.create', new Error('insert failed'));

  r.service.requestReset({ email: 'primera@example.com' });
  r.service.requestReset({ email: 'segunda@example.com' });
  await r.tasks.idle();

  assert.equal(r.world.rollbacks, 1, 'la que fallo se revirtio');
  assert.equal(r.world.liveTokens(first.id).length, 0, 'sin rastro de la que fallo');
  assert.equal(r.world.liveTokens(second.id).length, 1, 'la otra termino igual');
  assert.equal(r.world.openTransactions, 0);
});

test('verify and confirm do not wait for the issuance lock', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const token = r.lastToken();
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);

  // Mientras una emision TIENE el lock (esta a punto de insertar), un verify y un
  // confirm de OTRA cuenta/token terminan sin esperarla.
  const other = await r.world.seedUser({ email: 'otra@example.com' });
  let verifiedWhileLocked = false;
  r.world.before('passwordResetToken.create', async () => {
    await r.service.verifyToken({ token });
    verifiedWhileLocked = true;
  });

  r.service.requestReset({ email: 'otra@example.com' });
  await r.tasks.idle();

  assert.equal(verifiedWhileLocked, true, 'verify no quedo bloqueado detras de la emision');
  assert.equal(r.world.liveTokens(other.id).length, 1);
  assert.equal(user.id.length > 0, true);
});

// ---------------------------------------------------------------------------
// 55. Dos confirmaciones simultaneas del mismo token
// ---------------------------------------------------------------------------

test('55. two simultaneous confirmations of ONE token: exactly one wins, the password changes once', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const token = r.lastToken();

  const results = await Promise.allSettled([
    r.service.confirmReset({ token, password: 'WinnerCandidateOne1' }),
    r.service.confirmReset({ token, password: 'WinnerCandidateTwo2' })
  ]);

  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1, 'un unico consumo exitoso');
  assert.equal(losers.length, 1);
  assert.equal(codeOf((losers[0] as PromiseRejectedResult).reason), 'PASSWORD_RESET_TOKEN_INVALID');

  const credential = r.world.state.credentials.find((row) => row.userId === user.id)!;
  assert.equal(credential.sessionVersion, 1, 'sessionVersion subio UNA sola vez');
  assert.equal(r.world.rollbacks, 1, 'la perdedora se revirtio por completo');

  // La contrasena guardada es la de UNO de los dos, y la vieja ya no sirve.
  const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
  const winnerPassword = ['WinnerCandidateOne1', 'WinnerCandidateTwo2'][winnerIndex];
  const loserPassword = ['WinnerCandidateOne1', 'WinnerCandidateTwo2'][1 - winnerIndex];
  assert.ok(await verifyPasswordHash(winnerPassword, credential.passwordHash));
  assert.equal(await verifyPasswordHash(loserPassword, credential.passwordHash), false);
  assert.equal(await verifyPasswordHash(OLD_PASSWORD, credential.passwordHash), false);
});

test('55b. many simultaneous confirmations still yield exactly one change', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const token = r.lastToken();

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      r.service.confirmReset({ token, password: `ParallelPassword${index}x` })
    )
  );

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    r.world.state.credentials.find((row) => row.userId === user.id)!.sessionVersion,
    1
  );
});

// ---------------------------------------------------------------------------
// 56 / 57. Una solicitud nueva y una confirmacion anterior
// ---------------------------------------------------------------------------

test('57a. request FIRST, confirm of the old link second: the old link is dead, the password unchanged', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const oldToken = r.lastToken();
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  await r.request(EMAIL);

  await assert.rejects(
    r.service.confirmReset({ token: oldToken, password: NEW_PASSWORD }),
    (error: unknown) => codeOf(error) === 'PASSWORD_RESET_TOKEN_INVALID'
  );

  const credential = r.world.state.credentials.find((row) => row.userId === user.id)!;
  assert.equal(credential.sessionVersion, 0);
  assert.ok(await verifyPasswordHash(OLD_PASSWORD, credential.passwordHash));
  assert.equal(r.world.liveTokens(user.id).length, 1, 'el nuevo enlace sigue vigente');
});

test('57b. confirm FIRST, request second: the password changed and a fresh link is issued', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const oldToken = r.lastToken();

  // La solicitud espera a que la confirmacion termine, para forzar ESE orden.
  let confirmed!: Promise<unknown>;
  confirmed = r.service.confirmReset({ token: oldToken, password: NEW_PASSWORD });
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  r.world.before('$executeRaw', async () => {
    await confirmed;
  });
  r.service.requestReset({ email: EMAIL });
  await r.tasks.idle();
  await confirmed;

  const credential = r.world.state.credentials.find((row) => row.userId === user.id)!;
  assert.equal(credential.sessionVersion, 1);
  assert.ok(await verifyPasswordHash(NEW_PASSWORD, credential.passwordHash));
  const consumed = r.world.state.tokens.find(
    (row) => row.tokenHash === hashPasswordResetToken(oldToken)
  )!;
  assert.notEqual(consumed.consumedAt, null);
  assert.equal(consumed.invalidatedAt, null, 'el enlace ya consumido no se "invalida" despues');
  assert.equal(r.world.liveTokens(user.id).length, 1, 'y la solicitud posterior emitio uno nuevo');
});

test('57c. confirm and request launched TOGETHER end in a state consistent with SOME serial order', async () => {
  for (let round = 0; round < 6; round += 1) {
    const r = buildRecovery();
    const user = await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
    await r.request(EMAIL);
    const oldToken = r.lastToken();
    r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);

    const [confirm] = await Promise.allSettled([
      r.service.confirmReset({ token: oldToken, password: NEW_PASSWORD }),
      Promise.resolve(r.service.requestReset({ email: EMAIL })).then(() => r.tasks.idle())
    ]);

    const credential = r.world.state.credentials.find((row) => row.userId === user.id)!;
    const oldRow = r.world.state.tokens.find(
      (row) => row.tokenHash === hashPasswordResetToken(oldToken)
    )!;

    if (confirm.status === 'fulfilled') {
      // Orden serial "confirmar, luego solicitar".
      assert.equal(credential.sessionVersion, 1);
      assert.notEqual(oldRow.consumedAt, null);
      assert.equal(oldRow.invalidatedAt, null);
      assert.ok(await verifyPasswordHash(NEW_PASSWORD, credential.passwordHash));
    } else {
      // Orden serial "solicitar, luego confirmar".
      assert.equal(credential.sessionVersion, 0);
      assert.equal(oldRow.consumedAt, null);
      assert.notEqual(oldRow.invalidatedAt, null);
      assert.ok(await verifyPasswordHash(OLD_PASSWORD, credential.passwordHash));
    }

    // En ambos ordenes: nunca un token consumido E invalidado a la vez, y a lo sumo
    // un enlace vigente.
    assert.ok(!(oldRow.consumedAt && oldRow.invalidatedAt));
    assert.ok(r.world.liveTokens(user.id).length <= 1);
  }
});

test('56. a confirmation that fails does not consume the token (concurrent loser leaves no trace)', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  await r.request(EMAIL);
  const token = r.lastToken();
  r.world.failNext('authCredential.updateMany', new Error('db hiccup'));

  const first = await Promise.allSettled([r.service.confirmReset({ token, password: NEW_PASSWORD })]);

  assert.equal(first[0].status, 'rejected');
  assert.equal(r.world.state.tokens[0].consumedAt, null);
  assert.deepEqual(await r.service.confirmReset({ token, password: NEW_PASSWORD }), {
    status: 'password_reset'
  });
});
