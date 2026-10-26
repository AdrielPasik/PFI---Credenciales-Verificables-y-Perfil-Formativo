/**
 * Integracion de la configuracion de correo con NestJS y con el dominio (16.1 y 17).
 *
 *   A. El modulo real CARGA con cada configuracion de correo, y el login, el registro
 *      y las rutas protegidas siguen operativos aunque la recuperacion este apagada.
 *   B. El dominio de recuperacion con un Resend SIMULADO: el contrato HTTP completo
 *      desde una solicitud real, y la politica de tokens segun la clase de fallo.
 *
 * `globalThis.fetch` esta reemplazado: cada llamada que no sea al propio servidor de
 * prueba se atiende en memoria. Ningun test de este archivo llega a la red.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { MailDeliveryError, type MailTransport } from '../../mail/mail-transport';
import { ResendMailTransport } from '../../mail/resend-mail-transport';
import { ACCOUNT_COOLDOWN_MS } from './password-reset.limits';
import { hashPasswordResetToken } from './password-reset-token';
import {
  installFetchStub,
  jsonResponse,
  withApp,
  type Server,
  type StartAppOptions
} from './__fixtures__/nest-app';
import {
  OLD_PASSWORD,
  WEB_ORIGIN,
  buildRecovery,
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
const logs = installLogCapture();

const KEY = 're_TEST_SECRET_KEY_do_not_leak_123';
const FROM = 'Scope <no-responder@mail.scopeedu.technology>';
const PROVIDER_ID = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const EMAIL = 'ada@example.com';
const RESEND = { RESEND_API_KEY: KEY, MAIL_FROM: FROM };
const RECOVERY = '/auth/password-reset';

let hostFetch = installFetchStub(() => jsonResponse(200, { id: PROVIDER_ID }));
after(() => hostFetch.restore());

function freshStub(respond: Parameters<typeof installFetchStub>[0]) {
  hostFetch.restore();
  hostFetch = installFetchStub(respond);
  return hostFetch;
}

// ---------------------------------------------------------------------------
// A. El modulo carga con cada configuracion
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  options: StartAppOptions;
  kind: string;
  operational: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: 'default (MAIL_TRANSPORT unset)', options: {}, kind: 'disabled', operational: false },
  { name: 'disabled', options: { mailTransport: 'disabled' }, kind: 'disabled', operational: false },
  { name: 'log in development', options: { mailTransport: 'log' }, kind: 'log', operational: true },
  { name: 'log in production (forbidden)', options: { mailTransport: 'log', nodeEnv: 'production' }, kind: 'disabled', operational: false },
  { name: 'resend, valid', options: { mailTransport: 'resend', env: RESEND }, kind: 'resend', operational: true },
  { name: 'resend, valid, production', options: { mailTransport: 'resend', nodeEnv: 'production', env: RESEND }, kind: 'resend', operational: true },
  { name: 'resend without API key', options: { mailTransport: 'resend', env: { MAIL_FROM: FROM } }, kind: 'disabled', operational: false },
  { name: 'resend with invalid API key', options: { mailTransport: 'resend', env: { RESEND_API_KEY: 'bad key', MAIL_FROM: FROM } }, kind: 'disabled', operational: false },
  { name: 'resend without sender', options: { mailTransport: 'resend', env: { RESEND_API_KEY: KEY } }, kind: 'disabled', operational: false },
  { name: 'resend with invalid sender', options: { mailTransport: 'resend', env: { RESEND_API_KEY: KEY, MAIL_FROM: 'not an address' } }, kind: 'disabled', operational: false },
  { name: 'unknown transport value', options: { mailTransport: 'smtp', env: RESEND }, kind: 'disabled', operational: false }
];

for (const scenario of SCENARIOS) {
  test(`A. the module boots with "${scenario.name}", auth stays fully operational, recovery answers accordingly`, async () => {
    const stub = freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));
    const start = logs.length;

    await withApp(scenario.options, async (server) => {
      // Arranca, y el transporte elegido es el esperado.
      assert.equal(server.transport.kind, scenario.kind);
      assert.equal(server.transport.operational, scenario.operational);

      // Login, registro y una ruta protegida: NUNCA dependen del correo.
      await server.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
      const login = await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD });
      assert.equal(login.status, 200, 'login');
      const registered = await server.post('/auth/register', {
        email: 'nueva.persona@example.com',
        password: 'CorrectHorse123',
        firstName: 'Nueva',
        lastName: 'Persona',
        onboardingIntent: 'personal'
      });
      assert.equal(registered.status, 201, 'registro');
      const probe = await server.get('/probe', { authorization: `Bearer ${login.json!.accessToken as string}` });
      assert.equal(probe.status, 200, 'ruta protegida');
      const registeredProbe = await server.get('/probe', {
        authorization: `Bearer ${registered.json!.accessToken as string}`
      });
      assert.equal(registeredProbe.status, 200, 'sesion recien registrada');

      // La recuperacion responde segun este operativa o no.
      const recovery = await server.post(`${RECOVERY}/request`, { email: EMAIL });
      if (scenario.operational) {
        assert.equal(recovery.status, 202);
        assert.equal(recovery.text, '{"status":"requested"}');
      } else {
        assert.equal(recovery.status, 503);
        assert.equal(recovery.json!.code, 'PASSWORD_RECOVERY_UNAVAILABLE');
        // No se crea ningun token que no pueda entregarse.
        assert.equal(server.world.state.tokens.length, 0);
      }
      await server.tasks.idle();
    });

    // Solo el transporte `resend` hace llamadas salientes; el resto, ninguna.
    assert.equal(stub.calls.length, scenario.kind === 'resend' ? 1 : 0, scenario.name);

    // El arranque con una configuracion invalida deja UN error de configuracion, con
    // texto fijo y sin el valor de ninguna variable.
    const startup = logs.slice(start).join('\n');
    assert.ok(!startup.includes(KEY), 'la API key no aparece en el log');
    if (scenario.name.startsWith('resend') && !scenario.operational) {
      assert.match(startup, /mail\.config_invalid \(resend_(missing|invalid)_(api_key|from)\)/);
    }
  });
}

test('A8. an invalid public web URL makes recovery unavailable (503) without touching login or registration', async () => {
  const original = process.env.WEB_PUBLIC_BASE_URL;
  const stub = freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));

  try {
    for (const value of [undefined, '', 'not a url', 'http://app.scope.test', 'https://app.scope.test/app', 'https://u:p@app.scope.test', 'https://app.scope.test#x']) {
      await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
        await server.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
        if (value === undefined) delete process.env.WEB_PUBLIC_BASE_URL;
        else process.env.WEB_PUBLIC_BASE_URL = value;

        const recovery = await server.post(`${RECOVERY}/request`, { email: EMAIL });
        assert.equal(recovery.status, 503, String(value));
        assert.equal(recovery.json!.code, 'PASSWORD_RECOVERY_UNAVAILABLE');
        assert.equal(server.world.state.tokens.length, 0, 'ni un token');

        assert.equal((await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status, 200);
        assert.equal(
          (await server.post('/auth/register', { email: `n${Math.random().toString(36).slice(2)}@example.com`, password: 'CorrectHorse123', firstName: 'N', lastName: 'P' })).status,
          201
        );
      });
    }
  } finally {
    process.env.WEB_PUBLIC_BASE_URL = original;
  }
  assert.equal(stub.calls.length, 0, 'sin URL valida no se envia nada');
});

// ---------------------------------------------------------------------------
// B. Dominio + Resend simulado, a traves de HTTP real
// ---------------------------------------------------------------------------

async function recoveryRequest(server: Server) {
  await server.world.seedUser({ email: EMAIL, password: OLD_PASSWORD });
  const response = await server.post(`${RECOVERY}/request`, { email: EMAIL });
  await server.tasks.idle();
  return response;
}

test('B1. a real request produces exactly one well-formed call to Resend', async () => {
  const stub = freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));

  await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
    const response = await recoveryRequest(server);

    assert.equal(response.status, 202);
    assert.equal(stub.calls.length, 1);
    const [call] = stub.calls;
    const [row] = server.world.state.tokens;
    const body = JSON.parse(call.body) as Record<string, unknown>;
    const link = /https:\/\/app\.scope\.test\/reset-password#token=([A-Za-z0-9_-]{43})/.exec(String(body.text));
    assert.ok(link, 'el texto lleva el enlace');
    const token = link[1];

    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.equal(call.headers['content-type'], 'application/json');
    assert.equal(call.headers['idempotency-key'], `password-reset/${row.id}`);
    assert.deepEqual(Object.keys(body), ['from', 'to', 'subject', 'html', 'text']);
    assert.equal(body.from, FROM);
    assert.deepEqual(body.to, [EMAIL]);
    assert.equal(body.subject, 'Restablecé tu contraseña de Scope');
    assert.ok(String(body.html).includes(`href="${WEB_ORIGIN}/reset-password#token=${token}"`));

    // La clave es opaca: ni el token, ni su hash, ni el email, ni nada de la persona.
    const key = call.headers['idempotency-key'];
    for (const secret of [token, hashPasswordResetToken(token), EMAIL, 'ada']) {
      assert.ok(!key.includes(secret), `la clave contiene ${secret.slice(0, 8)}`);
    }
    // Y el token NO viaja en ningun encabezado ni en la URL: solo en el cuerpo, donde
    // tiene que estar para que llegue a la persona.
    for (const [name, value] of Object.entries(call.headers)) {
      if (name === 'authorization') continue;
      assert.ok(!value.includes(token), `el token esta en el encabezado ${name}`);
    }
    assert.ok(!call.url.includes(token));

    // El token del correo es el que el flujo existente acepta.
    assert.equal((await server.post(`${RECOVERY}/verify`, { token })).status, 200);
    assert.equal(
      (await server.post(`${RECOVERY}/confirm`, { token, password: 'BrandNewPassword456' })).status,
      200
    );
  });
});

/**
 * La politica de la Etapa 2, intacta: `not_sent` y `rejected` invalidan el token;
 * `ambiguous` lo deja vigente. Esta tabla prueba que el ADAPTADOR comunica la clase
 * correcta y que el dominio actua en consecuencia -- no cambia ninguna de las dos.
 */
