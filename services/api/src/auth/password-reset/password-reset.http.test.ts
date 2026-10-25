/**
 * Superficie HTTP REAL de la recuperacion de contrasena (16.7).
 *
 * Levanta un servidor Nest en 127.0.0.1 con puerto efimero, con el `AuthModule`
 * real (controllers, guards de throttling, `MailModule`, `JwtModule`), y hace
 * requests de verdad. Lo unico simulado es la base: el doble de Prisma con estado.
 *
 * Aca se congelan el status code y el contrato que recibe el CLIENTE, la
 * configuracion del throttler (incluido el contador compartido), la politica de
 * proxy y el recorrido completo. Las garantias de PostgreSQL NO se prueban aca:
 * ver `password-reset.pg.test.ts`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { LogMailTransport } from '../../mail/log-mail-transport';
import {
  REQUEST_THROTTLE_LIMIT,
  TOKEN_THROTTLE_LIMIT
} from './password-reset.limits';
import { generatePasswordResetToken, hashPasswordResetToken } from './password-reset-token';
import { startApp, withApp, type Server } from './__fixtures__/nest-app';
import {
  LINK_PATTERN,
  NEW_PASSWORD,
  OLD_PASSWORD,
  WEB_ORIGIN,
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
installLogCapture();

const EMAIL = 'ada@example.com';
const RECOVERY = '/auth/password-reset';

const LOG = { mailTransport: 'log' } as const;

function tokenFrom(server: Server): string {
  const message = (server.transport as unknown as LogMailTransport).outbox.at(-1);
  assert.ok(message, 'no hay correo en la bandeja');
  const match = LINK_PATTERN.exec(message.text);
  assert.ok(match);
  return match[1];
}

const STABLE_HEADERS = (headers: Headers) =>
  Object.fromEntries(
    [...headers.entries()].filter(
      ([name]) => !['date', 'x-ratelimit-remaining', 'x-ratelimit-reset'].includes(name)
    )
  );

// ---------------------------------------------------------------------------
// POST /auth/password-reset/request
// ---------------------------------------------------------------------------

test('request: 202 with exactly { status: "requested" } and no-store', async () => {
  await withApp(LOG, async (server) => {
    await server.world.seedUser({ email: EMAIL });

    const response = await server.post(`${RECOVERY}/request`, { email: EMAIL });

    assert.equal(response.status, 202);
    assert.deepEqual(response.json, { status: 'requested' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  });
});

test('14. request is byte-for-byte identical for an existing and a nonexistent account', async () => {
  await withApp(LOG, async (server) => {
    await server.world.seedUser({ email: EMAIL });

    const existing = await server.post(`${RECOVERY}/request`, { email: EMAIL });
    const missing = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' });
    // Tercera: la cuenta existente, ahora en cooldown.
    const cooling = await server.post(`${RECOVERY}/request`, { email: EMAIL });

    for (const other of [missing, cooling]) {
      assert.equal(other.status, existing.status);
      assert.equal(other.text, existing.text);
      assert.deepEqual(STABLE_HEADERS(other.headers), STABLE_HEADERS(existing.headers));
    }
  });
});

test('request: a malformed email is 400 INVALID_EMAIL with the public error shape', async () => {
  await withApp(LOG, async (server) => {
    const response = await server.post(`${RECOVERY}/request`, { email: 'no-es-un-email' });

    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.json!).sort(), ['code', 'message']);
    assert.equal(response.json!.code, 'INVALID_EMAIL');
  });
});

test('request: a missing, non-JSON or non-object body is 400 INVALID_REQUEST_INPUT (Express 5 leaves body undefined)', async () => {
  await withApp(LOG, async (server) => {
    const noBody = await server.post(`${RECOVERY}/request`);
    assert.equal(noBody.status, 400);
    assert.equal(noBody.json!.code, 'INVALID_REQUEST_INPUT');

    const plainText = await server.post(`${RECOVERY}/request`, 'ada@example.com', {
      'content-type': 'text/plain'
    });
    assert.equal(plainText.status, 400);
    assert.equal(plainText.json!.code, 'INVALID_REQUEST_INPUT');

    // Un array llega a nuestro validador; el resto (string, null, numero) los corta
    // el parser JSON ESTRICTO de Express antes, con su propio 400. En ningun caso se
    // coerciona ni se llega a un 500.
    const array = await server.post(`${RECOVERY}/request`, '[]');
    assert.equal(array.status, 400);
    assert.equal(array.json!.code, 'INVALID_REQUEST_INPUT');

    for (const body of ['"ada@example.com"', 'null', '123']) {
      const response = await server.post(`${RECOVERY}/request`, body);
      assert.equal(response.status, 400, body);
    }

    // JSON roto: lo corta el parser antes de nuestro codigo. 400, nunca 500.
    const broken = await server.post(`${RECOVERY}/request`, '{"email": ');
    assert.equal(broken.status, 400);
  });
});

test('request: 503 PASSWORD_RECOVERY_UNAVAILABLE when no mail transport is configured, and nothing is created', async () => {
  await withApp({}, async (server) => {
    await server.world.seedUser({ email: EMAIL });

    const response = await server.post(`${RECOVERY}/request`, { email: EMAIL });

    assert.equal(response.status, 503);
    assert.equal(response.json!.code, 'PASSWORD_RECOVERY_UNAVAILABLE');
    assert.equal(server.transport.kind, 'disabled');
    assert.equal(server.tasks.pending, 0);
    assert.equal(server.world.state.tokens.length, 0);
    assert.equal(server.world.statements.length, 0);
  });
});

test('request: MAIL_TRANSPORT=log with NODE_ENV=production boots, resolves to disabled, and answers 503', async () => {
  await withApp({ mailTransport: 'log', nodeEnv: 'production' }, async (server) => {
    await server.world.seedUser({ email: EMAIL });

    const response = await server.post(`${RECOVERY}/request`, { email: EMAIL });

    assert.equal(server.transport.kind, 'disabled', 'el transporte de desarrollo NO se instancio');
    assert.equal(response.status, 503);
    assert.equal(response.json!.code, 'PASSWORD_RECOVERY_UNAVAILABLE');
    assert.equal(server.world.state.tokens.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting por IP
// ---------------------------------------------------------------------------

test('throttle: request allows 5 per window and the 6th is 429 TOO_MANY_REQUESTS with Retry-After', async () => {
  await withApp(LOG, async (server) => {
    for (let attempt = 1; attempt <= REQUEST_THROTTLE_LIMIT; attempt += 1) {
      const ok = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' });
      assert.equal(ok.status, 202, `intento ${attempt}`);
    }

    const blocked = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' });

    assert.equal(blocked.status, 429);
    assert.deepEqual(Object.keys(blocked.json!).sort(), ['code', 'message']);
    assert.equal(blocked.json!.code, 'TOO_MANY_REQUESTS');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
});

test('throttle: the limit counts attempts BEFORE validation -- invalid bodies burn the budget too', async () => {
  await withApp(LOG, async (server) => {
    for (let attempt = 0; attempt < REQUEST_THROTTLE_LIMIT; attempt += 1) {
      assert.equal((await server.post(`${RECOVERY}/request`, { email: 'roto' })).status, 400);
    }

    assert.equal((await server.post(`${RECOVERY}/request`, { email: 'roto' })).status, 429);
  });
});

test('throttle: verify and confirm share ONE counter of 20, separate from request', async () => {
  await withApp(LOG, async (server) => {
    const bogus = generatePasswordResetToken();

    // 10 verify + 10 confirm = 20 intentos del contador compartido.
    for (let attempt = 0; attempt < TOKEN_THROTTLE_LIMIT / 2; attempt += 1) {
      assert.equal((await server.post(`${RECOVERY}/verify`, { token: bogus })).status, 400);
      assert.equal(
        (await server.post(`${RECOVERY}/confirm`, { token: bogus, password: NEW_PASSWORD })).status,
        400
      );
    }

    // El 21 -- sea cual sea el endpoint -- esta bloqueado: NO son dos contadores.
    const verify = await server.post(`${RECOVERY}/verify`, { token: bogus });
    const confirm = await server.post(`${RECOVERY}/confirm`, { token: bogus, password: NEW_PASSWORD });
    assert.equal(verify.status, 429);
    assert.equal(verify.json!.code, 'TOO_MANY_REQUESTS');
    assert.equal(confirm.status, 429);

    // Y request tiene su propio contador: sigue disponible.
    assert.equal((await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 202);
  });
});

test('throttle: 20 verifies alone also exhaust the shared counter for confirm', async () => {
  await withApp(LOG, async (server) => {
    const bogus = generatePasswordResetToken();

    for (let attempt = 0; attempt < TOKEN_THROTTLE_LIMIT; attempt += 1) {
      await server.post(`${RECOVERY}/verify`, { token: bogus });
    }

    const confirm = await server.post(`${RECOVERY}/confirm`, { token: bogus, password: NEW_PASSWORD });
    assert.equal(confirm.status, 429);
  });
});

test('throttle: it is scoped to recovery -- login and the protected API are NOT limited', async () => {
  await withApp(LOG, async (server) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const login = await server.post('/auth/login', { email: 'nadie@example.com', password: 'whatever123' });
      assert.equal(login.status, 401, `login ${attempt}`);
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      assert.equal((await server.get('/probe')).status, 401);
    }

    // Y no gastaron el presupuesto de recuperacion.
    assert.equal((await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 202);
  });
});

// ---------------------------------------------------------------------------
// Politica de proxy
// ---------------------------------------------------------------------------

test('proxy 0 (direct): X-Forwarded-For is IGNORED -- a client cannot pick its own counter', async () => {
  await withApp({ ...LOG, hops: 0 }, async (server) => {
    for (let attempt = 1; attempt <= REQUEST_THROTTLE_LIMIT; attempt += 1) {
      const ok = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' }, {
        'x-forwarded-for': `198.51.100.${attempt}`
      });
      assert.equal(ok.status, 202);
    }

    // Una "IP nueva" declarada en el encabezado no abre un contador nuevo.
    const spoofed = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' }, {
      'x-forwarded-for': '203.0.113.200'
    });
    assert.equal(spoofed.status, 429);
  });
});

test('proxy 1 (behind the ALB): distinct client IPs get distinct counters', async () => {
  await withApp({ ...LOG, hops: 1 }, async (server) => {
    const from = (ip: string) =>
      server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' }, { 'x-forwarded-for': ip });

    for (let attempt = 0; attempt < REQUEST_THROTTLE_LIMIT; attempt += 1) {
      assert.equal((await from('198.51.100.1')).status, 202);
    }
    assert.equal((await from('198.51.100.1')).status, 429, 'la misma IP comparte contador');
    assert.equal((await from('198.51.100.2')).status, 202, 'otra IP tiene el suyo');
    assert.equal((await from('2001:db8::1')).status, 202, 'tambien una IPv6');
  });
});

test('proxy 1: a spoofed LEFT-hand X-Forwarded-For entry cannot dodge the limit -- the proxy-appended entry decides', async () => {
  await withApp({ ...LOG, hops: 1 }, async (server) => {
    // El ALB agrega la IP real (203.0.113.9) a la DERECHA; el cliente escribe lo que
    // quiera a la izquierda. Express cuenta desde la derecha.
    for (let attempt = 0; attempt < REQUEST_THROTTLE_LIMIT; attempt += 1) {
      const ok = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' }, {
        'x-forwarded-for': `10.0.0.${attempt}, 203.0.113.9`
      });
      assert.equal(ok.status, 202);
    }

    const evaded = await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' }, {
      'x-forwarded-for': '192.0.2.77, 203.0.113.9'
    });
    assert.equal(evaded.status, 429);
  });
});

test('proxy 1 without X-Forwarded-For falls back to the socket address, and still counts', async () => {
  await withApp({ ...LOG, hops: 1 }, async (server) => {
    for (let attempt = 0; attempt < REQUEST_THROTTLE_LIMIT; attempt += 1) {
      assert.equal((await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 202);
    }

    assert.equal((await server.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 429);
  });
});

test('throttle storage is per process: a second app instance starts with empty counters', async () => {
  // Congela la limitacion documentada: el contador NO es distribuido.
  await withApp(LOG, async (first) => {
    for (let attempt = 0; attempt <= REQUEST_THROTTLE_LIMIT; attempt += 1) {
      await first.post(`${RECOVERY}/request`, { email: 'nadie@example.com' });
    }
    assert.equal((await first.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 429);

    await withApp(LOG, async (second) => {
      assert.equal((await second.post(`${RECOVERY}/request`, { email: 'nadie@example.com' })).status, 202);
    });
  });
});

// ---------------------------------------------------------------------------
// verify / confirm: contrato
// ---------------------------------------------------------------------------

test('verify: 200 { status: "valid" } for a live token, 400 PASSWORD_RESET_TOKEN_INVALID otherwise', async () => {
  await withApp(LOG, async (server) => {
    await server.world.seedUser({ email: EMAIL });
    await server.post(`${RECOVERY}/request`, { email: EMAIL });
    await server.tasks.idle();
    const token = tokenFrom(server);

    const valid = await server.post(`${RECOVERY}/verify`, { token });
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.json, { status: 'valid' });
    assert.equal(valid.headers.get('cache-control'), 'no-store');

    for (const bad of [generatePasswordResetToken(), 'corto', `${token.slice(0, -1)}!`]) {
      const invalid = await server.post(`${RECOVERY}/verify`, { token: bad });
      assert.equal(invalid.status, 400);
      assert.deepEqual(invalid.json, {
        code: 'PASSWORD_RESET_TOKEN_INVALID',
        message: 'Este enlace ya no es válido.'
      });
    }
  });
});

test('confirm: 400 PASSWORD_POLICY_VIOLATION for a short or long password, without consuming the token', async () => {
  await withApp(LOG, async (server) => {
    await server.world.seedUser({ email: EMAIL });
    await server.post(`${RECOVERY}/request`, { email: EMAIL });
    await server.tasks.idle();
    const token = tokenFrom(server);

    for (const password of ['corta', 'x'.repeat(129)]) {
      const response = await server.post(`${RECOVERY}/confirm`, { token, password });
      assert.equal(response.status, 400);
      assert.equal(response.json!.code, 'PASSWORD_POLICY_VIOLATION');
    }

    assert.equal((await server.post(`${RECOVERY}/verify`, { token })).status, 200, 'el token sigue vigente');
  });
});

// ---------------------------------------------------------------------------
// Recorrido completo por HTTP (la demostracion del paso 17, sobre el doble)
// ---------------------------------------------------------------------------

test('full flow over HTTP: request, verify, confirm, then old/new password, old/new JWT, token reuse', async () => {
  await withApp(LOG, async (server) => {
    const user = await server.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
    const bystander = await server.world.seedUser({ email: 'tercero@example.com', password: 'BystanderPass1' });

    // Dos sesiones abiertas antes del restablecimiento.
    const before = await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD });
    const bystanderLogin = await server.post('/auth/login', { email: 'tercero@example.com', password: 'BystanderPass1' });
    assert.equal(before.status, 200);
    const oldJwt = before.json!.accessToken as string;
    const bystanderJwt = bystanderLogin.json!.accessToken as string;
    assert.equal((await server.get('/probe', { authorization: `Bearer ${oldJwt}` })).status, 200);

    // 1-2. Solicitud: 202.
    const requested = await server.post(`${RECOVERY}/request`, { email: EMAIL });
    assert.equal(requested.status, 202);
    await server.tasks.idle();

    // 3-4. El enlace sale por el transporte de desarrollo; se extrae el token.
    const token = tokenFrom(server);
    const email = (server.transport as unknown as LogMailTransport).outbox!.at(-1) as { text: string };
    assert.ok(email.text.includes(`${WEB_ORIGIN}/reset-password#token=${token}`));

    // 5-6. Verify: valid, y NO consume.
    const verified = await server.post(`${RECOVERY}/verify`, { token });
    assert.deepEqual(verified.json, { status: 'valid' });

    // 7-8. Confirm: password_reset, sin sesion nueva.
    const confirmed = await server.post(`${RECOVERY}/confirm`, { token, password: NEW_PASSWORD });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.json, { status: 'password_reset' });

    // 9. Contrasena antigua: falla.
    assert.equal((await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status, 401);
    // 10. Contrasena nueva: funciona.
    const after = await server.post('/auth/login', { email: EMAIL, password: NEW_PASSWORD });
    assert.equal(after.status, 200);
    // 11. JWT anterior: 401. El nuevo: 200.
    const stale = await server.get('/probe', { authorization: `Bearer ${oldJwt}` });
    assert.equal(stale.status, 401);
    assert.equal(stale.json!.message, 'Token invalido o expirado.');
    assert.equal(
      (await server.get('/probe', { authorization: `Bearer ${after.json!.accessToken as string}` })).status,
      200
    );
    // Otro usuario: su sesion sigue viva.
    const bystanderProbe = await server.get('/probe', { authorization: `Bearer ${bystanderJwt}` });
    assert.equal(bystanderProbe.status, 200);
    assert.equal(bystanderProbe.json!.id, bystander.id);
    // 12. Reutilizar el token: falla.
    const reused = await server.post(`${RECOVERY}/confirm`, { token, password: 'AnotherPassword789' });
    assert.equal(reused.status, 400);
    assert.equal(reused.json!.code, 'PASSWORD_RESET_TOKEN_INVALID');

    assert.equal(user.id.length > 0, true);
  });
});

test('no recovery response ever contains the token, its hash, the email, the user id or the new password', async () => {
  await withApp(LOG, async (server) => {
    const user = await server.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });

    const bodies: string[] = [];
    const record = async (promise: ReturnType<Server['post']>) => {
      const response = await promise;
      bodies.push(response.text, JSON.stringify([...response.headers.entries()]));
      return response;
    };

    await record(server.post(`${RECOVERY}/request`, { email: EMAIL }));
    await server.tasks.idle();
    const token = tokenFrom(server);
    await record(server.post(`${RECOVERY}/verify`, { token }));
    await record(server.post(`${RECOVERY}/confirm`, { token, password: NEW_PASSWORD }));
    await record(server.post(`${RECOVERY}/confirm`, { token, password: NEW_PASSWORD }));
    await record(server.post(`${RECOVERY}/verify`, { token: generatePasswordResetToken() }));

    const everything = bodies.join('\n');
    for (const secret of [token, hashPasswordResetToken(token), EMAIL, user.id, NEW_PASSWORD, 'scrypt']) {
      assert.ok(!everything.includes(secret), secret.slice(0, 12));
    }
  });
});
