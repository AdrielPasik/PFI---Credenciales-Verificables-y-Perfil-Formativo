/**
 * ResendMailTransport -- contrato HTTP, clasificacion de errores, idempotencia y
 * privacidad (16.2, 16.3 y 16.4).
 *
 * NINGUNA prueba de este archivo toca la red. Cada transporte recibe un `fetchImpl`
 * simulado, y el `fetch` GLOBAL esta reemplazado por una trampa: si algun camino lo
 * usara por accidente, el test falla en voz alta (y `after` lo verifica).
 *
 * Las aserciones sobre el proveedor se limitan a lo que su documentacion oficial
 * respalda (pagina de errores y guia de claves de idempotencia). Donde la
 * documentacion no dice nada (p. ej. la forma del JSON de error), se prueba que el
 * adaptador NO dependa de eso.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { installLogCapture } from '../auth/password-reset/__fixtures__/recovery-harness';
import { MailDeliveryError, type MailDeliveryFailureKind } from './mail-transport';
import {
  RESEND_ENDPOINT,
  RESEND_TIMEOUT_MS,
  ResendMailTransport,
  classifyTransportFailure,
  readAcceptedId,
  readDocumentedErrorName
} from './resend-mail-transport';

const logs = installLogCapture();

// Trampa: cualquier uso del fetch global en este archivo es un error.
let trapHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  trapHits += 1;
  throw new Error('NETWORK FORBIDDEN IN TESTS');
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(trapHits, 0, 'una prueba llamo al fetch global (red real)');
});

const API_KEY = 're_TEST_SECRET_KEY_do_not_leak_123';
const FROM = 'Scope <no-responder@mail.scopeedu.technology>';
const PROVIDER_ID = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const TOKEN = 'SECRETtokenSECRETtokenSECRETtokenSECRETtoke'; // 43 caracteres
const EMAIL = 'ada.lovelace@example.com';
const LINK = `https://app.scope.test/reset-password#token=${TOKEN}`;

interface Captured {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function stub(respond: (captured: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const captured = { url, init } as Captured;
    calls.push(captured);
    return respond(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = () => new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });

function transport(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof ResendMailTransport>[0]> = {}
) {
  return new ResendMailTransport({
    apiKey: API_KEY,
    from: FROM,
    fetchImpl,
    timeoutMs: 60,
    ...extra
  });
}

function message(overrides: Partial<Parameters<ResendMailTransport['send']>[0]> = {}) {
  return {
    to: EMAIL,
    subject: 'Restablecé tu contraseña de Scope',
    text: `Abrí este enlace: ${LINK}`,
    html: `<p><a href="${LINK}">Restablecer contraseña</a></p>`,
    idempotencyKey: 'password-reset/11111111-1111-4111-8111-111111111111',
    ...overrides
  };
}

async function kindOf(promise: Promise<unknown>): Promise<MailDeliveryFailureKind> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof MailDeliveryError, `no es un MailDeliveryError: ${String(error)}`);
    return error.kind;
  }
  assert.fail('debia fallar');
}

const activeTimers = () =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

// ---------------------------------------------------------------------------
// 16.2 HTTP
// ---------------------------------------------------------------------------

test('11-12. POSTs to the one official endpoint, with no query string', async () => {
  const { fetchImpl, calls } = stub(ok);

  await transport(fetchImpl).send(message());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].url, RESEND_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new URL(calls[0].url).search, '');
});

test('the endpoint is a constant: no option, argument or message can redirect the key elsewhere', async () => {
  const { fetchImpl, calls } = stub(ok);
  const hostile = new ResendMailTransport({
    apiKey: API_KEY,
    from: FROM,
    fetchImpl,
    endpoint: 'https://evil.example/steal',
    baseUrl: 'https://evil.example'
  } as never);

  await hostile.send(message({ to: EMAIL, subject: 'x', url: 'https://evil.example' } as never));

  assert.equal(calls[0].url, RESEND_ENDPOINT);
});

test('13-14. Authorization is a Bearer token and Content-Type is JSON; the key never leaves the header', async () => {
  const { fetchImpl, calls } = stub(ok);

  await transport(fetchImpl).send(message());

  const { headers } = calls[0].init;
  assert.equal(headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(headers['Content-Type'], 'application/json');
  // La key no esta en ningun otro lado: ni URL, ni cuerpo, ni otro encabezado.
  assert.ok(!calls[0].url.includes(API_KEY));
  assert.ok(!String(calls[0].init.body).includes(API_KEY));
  for (const [name, value] of Object.entries(headers)) {
    if (name !== 'Authorization') assert.ok(!value.includes(API_KEY), name);
  }
});

test('15-20. the JSON body carries from, to, subject, html and text -- and nothing else', async () => {
  const { fetchImpl, calls } = stub(ok);
  const input = message();

  await transport(fetchImpl).send(input);

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ['from', 'to', 'subject', 'html', 'text']);
  assert.equal(body.from, FROM);
  assert.deepEqual(body.to, [EMAIL]);
  assert.equal(body.subject, input.subject);
  assert.equal(body.html, input.html);
  assert.equal(body.text, input.text);
  // El mensaje trae la clave de idempotencia; viaja por encabezado, no en el cuerpo.
  assert.ok(!('idempotencyKey' in body));
});

test('the body asks for no tracking and no scheduling: only documented fields, no invented ones', async () => {
  const { fetchImpl, calls } = stub(ok);

  await transport(fetchImpl).send(message());

  const body = String(calls[0].init.body);
  for (const invented of ['track', 'click', 'open', 'scheduled_at', 'tags', 'reply_to', 'attachments', 'template']) {
    assert.ok(!body.includes(`"${invented}`), invented);
  }
});

test('request options: redirects are never followed, and an abort signal is always attached', async () => {
  const { fetchImpl, calls } = stub(ok);

  await transport(fetchImpl).send(message());

  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('23. a 200 with { id } is accepted: send() resolves', async () => {
  for (const status of [200, 201]) {
    const { fetchImpl } = stub(() => new Response(JSON.stringify({ id: PROVIDER_ID }), { status }));

    await assert.doesNotReject(transport(fetchImpl).send(message()));
  }
});

test('24. a 2xx with an unexpected body is AMBIGUOUS: it says "accepted" but nothing confirms it', async () => {
  for (const body of ['', 'not json', '{}', '[]', 'null', '"id"', '{"id":5}', '{"id":""}', '{"id":"<script>alert(1)</script>"}', '{"data":{"id":"x"}}']) {
    const { fetchImpl } = stub(() => new Response(body, { status: 200 }));

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous', body);
  }
});

test('25. an error status is a MailDeliveryError, never a resolved promise', async () => {
  const { fetchImpl } = stub(() => new Response('{}', { status: 422 }));

  await assert.rejects(transport(fetchImpl).send(message()), MailDeliveryError);
});

test('21. the Idempotency-Key header is sent exactly as given', async () => {
  const { fetchImpl, calls } = stub(ok);

  await transport(fetchImpl).send(message({ idempotencyKey: 'password-reset/abc' }));

  assert.equal(calls[0].init.headers['Idempotency-Key'], 'password-reset/abc');
});

test('without an idempotency key the header is simply omitted', async () => {
  const { fetchImpl, calls } = stub(ok);
  const { idempotencyKey: _omitted, ...input } = message();
  void _omitted;

  await transport(fetchImpl).send(input);

  assert.ok(!('Idempotency-Key' in calls[0].init.headers));
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test('22. the same logical message keeps the same key AND the same body, byte for byte', async () => {
  const { fetchImpl, calls } = stub(ok);
  const sender = transport(fetchImpl);
  const input = message();

  await sender.send(input);
  await sender.send({ ...input }); // el "reintento" de la misma autorizacion

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  // Misma clave con otro cuerpo seria un 409 `invalid_idempotent_request`.
  assert.equal(calls[0].init.body, calls[1].init.body);
});

test('different messages carry different keys', async () => {
  const { fetchImpl, calls } = stub(ok);
  const sender = transport(fetchImpl);

  await sender.send(message({ idempotencyKey: 'password-reset/aaaa' }));
  await sender.send(message({ idempotencyKey: 'password-reset/bbbb' }));

  assert.notEqual(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
});

test('the key is exactly within the provider limits: 1..256 characters, no control characters', async () => {
  const sendWith = async (idempotencyKey: string) => {
    const { fetchImpl, calls } = stub(ok);
    const result = await kindOf(transport(fetchImpl).send(message({ idempotencyKey }))).catch(() => 'sent');
    return { result, calls: calls.length };
  };

  assert.deepEqual(await sendWith('k'), { result: 'sent', calls: 1 });
  assert.deepEqual(await sendWith('k'.repeat(256)), { result: 'sent', calls: 1 });
  for (const invalid of ['', 'k'.repeat(257), 'line\nbreak', 'tab\there', 'nul\u0000']) {
    // Fuera de limite: `not_sent` con CERTEZA y sin llamar al proveedor.
    assert.deepEqual(await sendWith(invalid), { result: 'not_sent', calls: 0 }, JSON.stringify(invalid.slice(0, 8)));
  }
});

// ---------------------------------------------------------------------------
// 16.3 Errores: clasificacion
// ---------------------------------------------------------------------------

/**
 * Cada fila es una decision respaldada por la documentacion oficial de Resend (pagina
 * de errores y guia de idempotencia). La clasificacion es por STATUS: el cuerpo de
 * error se prueba tambien vacio e invalido para demostrar que no es necesario.
 */