const POLICY: Array<[string, () => Response | Promise<Response>, 'invalidated' | 'live']> = [
  ['422 validation', () => jsonResponse(422, { name: 'missing_required_field' }), 'invalidated'],
  ['401 bad key', () => jsonResponse(401, { name: 'validation_error' }), 'invalidated'],
  ['403 unverified domain', () => jsonResponse(403, { name: 'validation_error' }), 'invalidated'],
  ['429 rate limited', () => jsonResponse(429, { name: 'rate_limit_exceeded' }), 'invalidated'],
  ['400 bad request', () => jsonResponse(400, { name: 'validation_error' }), 'invalidated'],
  ['500 provider error', () => jsonResponse(500, { name: 'application_error' }), 'live'],
  ['503 unavailable', () => jsonResponse(503, { name: 'service_unavailable' }), 'live'],
  ['409 concurrent idempotent', () => jsonResponse(409, { name: 'concurrent_idempotent_requests' }), 'live'],
  ['409 invalid idempotent', () => jsonResponse(409, { name: 'invalid_idempotent_request' }), 'live'],
  ['200 without id', () => new Response('{}', { status: 200 }), 'live']
];

for (const [label, respond, outcome] of POLICY) {
  test(`B2. ${label}: the public answer is the same 202 and the token is ${outcome === 'live' ? 'kept live' : 'invalidated'}`, async () => {
    freshStub(respond);

    await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
      const response = await recoveryRequest(server);

      assert.equal(response.status, 202);
      assert.equal(response.text, '{"status":"requested"}', 'idem exito: nada del proveedor');
      const user = server.world.state.users[0];
      const live = server.world.liveTokens(user.id).length;
      assert.equal(live, outcome === 'live' ? 1 : 0);
      assert.equal(server.world.state.tokens.length, 1, 'la fila cuenta para el cupo en ambos casos');
      // El inicio de sesion no se ve afectado por un fallo del proveedor.
      assert.equal((await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status, 200);
    });
  });
}

