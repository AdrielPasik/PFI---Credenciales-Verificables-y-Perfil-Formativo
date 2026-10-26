/**
 * POST /auth/password-reset/request -- logica de solicitud (16.1 y 16.2).
 *
 * Servicio real + ejecutor de segundo plano real + transporte `log` real, sobre el
 * doble de Prisma con estado. El contrato HTTP (status, cabeceras, throttling) se
 * prueba aparte, contra un servidor Nest real, en `password-reset.http.test.ts`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { UserStatus } from '@prisma/client';

import { DisabledMailTransport } from '../../mail/disabled-mail-transport';
import { MailDeliveryError } from '../../mail/mail-transport';
import {
  ACCOUNT_COOLDOWN_MS,
  ACCOUNT_QUOTA_MAX,
  GLOBAL_QUOTA_MAX,
  PASSWORD_RESET_ISSUE_LOCK_KEY,
  PASSWORD_RESET_TTL_MS
} from './password-reset.limits';
import { hashPasswordResetToken } from './password-reset-token';
import { START, type TokenRow } from './__fixtures__/auth-world';
import {
  WEB_ORIGIN,
  buildRecovery,
  codeOf,
  configureRecoveryEnv,
  installLogCapture,
  statusOf
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
const logs = installLogCapture();

const EMAIL = 'ada@example.com';

const unhandled: unknown[] = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

function fillerTokens(count: number, userIds: () => string, ageMs: number): TokenRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `filler-${index}`,
    userId: userIds(),
    tokenHash: `filler-hash-${ageMs}-${index}`,
    createdAt: new Date(START.getTime() - ageMs),
    expiresAt: new Date(START.getTime() - ageMs + PASSWORD_RESET_TTL_MS),
    consumedAt: null,
    invalidatedAt: null
  }));
}

// ---------------------------------------------------------------------------
// 16.1 Solicitud
// ---------------------------------------------------------------------------

test('1. an eligible email gets exactly one token and one email with a recovery link', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL });

  const response = await r.request(EMAIL);

  assert.deepEqual(response, { status: 'requested' });
  assert.equal(r.world.state.tokens.length, 1);
  assert.equal(r.world.state.tokens[0].userId, user.id);
  assert.equal(r.transport.outbox.length, 1);
  assert.equal(r.transport.outbox[0].to, EMAIL);
  assert.match(
    r.transport.outbox[0].text,
    new RegExp(`${WEB_ORIGIN}/reset-password#token=[A-Za-z0-9_-]{43}`)
  );
  assert.match(r.transport.outbox[0].html, /<a href="https:\/\/app\.scope\.test\/reset-password#token=/);
});

test('2. a nonexistent email creates nothing and sends nothing', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  const response = await r.request('nadie@example.com');

  assert.deepEqual(response, { status: 'requested' });
  assert.equal(r.world.state.tokens.length, 0);
  assert.equal(r.transport.outbox.length, 0);
  // Ni siquiera abre una transaccion ni toma el lock: solo busco la cuenta.
  assert.equal(r.world.rawQueries.length, 0);
});

test('3. an inactive account (suspended / pending / archived) gets nothing', async () => {
  for (const status of [UserStatus.suspended, UserStatus.pending, UserStatus.archived]) {
    const r = buildRecovery();
    await r.world.seedUser({ email: EMAIL, status });

    const response = await r.request(EMAIL);

    assert.deepEqual(response, { status: 'requested' });
    assert.equal(r.world.state.tokens.length, 0, status);
    assert.equal(r.transport.outbox.length, 0, status);
  }
});

test('4. an account without an AuthCredential gets nothing', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL, withCredential: false });

  const response = await r.request(EMAIL);

  assert.deepEqual(response, { status: 'requested' });
  assert.equal(r.world.state.tokens.length, 0);
  assert.equal(r.transport.outbox.length, 0);
});

test('5-6. uppercase letters and surrounding spaces still find the account', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL });

  await r.request('  ADA@Example.COM  ');

  assert.equal(r.world.state.tokens.length, 1);
  assert.equal(r.world.state.tokens[0].userId, user.id);
  assert.equal(r.transport.outbox[0].to, EMAIL);
});

test('7. a malformed email is a 400 INVALID_EMAIL and starts no work at all', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  const bad = [
    '',
    '   ',
    'plain',
    'a@b',
    'a b@c.co',
    'x@@y.co',
    '@y.co',
    `${'a'.repeat(250)}@x.co`, // 256 caracteres
    'a'.repeat(600) // supera el techo de la entrada cruda
  ];

  for (const email of bad) {
    assert.throws(
      () => r.service.requestReset({ email }),
      (error: unknown) => {
        assert.equal(codeOf(error), 'INVALID_EMAIL', JSON.stringify(email.slice(0, 20)));
        assert.equal(statusOf(error), 400);
        return true;
      }
    );
  }

  assert.equal(r.tasks.pending, 0);
  assert.equal(r.world.statements.length, 0);
});

test('8. an incorrect body is a 400 INVALID_REQUEST_INPUT -- no coercion of odd values', async () => {
  const r = buildRecovery();

  const bad: unknown[] = [
    undefined,
    null,
    [],
    ['ada@example.com'],
    'ada@example.com',
    123,
    true,
    {},
    { email: 123 },
    { email: null },
    { email: ['ada@example.com'] },
    { email: { value: 'ada@example.com' } },
    { mail: 'ada@example.com' }
  ];

  for (const body of bad) {
    assert.throws(
      () => r.service.requestReset(body),
      (error: unknown) => {
        assert.equal(codeOf(error), 'INVALID_REQUEST_INPUT', JSON.stringify(body));
        assert.equal(statusOf(error), 400);
        return true;
      }
    );
  }

  assert.equal(r.world.statements.length, 0);
});

test('9. a repeated request during the cooldown creates no second token and no second email', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS - 1_000);
  const response = await r.request(EMAIL);

  assert.deepEqual(response, { status: 'requested' });
  assert.equal(r.world.state.tokens.length, 1);
  assert.equal(r.transport.outbox.length, 1);

  // Pasado el cooldown, vuelve a emitir.
  r.world.clock.advance(2_000);
  await r.request(EMAIL);
  assert.equal(r.world.state.tokens.length, 2);
  assert.equal(r.transport.outbox.length, 2);
});

test('10. the per-account quota (3 per 60 minutes) blocks the fourth, silently', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  for (let issued = 1; issued <= ACCOUNT_QUOTA_MAX; issued += 1) {
    await r.request(EMAIL);
    r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  }
  assert.equal(r.world.state.tokens.length, ACCOUNT_QUOTA_MAX);

  const response = await r.request(EMAIL);

  assert.deepEqual(response, { status: 'requested' }, 'sigue siendo 202, no 429');
  assert.equal(r.world.state.tokens.length, ACCOUNT_QUOTA_MAX);
  assert.equal(r.transport.outbox.length, ACCOUNT_QUOTA_MAX);

  // Pasada la ventana movil, vuelve a emitir.
  r.world.clock.advance(61 * 60 * 1000);
  await r.request(EMAIL);
  assert.equal(r.world.state.tokens.length, ACCOUNT_QUOTA_MAX + 1);
});

test('11. the global cap (80 per rolling 24h) blocks at 80 and allows at 79', async () => {
  // 79 emitidos por otras cuentas hace una hora: todavia entra una mas.
  const allowed = buildRecovery();
  await allowed.world.seedUser({ email: EMAIL });
  allowed.world.state.tokens.push(
    ...fillerTokens(GLOBAL_QUOTA_MAX - 1, () => 'someone-else', 60 * 60 * 1000)
  );
  await allowed.request(EMAIL);
  assert.equal(allowed.transport.outbox.length, 1, '79 + 1 = 80, dentro del tope');

  // 80: el siguiente se descarta, sin enviar nada.
  const blocked = buildRecovery();
  await blocked.world.seedUser({ email: EMAIL });
  blocked.world.state.tokens.push(
    ...fillerTokens(GLOBAL_QUOTA_MAX, () => 'someone-else', 60 * 60 * 1000)
  );
  const response = await blocked.request(EMAIL);
  assert.deepEqual(response, { status: 'requested' });
  assert.equal(blocked.transport.outbox.length, 0);
  assert.equal(blocked.world.state.tokens.length, GLOBAL_QUOTA_MAX);

  // 80 emitidos hace 25 horas: fuera de la ventana, no cuentan.
  const expired = buildRecovery();
  await expired.world.seedUser({ email: EMAIL });
  expired.world.state.tokens.push(
    ...fillerTokens(GLOBAL_QUOTA_MAX, () => 'someone-else', 25 * 60 * 60 * 1000)
  );
  await expired.request(EMAIL);
  assert.equal(expired.transport.outbox.length, 1);
});

test('12. a disabled transport is a 503 and creates NOTHING -- not even a lookup', async () => {
  const r = buildRecovery({ transport: new DisabledMailTransport() });
  await r.world.seedUser({ email: EMAIL });

  assert.throws(
    () => r.service.requestReset({ email: EMAIL }),
    (error: unknown) => {
      assert.equal(codeOf(error), 'PASSWORD_RECOVERY_UNAVAILABLE');
      assert.equal(statusOf(error), 503);
      return true;
    }
  );

  assert.equal(r.world.state.tokens.length, 0);
  assert.equal(r.world.statements.length, 0);
});

test('12b. a missing or invalid WEB_PUBLIC_BASE_URL is a 503 and creates nothing', async () => {
  const original = process.env.WEB_PUBLIC_BASE_URL;

  try {
    for (const value of [undefined, '', 'not a url', 'http://app.scope.test', 'https://app.scope.test/path']) {
      const r = buildRecovery();
      await r.world.seedUser({ email: EMAIL });
      if (value === undefined) {
        delete process.env.WEB_PUBLIC_BASE_URL;
      } else {
        process.env.WEB_PUBLIC_BASE_URL = value;
      }

      assert.throws(
        () => r.service.requestReset({ email: EMAIL }),
        (error: unknown) => {
          assert.equal(codeOf(error), 'PASSWORD_RECOVERY_UNAVAILABLE', String(value));
          return true;
        }
      );
      assert.equal(r.world.state.tokens.length, 0, String(value));
    }
  } finally {
    process.env.WEB_PUBLIC_BASE_URL = original;
  }
});

test('13a. a delivery that provably did not leave (not_sent / rejected) invalidates the token but keeps the quota spent', async () => {
  for (const kind of ['not_sent', 'rejected'] as const) {
    const r = buildRecovery();
    const user = await r.world.seedUser({ email: EMAIL });
    r.behavior.beforeSend = () => {
      throw new MailDeliveryError(kind);
    };

    const response = await r.request(EMAIL);

    assert.deepEqual(response, { status: 'requested' }, kind);
    assert.equal(r.world.state.tokens.length, 1, 'la fila queda: cuenta para el cupo');
    assert.notEqual(r.world.state.tokens[0].invalidatedAt, null, kind);
    assert.equal(r.world.liveTokens(user.id).length, 0, kind);

    // El fallo NO devuelve cupo: un reintento inmediato sigue bloqueado por cooldown.
    r.behavior.beforeSend = () => undefined;
    await r.request(EMAIL);
    assert.equal(r.world.state.tokens.length, 1, kind);
  }
});

test('13b. an AMBIGUOUS delivery (timeout / 5xx) leaves the token live: the email may have arrived', async () => {
  for (const failure of [
    new MailDeliveryError('ambiguous'),
    new Error('socket hang up while sending to ada@example.com') // error no tipado
  ]) {
    const r = buildRecovery();
    const user = await r.world.seedUser({ email: EMAIL });
    r.behavior.beforeSend = () => {
      throw failure;
    };

    const response = await r.request(EMAIL);

    assert.deepEqual(response, { status: 'requested' });
    assert.equal(r.world.liveTokens(user.id).length, 1, 'no se invalida a ciegas');
    assert.equal(r.world.state.tokens[0].invalidatedAt, null);
  }
});

test('14. the public response is identical whether the account exists, is ineligible, or is throttled', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  await r.world.seedUser({ email: 'suspendida@example.com', status: UserStatus.suspended });
  await r.world.seedUser({ email: 'sincred@example.com', withCredential: false });

  const responses = [
    await r.request(EMAIL), // elegible
    await r.request(EMAIL), // cooldown
    await r.request('nadie@example.com'), // inexistente
    await r.request('suspendida@example.com'), // no activa
    await r.request('sincred@example.com') // sin credencial
  ];

  const serialized = new Set(responses.map((response) => JSON.stringify(response)));
  assert.equal(serialized.size, 1);
  assert.equal([...serialized][0], '{"status":"requested"}');
});

test('14b. the response does not wait for the lookup or the send', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  let release!: () => void;
  r.behavior.beforeSend = () => new Promise<void>((resolve) => (release = resolve));

  const response = r.service.requestReset({ email: EMAIL });

  // `requestReset` es SINCRONICA: ya devolvio, y el envio todavia ni empezo.
  assert.deepEqual(response, { status: 'requested' });
  assert.equal(r.world.statements.length, 0, 'ninguna consulta corrio dentro del request');
  assert.equal(r.tasks.pending, 1);

  // El envio sigue colgado: el trabajo esta en vuelo, y la respuesta ya estaba dada.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(r.tasks.pending, 1);
  assert.equal(r.transport.outbox.length, 0);

  release();
  await r.tasks.idle();
  assert.equal(r.transport.outbox.length, 1);
});

test('16. two identical requests produce one token and one email', async () => {
  const sequential = buildRecovery();
  await sequential.world.seedUser({ email: EMAIL });
  await sequential.request(EMAIL);
  await sequential.request(EMAIL);
  assert.equal(sequential.world.state.tokens.length, 1);
  assert.equal(sequential.transport.outbox.length, 1);

  const simultaneous = buildRecovery();
  await simultaneous.world.seedUser({ email: EMAIL });
  simultaneous.service.requestReset({ email: EMAIL });
  simultaneous.service.requestReset({ email: EMAIL });
  await simultaneous.tasks.idle();
  assert.equal(simultaneous.world.state.tokens.length, 1);
  assert.equal(simultaneous.transport.outbox.length, 1);
});

test('17. an unexpected error while processing is contained: no unhandled rejection, no message in the log', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  r.world.failNext(
    'user.findUnique',
    new Error('connection reset while looking up ada@example.com')
  );
  const before = logs.length;
  const rejectionsBefore = unhandled.length;

  const response = r.service.requestReset({ email: EMAIL });
  await r.tasks.idle();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(response, { status: 'requested' });
  assert.equal(unhandled.length, rejectionsBefore, 'ninguna promesa quedo sin manejar');
  const written = logs.slice(before).join('\n');
  assert.match(written, /request\.failed \(Error\)/);
  assert.doesNotMatch(written, /connection reset|ada@example\.com/);
});

test('17b. the background runner survives a task that throws synchronously and one that rejects', async () => {
  const r = buildRecovery();
  const before = unhandled.length;

  r.tasks.run('sync-throw', () => {
    throw new Error('sync boom');
  });
  r.tasks.run('async-reject', () => Promise.reject(new Error('async boom')));
  await r.tasks.idle();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(unhandled.length, before);
  assert.equal(r.tasks.pending, 0);
});

// ---------------------------------------------------------------------------
// 16.2 Generacion y persistencia
// ---------------------------------------------------------------------------

test('18-20. the stored row holds only the SHA-256 of the token -- never the token', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);
  const token = r.lastToken();
  const [row] = r.world.state.tokens;

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(row.tokenHash, hashPasswordResetToken(token));
  assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
  for (const value of Object.values(row)) {
    assert.notEqual(value, token);
    if (typeof value === 'string') assert.ok(!value.includes(token));
  }
});

test('21. a token expires exactly 30 minutes after it was issued', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);
  const [row] = r.world.state.tokens;

  assert.equal(PASSWORD_RESET_TTL_MS, 30 * 60 * 1000);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 30 * 60 * 1000);
  assert.equal(row.createdAt.getTime(), START.getTime());
});

test('22. issuing reads through the indexed shapes the schema defines', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);

  // user por email (unique), y sobre el token: ultimo por (userId, createdAt desc),
  // conteo por (userId, createdAt) y conteo global por (createdAt): los tres indices
  // que definio la migracion de la Etapa 1.
  assert.deepEqual(
    r.world.statements.filter((name) => name !== '$executeRaw'),
    [
      'user.findUnique',
      'passwordResetToken.findFirst',
      'passwordResetToken.count',
      'passwordResetToken.count',
      'passwordResetToken.updateMany',
      'passwordResetToken.deleteMany',
      'passwordResetToken.create'
    ]
  );
});

test('23. a new request invalidates the previous link: only the latest one is live', async () => {
  const r = buildRecovery();
  const user = await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);
  const first = r.lastToken();
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  await r.request(EMAIL);
  const second = r.lastToken();

  assert.notEqual(first, second);
  assert.equal(r.world.state.tokens.length, 2);
  const live = r.world.liveTokens(user.id);
  assert.equal(live.length, 1);
  assert.equal(live[0].tokenHash, hashPasswordResetToken(second));
  const old = r.world.state.tokens.find((row) => row.tokenHash === hashPasswordResetToken(first))!;
  assert.notEqual(old.invalidatedAt, null);
});

test('24-25. neither the cooldown nor the quota generate a token', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL); // emite
  const afterFirst = r.world.state.tokens.length;
  await r.request(EMAIL); // cooldown
  assert.equal(r.world.state.tokens.length, afterFirst);

  // Con la cuota llena y fuera del cooldown, tampoco.
  for (let index = 0; index < ACCOUNT_QUOTA_MAX; index += 1) {
    r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
    await r.request(EMAIL);
  }
  const atQuota = r.world.state.tokens.length;
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  await r.request(EMAIL);
  assert.equal(r.world.state.tokens.length, atQuota);
});

// ---------------------------------------------------------------------------
// Serializacion de la emision y entrega fuera de la transaccion
// ---------------------------------------------------------------------------

test('the issuance takes the advisory lock FIRST, before reading any count', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);

  assert.equal(r.world.rawQueries.length, 1);
  assert.match(r.world.rawQueries[0].sql, /SELECT pg_advisory_xact_lock\(\?::bigint\)/);
  assert.deepEqual(r.world.rawQueries[0].values, [PASSWORD_RESET_ISSUE_LOCK_KEY]);

  const inTransaction = r.world.statements.slice(r.world.statements.indexOf('$executeRaw'));
  assert.equal(inTransaction[0], '$executeRaw');
  assert.equal(inTransaction[1], 'passwordResetToken.findFirst');
});

test('the email is sent AFTER the transaction ends: no lock is held during the provider call', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  await r.request(EMAIL);

  assert.deepEqual(r.openTransactionsAtSend, [0]);
});

test('the lock key is reserved: positive int8, the ASCII of "SCOPEPWR"', () => {
  assert.equal(PASSWORD_RESET_ISSUE_LOCK_KEY, 0x53434f5045505752n);
  assert.equal(
    Buffer.from(PASSWORD_RESET_ISSUE_LOCK_KEY.toString(16), 'hex').toString('ascii'),
    'SCOPEPWR'
  );
  assert.ok(PASSWORD_RESET_ISSUE_LOCK_KEY > 0n && PASSWORD_RESET_ISSUE_LOCK_KEY < 2n ** 63n);
});

// ---------------------------------------------------------------------------
// 15. Logs
// ---------------------------------------------------------------------------

test('15. nothing sensitive reaches the Nest logger across success, drop and failure paths', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  await r.world.seedUser({ email: 'segunda@example.com' });
  const start = logs.length;

  await r.request(EMAIL); // exito
  const token = r.lastToken();
  await r.request(EMAIL); // cooldown
  await r.request('nadie@example.com'); // inexistente
  r.behavior.beforeSend = () => {
    throw new MailDeliveryError('rejected');
  };
  await r.request('segunda@example.com'); // fallo de entrega
  r.behavior.beforeSend = () => {
    throw new Error('provider said: bad address segunda@example.com');
  };
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  await r.request('segunda@example.com'); // fallo no tipado

  const written = logs.slice(start).join('\n');
  assert.ok(written.length > 0, 'se registro actividad operativa');

  for (const secret of [
    token,
    hashPasswordResetToken(token),
    EMAIL,
    'segunda@example.com',
    'nadie@example.com',
    'reset-password#token',
    WEB_ORIGIN,
    'provider said'
  ]) {
    assert.ok(!written.includes(secret), `el log contiene: ${secret.slice(0, 24)}`);
  }
  // Y ningun hash de token en hexadecimal de 64 caracteres, ni un token de 43.
  assert.doesNotMatch(written, /[0-9a-f]{64}/);
  assert.doesNotMatch(written, /[A-Za-z0-9_-]{43}/);
});