const STATUS_TABLE: Array<[number, MailDeliveryFailureKind, string]> = [
  [400, 'rejected', 'validation_error / invalid_idempotency_key'],
  [401, 'rejected', 'missing_api_key / restricted_api_key / validation_error (key invalida)'],
  [403, 'rejected', 'dominio no verificado, modo de prueba, key suspendida'],
  [404, 'rejected', 'not_found'],
  [405, 'rejected', 'method_not_allowed'],
  [422, 'rejected', 'missing_required_field / invalid_parameter'],
  [429, 'rejected', 'rate_limit_exceeded / daily_quota_exceeded / monthly_quota_exceeded'],
  [409, 'ambiguous', 'concurrent_idempotent_requests / invalid_idempotent_request'],
  [500, 'ambiguous', 'application_error'],
  [503, 'ambiguous', 'service_unavailable'],
  [502, 'ambiguous', 'no documentado: 5xx'],
  [504, 'ambiguous', 'no documentado: 5xx'],
  [408, 'ambiguous', 'no documentado'],
  [413, 'ambiguous', 'no documentado'],
  [451, 'ambiguous', 'no documentado (la pagina de errores no lo lista)'],
  [301, 'ambiguous', 'redireccion: no se sigue ni se interpreta'],
  [302, 'ambiguous', 'redireccion: no se sigue ni se interpreta']
];