test('B3. network failures: a refused connection invalidates (nothing left), a reset keeps the token (maybe sent)', async () => {
  const failWith = (code: string) => () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) });
  };

  for (const [code, expected] of [['ENOTFOUND', 0], ['ECONNREFUSED', 0], ['ECONNRESET', 1], ['UND_ERR_SOCKET', 1]] as const) {
    freshStub(failWith(code));

    await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
      const response = await recoveryRequest(server);

      assert.equal(response.status, 202, code);
      assert.equal(server.world.liveTokens(server.world.state.users[0].id).length, expected, code);
    });
  }
});

test('B4. an abort (our timeout) keeps the token live', async () => {
  freshStub(() => {
    throw new DOMException('aborted', 'AbortError');
  });

  await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
    await recoveryRequest(server);

    assert.equal(server.world.liveTokens(server.world.state.users[0].id).length, 1);
  });
});

test('B5. the whole flow works with Resend: request, mail, verify, confirm, login with the new password', async () => {
  const stub = freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));

  await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
    await recoveryRequest(server);
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(JSON.parse(stub.calls[0].body).text)![1];

    assert.equal((await server.post(`${RECOVERY}/confirm`, { token, password: 'BrandNewPassword456' })).status, 200);
    assert.equal((await server.post('/auth/login', { email: EMAIL, password: OLD_PASSWORD })).status, 401);
    assert.equal((await server.post('/auth/login', { email: EMAIL, password: 'BrandNewPassword456' })).status, 200);
  });
});

test('B6. a new authorization gets a NEW key; the same authorization keeps its key across a replay', async () => {
  const stub = freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));
  const transport = new ResendMailTransport({
    apiKey: KEY,
    from: FROM,
    fetchImpl: ((url: string, init: RequestInit) =>
      globalThis.fetch(url, init)) as typeof fetch
  });
  const r = buildRecovery({ transport: transport as MailTransport });
  await r.world.seedUser({ email: EMAIL });

  r.service.requestReset({ email: EMAIL });
  await r.tasks.idle();
  r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  r.service.requestReset({ email: EMAIL });
  await r.tasks.idle();

  assert.equal(stub.calls.length, 2);
  const [first, second] = stub.calls.map((call) => call.headers['idempotency-key']);
  assert.match(first, /^password-reset\/token-\d+$/);
  assert.notEqual(first, second, 'autorizacion nueva = clave nueva');
  assert.equal(r.world.state.tokens[0].id, first.replace('password-reset/', ''));

  // Reenviar EL MISMO mensaje (mismo token, misma clave) repite clave y cuerpo exactos.
  const replay = JSON.parse(stub.calls[0].body);
  await transport.send({
    to: EMAIL,
    subject: replay.subject,
    html: replay.html,
    text: replay.text,
    idempotencyKey: first
  });
  assert.equal(stub.calls[2].headers['idempotency-key'], first);
  assert.equal(stub.calls[2].body, stub.calls[0].body);
});

// ---------------------------------------------------------------------------
// Privacidad a traves de todo el recorrido
// ---------------------------------------------------------------------------

test('B7. across success and every failure, nothing sensitive reaches the logs or the public responses', async () => {
  const start = logs.length;
  const seenBodies: string[] = [];
  const echo = (status: number) => () =>
    jsonResponse(status, { name: 'validation_error', message: `key ${KEY} mail ${EMAIL} Bearer ${KEY}` });

  for (const respond of [() => jsonResponse(200, { id: PROVIDER_ID }), echo(422), echo(503), echo(409)]) {
    freshStub(respond);
    await withApp({ mailTransport: 'resend', env: RESEND }, async (server) => {
      const response = await recoveryRequest(server);
      seenBodies.push(response.text, JSON.stringify([...response.headers.entries()]));
      // El token del correo es el unico secreto "vivo": no puede estar en los logs.
      const body = JSON.parse(hostFetch.calls.at(-1)!.body) as { text: string };
      seenBodies.push(/#token=([A-Za-z0-9_-]{43})/.exec(body.text)![1]);
    });
  }

  const written = logs.slice(start).join('\n');
  const tokens = seenBodies.filter((value) => /^[A-Za-z0-9_-]{43}$/.test(value));
  assert.equal(tokens.length, 4);

  for (const token of tokens) {
    assert.ok(!written.includes(token), 'un token aparece en el log');
    assert.ok(!written.includes(hashPasswordResetToken(token)), 'un hash aparece en el log');
  }
  for (const secret of [KEY, 'Bearer', 'Authorization', EMAIL, 'reset-password#token', 'key re_']) {
    assert.ok(!written.includes(secret), `el log contiene: ${secret}`);
    assert.ok(!seenBodies.filter((v) => !/^[A-Za-z0-9_-]{43}$/.test(v)).join('\n').includes(secret), `una respuesta publica contiene: ${secret}`);
  }
  assert.match(written, /resend\.accepted/);
  assert.match(written, /resend\.rejected/);
  assert.match(written, /resend\.ambiguous/);
});

test('B8. only the development transport can ever print a recovery link', async () => {
  const start = logs.length;
  freshStub(() => jsonResponse(200, { id: PROVIDER_ID }));

  for (const options of [{ mailTransport: 'resend', env: RESEND }, { mailTransport: 'disabled' }, { mailTransport: 'log', nodeEnv: 'production' }] as const) {
    await withApp(options, async (server) => {
      await recoveryRequest(server);
    });
  }

  assert.ok(!logs.slice(start).join('\n').includes('reset-password#token'));
});

// Evita un MailDeliveryError "colgado" sin usar si cambia la clasificacion.
void MailDeliveryError;