test('30-35. every HTTP status maps to the documented class, whatever the body says', async () => {
  for (const [status, expected, why] of STATUS_TABLE) {
    for (const body of ['', 'not json', '{"name":"validation_error","message":"x"}', '{}']) {
      const { fetchImpl } = stub(() => new Response(body, { status }));

      assert.equal(
        await kindOf(transport(fetchImpl).send(message())),
        expected,
        `${status} (${why}) con cuerpo ${JSON.stringify(body).slice(0, 30)}`
      );
    }
  }
});

test('27-29. an invalid key, a rejected sender and provider rate limiting are all REJECTED', async () => {
  const cases: Array<[number, string]> = [
    [401, 'validation_error'], // key inexistente / eliminada / inactiva
    [403, 'validation_error'], // dominio de `from` sin verificar
    [429, 'rate_limit_exceeded'],
    [429, 'daily_quota_exceeded'],
    [429, 'monthly_quota_exceeded']
  ];

  for (const [status, name] of cases) {
    const { fetchImpl } = stub(() => new Response(JSON.stringify({ name, message: 'x' }), { status }));

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'rejected', `${status} ${name}`);
  }
});

test('32. a 409 is AMBIGUOUS for both documented idempotency errors: another request with that key exists', async () => {
  for (const name of ['concurrent_idempotent_requests', 'invalid_idempotent_request']) {
    const { fetchImpl } = stub(() => new Response(JSON.stringify({ name, message: 'x' }), { status: 409 }));

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous', name);
  }
});

test('33. HTTP 422 is rejected (documented: missing or invalid fields)', async () => {
  const { fetchImpl } = stub(() => new Response('{"name":"missing_required_field"}', { status: 422 }));

  assert.equal(await kindOf(transport(fetchImpl).send(message())), 'rejected');
});

test('36. a timeout after the request started is AMBIGUOUS, and it really aborts', async () => {
  let aborted = false;
  const fetchImpl = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('This operation was aborted', 'AbortError'));
      });
    })) as unknown as typeof fetch;
  const started = Date.now();

  assert.equal(await kindOf(transport(fetchImpl, { timeoutMs: 40 }).send(message())), 'ambiguous');

  assert.equal(aborted, true, 'el AbortController corto la llamada');
  assert.ok(Date.now() - started < 1_000, 'no espero indefinidamente');
});

test('the default timeout is 10 seconds', () => {
  assert.equal(RESEND_TIMEOUT_MS, 10_000);
});

test('37. a connection closed mid-flight is AMBIGUOUS (it may have been accepted)', async () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ETIMEDOUT']) {
    const fetchImpl = (() =>
      Promise.reject(
        new TypeError('fetch failed', { cause: Object.assign(new Error('read'), { code }) })
      )) as unknown as typeof fetch;

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous', code);
  }
});

test('26. a failure BEFORE any byte is written (DNS, refused, bad certificate) is NOT_SENT', async () => {
  for (const code of [
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID'
  ]) {
    const fetchImpl = (() =>
      Promise.reject(
        new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code }) })
      )) as unknown as typeof fetch;

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'not_sent', code);
  }
});

test('26b. local validation failures are NOT_SENT and never reach the network', async () => {
  const bad = [
    message({ to: 'nobody' }),
    message({ to: 'a b@c.co' }),
    message({ to: 'a@b.co, c@d.co' }),
    message({ to: '' }),
    message({ subject: '' }),
    message({ subject: 'two\nlines' }),
    message({ html: '' }),
    message({ text: '' })
  ];

  for (const input of bad) {
    const { fetchImpl, calls } = stub(ok);

    assert.equal(await kindOf(transport(fetchImpl).send(input)), 'not_sent', JSON.stringify(input.to + input.subject));
    assert.equal(calls.length, 0, 'no se llamo al proveedor');
  }
});

test('26c. a transport built without key or sender refuses to send (defence in depth)', async () => {
  for (const broken of [{ apiKey: '' }, { from: '' }]) {
    const { fetchImpl, calls } = stub(ok);

    assert.equal(await kindOf(transport(fetchImpl, broken).send(message())), 'not_sent');
    assert.equal(calls.length, 0);
  }
});

test('38. an invalid JSON error body does not matter: the status decides', async () => {
  const { fetchImpl } = stub(() => new Response('<html>Bad Gateway</html>', { status: 422 }));

  assert.equal(await kindOf(transport(fetchImpl).send(message())), 'rejected');
});

test('39. an incomplete response (stream dies mid-body) is AMBIGUOUS', async () => {
  const fetchImpl = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":'));
          controller.error(new TypeError('terminated'));
        }
      }),
      { status: 200 }
    )) as unknown as typeof fetch;

  assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous');
});

test('an oversized response body is not interpreted: success status without a readable id is AMBIGUOUS', async () => {
  const { fetchImpl } = stub(() => new Response(`{"id":"${'a'.repeat(100_000)}"}`, { status: 200 }));

  assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous');
});

test('40. an untyped failure (string, plain object, bare Error) is AMBIGUOUS, never a crash', async () => {
  for (const thrown of ['boom', { code: 'WHATEVER' }, new Error('plain'), null, undefined, 42]) {
    const fetchImpl = (() => Promise.reject(thrown)) as unknown as typeof fetch;

    assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous', String(thrown));
  }
});

test('a synchronous throw from fetch is contained too', async () => {
  const fetchImpl = (() => {
    throw new Error('sync boom');
  }) as unknown as typeof fetch;

  assert.equal(await kindOf(transport(fetchImpl).send(message())), 'ambiguous');
});

test('classifyTransportFailure: a nested cause chain is walked, and abort wins over codes', () => {
  const nested = new TypeError('fetch failed', {
    cause: new Error('outer', { cause: Object.assign(new Error('inner'), { code: 'ENOTFOUND' }) })
  });
  assert.equal(classifyTransportFailure(nested).kind, 'not_sent');

  const aborted = new DOMException('aborted', 'AbortError');
  assert.equal(classifyTransportFailure(aborted).kind, 'ambiguous');
  assert.equal(classifyTransportFailure(aborted).reason, 'timeout');
});

test('a thrown MailDeliveryError carries ONLY a fixed message: no provider text', async () => {
  const hostile = JSON.stringify({
    name: 'validation_error',
    message: `Invalid key ${API_KEY} for ${EMAIL}; link ${LINK}`
  });
  const { fetchImpl } = stub(() => new Response(hostile, { status: 422 }));

  const error = await transport(fetchImpl).send(message()).catch((caught) => caught as MailDeliveryError);

  assert.ok(error instanceof MailDeliveryError);
  assert.equal(error.message, 'resend rejected: 422 validation_error');
  for (const secret of [API_KEY, EMAIL, TOKEN, 'Invalid key']) {
    assert.ok(!error.message.includes(secret), secret);
  }
});

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

test('readAcceptedId only trusts a short, clean string id', () => {
  assert.equal(readAcceptedId(`{"id":"${PROVIDER_ID}"}`), PROVIDER_ID);
  for (const bad of ['', '{', '[]', '{"id":""}', '{"id":"short"}', '{"id":"a b c d e f g h"}', `{"id":"${'a'.repeat(65)}"}`, '{"id":1}']) {
    assert.equal(readAcceptedId(bad), null, bad);
  }
});

test('readDocumentedErrorName returns only names from the official list, "unknown" otherwise', () => {
  assert.equal(readDocumentedErrorName('{"name":"validation_error"}'), 'validation_error');
  assert.equal(readDocumentedErrorName('{"name":"concurrent_idempotent_requests"}'), 'concurrent_idempotent_requests');
  for (const bad of ['', 'not json', '{}', '{"name":"made_up_error"}', '{"name":"re_SECRET"}', '{"name":5}', '[]', 'null']) {
    assert.equal(readDocumentedErrorName(bad), 'unknown', bad);
  }
});

// ---------------------------------------------------------------------------
// Temporizadores
// ---------------------------------------------------------------------------

test('no timer or controller outlives the call -- on success, on rejection and on timeout', async () => {
  const before = activeTimers();

  await transport(stub(ok).fetchImpl, { timeoutMs: 5_000 }).send(message());
  await transport(stub(() => new Response('{}', { status: 422 })).fetchImpl, { timeoutMs: 5_000 })
    .send(message())
    .catch(() => undefined);
  await transport(
    ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
      })) as unknown as typeof fetch,
    { timeoutMs: 20 }
  )
    .send(message())
    .catch(() => undefined);
  await transport((() => Promise.reject(new Error('x'))) as unknown as typeof fetch, { timeoutMs: 5_000 })
    .send(message())
    .catch(() => undefined);

  assert.equal(activeTimers(), before, 'quedaron temporizadores activos');
});

// ---------------------------------------------------------------------------
// 16.4 Privacidad
// ---------------------------------------------------------------------------

test('41-47. nothing sensitive reaches the logs on any outcome, even when the provider echoes secrets', async () => {
  const start = logs.length;
  const echo = JSON.stringify({
    name: 'validation_error',
    message: `bad ${API_KEY} to ${EMAIL} body ${LINK} Authorization: Bearer ${API_KEY}`
  });

  const outcomes: Array<() => Promise<unknown>> = [
    () => transport(stub(ok).fetchImpl).send(message()),
    () => transport(stub(() => new Response(echo, { status: 422 })).fetchImpl).send(message()),
    () => transport(stub(() => new Response(echo, { status: 409 })).fetchImpl).send(message()),
    () => transport(stub(() => new Response(echo, { status: 503 })).fetchImpl).send(message()),
    () => transport(stub(() => new Response(echo, { status: 200 })).fetchImpl).send(message()),
    () =>
      transport((() =>
        Promise.reject(new TypeError(`fetch failed ${API_KEY} ${EMAIL} ${LINK}`))) as unknown as typeof fetch).send(message()),
    () => transport(stub(ok).fetchImpl).send(message({ to: 'nobody' }))
  ];

  for (const run of outcomes) await run().catch(() => undefined);

  const written = logs.slice(start).join('\n');
  assert.ok(written.length > 0, 'hay actividad operativa registrada');
  for (const secret of [
    API_KEY,
    'Bearer',
    'Authorization',
    TOKEN,
    'token=',
    LINK,
    EMAIL,
    'ada.lovelace',
    '<a href',
    'Abrí este enlace',
    'Restablecer contraseña',
    'bad re_',
    'html',
    '"to"'
  ]) {
    assert.ok(!written.includes(secret), `el log contiene: ${secret}`);
  }
});

test('the operational log keeps what is useful: outcome, class, HTTP status, duration and correlation', async () => {
  const start = logs.length;
  let tick = 0;
  const timed = (fetchImpl: typeof fetch) => transport(fetchImpl, { now: () => (tick += 137) });

  await timed(stub(ok).fetchImpl).send(message());
  await timed(stub(() => new Response('{"name":"validation_error"}', { status: 422 })).fetchImpl)
    .send(message())
    .catch(() => undefined);
  await timed(stub(() => new Response('{}', { status: 503 })).fetchImpl)
    .send(message())
    .catch(() => undefined);

  const written = logs.slice(start).join('\n');
  assert.match(written, /resend\.accepted \(200, 137ms, key password-reset\/[\w-]+, provider id 49a3999c-/);
  assert.match(written, /resend\.rejected \(422 validation_error, 137ms/);
  assert.match(written, /resend\.ambiguous \(503 unknown, 137ms/);
});

test('"accepted" in the log means accepted by Resend -- the code never claims delivery', async () => {
  const sources = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(`${__dirname}/resend-mail-transport.ts`, 'utf8')
  );
  const code = sources.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  assert.doesNotMatch(code, /delivered|entregad/i);
});
