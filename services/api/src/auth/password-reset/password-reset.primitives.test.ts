/**
 * Piezas puras de la recuperacion: token, configuracion de entorno (URL publica,
 * transporte de correo, proxy), plantilla del correo y ejecutor en segundo plano.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { DisabledMailTransport } from '../../mail/disabled-mail-transport';
import { LogMailTransport } from '../../mail/log-mail-transport';
import {
  createMailTransport,
  selectMailTransportKind
} from '../../mail/mail.config';
import { MailDeliveryError } from '../../mail/mail-transport';
import { applyTrustProxy, resolveTrustProxyHops } from '../trust-proxy.config';
import { BackgroundTaskRunner } from './background-task-runner';
import {
  buildPasswordResetLink,
  resolveWebPublicBaseUrl
} from './password-reset.config';
import { buildPasswordResetEmail } from './password-reset-email';
import { MAX_BACKGROUND_TASKS_IN_FLIGHT } from './password-reset.limits';
import {
  PASSWORD_RESET_TOKEN_LENGTH,
  generatePasswordResetToken,
  hashPasswordResetToken,
  normalizePasswordResetToken
} from './password-reset-token';
import { installLogCapture } from './__fixtures__/recovery-harness';

const logs = installLogCapture();

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

test('18. a generated token is 43 base64url characters (256 bits)', () => {
  const token = generatePasswordResetToken();

  assert.equal(token.length, PASSWORD_RESET_TOKEN_LENGTH);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32, '32 bytes = 256 bits');
});

test('19. tokens are unique and use the cryptographic generator, never Math.random', () => {
  const tokens = new Set(Array.from({ length: 5_000 }, () => generatePasswordResetToken()));
  assert.equal(tokens.size, 5_000);

  // Los 6 bits de cada caracter se reparten: ningun caracter domina ni falta.
  const frequency = new Map<string, number>();
  for (const token of tokens) {
    for (const character of token.slice(0, 40)) {
      frequency.set(character, (frequency.get(character) ?? 0) + 1);
    }
  }
  assert.equal(frequency.size, 64, 'aparecen los 64 simbolos del alfabeto');

  const source = readFileSync(join(__dirname, 'password-reset-token.ts'), 'utf8');
  assert.match(source, /randomBytes\(32\)/);
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), /Math\.random/);
});

test('20. only the SHA-256 hex is derived for storage, and it is deterministic', () => {
  const token = generatePasswordResetToken();

  assert.equal(
    hashPasswordResetToken(token),
    createHash('sha256').update(token).digest('hex')
  );
  assert.equal(hashPasswordResetToken(token), hashPasswordResetToken(token));
  assert.notEqual(hashPasswordResetToken(token), hashPasswordResetToken(generatePasswordResetToken()));
  assert.notEqual(hashPasswordResetToken(token), token);
});

test('a value is a token only if it has EXACTLY the right shape -- nothing is coerced', () => {
  const good = generatePasswordResetToken();
  assert.equal(normalizePasswordResetToken(good), good);

  for (const bad of [
    '',
    good.slice(1),
    `${good}a`,
    `${good.slice(0, 42)}+`,
    `${good.slice(0, 42)}=`,
    ` ${good.slice(1)}`,
    'é'.repeat(43),
    'a'.repeat(1_000_000),
    42,
    null,
    undefined,
    [good],
    { toString: () => good },
    Buffer.from(good)
  ]) {
    assert.equal(normalizePasswordResetToken(bad), null);
  }
});

// ---------------------------------------------------------------------------
// WEB_PUBLIC_BASE_URL
// ---------------------------------------------------------------------------

test('WEB_PUBLIC_BASE_URL: https origins are accepted and normalised to an origin', () => {
  for (const [input, origin] of [
    ['https://app.scope.test', 'https://app.scope.test'],
    ['https://app.scope.test/', 'https://app.scope.test'],
    ['  https://app.scope.test  ', 'https://app.scope.test'],
    ['https://APP.Scope.Test:8443', 'https://app.scope.test:8443']
  ]) {
    assert.deepEqual(resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: input }), { ok: true, origin });
  }
});

test('WEB_PUBLIC_BASE_URL: credentials, query, fragment, paths and odd schemes are rejected', () => {
  const rejected: Array<[string | undefined, string]> = [
    [undefined, 'missing'],
    ['', 'missing'],
    ['   ', 'missing'],
    ['no es una url', 'not_a_url'],
    ['app.scope.test', 'not_a_url'],
    ['https://user:secret@app.scope.test', 'has_credentials'],
    ['https://user@app.scope.test', 'has_credentials'],
    ['https://app.scope.test?x=1', 'has_query_or_fragment'],
    ['https://app.scope.test/?x=1', 'has_query_or_fragment'],
    ['https://app.scope.test#frag', 'has_query_or_fragment'],
    ['https://app.scope.test/#', 'has_query_or_fragment'],
    ['https://app.scope.test/?', 'has_query_or_fragment'],
    ['https://app.scope.test/app', 'has_path'],
    ['https://app.scope.test/reset-password', 'has_path'],
    ['javascript:alert(1)', 'unsupported_protocol'],
    ['ftp://app.scope.test', 'unsupported_protocol']
  ];

  for (const [input, reason] of rejected) {
    assert.deepEqual(
      resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: input }),
      { ok: false, reason },
      String(input)
    );
  }
});

test('WEB_PUBLIC_BASE_URL: plain http only for local development, never in production', () => {
  for (const local of [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'http://app.localhost:3000'
  ]) {
    assert.equal(resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: local }).ok, true, local);
  }

  assert.deepEqual(
    resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: 'http://app.scope.test' }),
    { ok: false, reason: 'insecure_non_local_host' }
  );
  // En produccion ni siquiera localhost: un enlace de recuperacion no va en claro.
  for (const local of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    assert.deepEqual(
      resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: local, NODE_ENV: 'production' }),
      { ok: false, reason: 'not_https_in_production' },
      local
    );
  }
  assert.equal(
    resolveWebPublicBaseUrl({ WEB_PUBLIC_BASE_URL: 'https://app.scope.test', NODE_ENV: 'production' }).ok,
    true
  );
});

test('13. the link carries the token in the FRAGMENT, with no email or user id', () => {
  const token = generatePasswordResetToken();

  const link = buildPasswordResetLink('https://app.scope.test', token);

  assert.equal(link, `https://app.scope.test/reset-password#token=${token}`);
  const url = new URL(link);
  assert.equal(url.search, '', 'nada en la query: no viaja al servidor que entrega la pagina');
  assert.equal(url.pathname, '/reset-password');
  assert.equal(url.hash, `#token=${token}`);
  assert.doesNotMatch(link, /@|userId|email/);
});

// ---------------------------------------------------------------------------
// MAIL_TRANSPORT
// ---------------------------------------------------------------------------

test('MAIL_TRANSPORT: the default and any unknown value is "disabled"', () => {
  for (const value of [undefined, '', '  ', 'disabled', 'DISABLED', 'smtp', 'true', '1', 'log;drop', 'sendgrid']) {
    const selection = selectMailTransportKind({ MAIL_TRANSPORT: value });
    assert.equal(selection.kind, 'disabled', String(value));
  }
  assert.equal(selectMailTransportKind({}).downgradeReason, undefined, 'ausente no es un error');
  assert.equal(selectMailTransportKind({ MAIL_TRANSPORT: 'smtp' }).downgradeReason, 'unsupported_value');
  // `resend` ya es un valor soportado: sin su configuracion cae a disabled por OTRO
  // motivo (ver mail.config.test.ts), no por "no soportado".
  assert.equal(
    selectMailTransportKind({ MAIL_TRANSPORT: 'resend' }).downgradeReason,
    'resend_missing_api_key'
  );
});

test('MAIL_TRANSPORT=log works in development and test', () => {
  for (const env of [{ MAIL_TRANSPORT: 'log' }, { MAIL_TRANSPORT: 'LOG', NODE_ENV: 'development' }, { MAIL_TRANSPORT: 'log', NODE_ENV: 'test' }]) {
    assert.equal(selectMailTransportKind(env).kind, 'log');
    assert.ok(createMailTransport(env) instanceof LogMailTransport);
  }
});

test('MAIL_TRANSPORT=log is FORBIDDEN in production: it resolves to a disabled transport, never the log one', () => {
  for (const nodeEnv of ['production', 'PRODUCTION', ' production ']) {
    const downgrades: string[] = [];
    const transport = createMailTransport(
      { MAIL_TRANSPORT: 'log', NODE_ENV: nodeEnv },
      (reason) => downgrades.push(reason)
    );

    assert.ok(!(transport instanceof LogMailTransport), nodeEnv);
    assert.ok(transport instanceof DisabledMailTransport, nodeEnv);
    assert.equal(transport.operational, false);
    assert.deepEqual(downgrades, ['production_forbids_log']);
  }
});

test('a disabled transport refuses to send and says nothing left', async () => {
  const transport = new DisabledMailTransport();

  assert.equal(transport.operational, false);
  await assert.rejects(
    transport.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }),
    (error: unknown) => error instanceof MailDeliveryError && error.kind === 'not_sent'
  );
});

test('the log transport writes the link (the deliberate dev exception) and remembers it', async () => {
  const lines: string[] = [];
  const transport = new LogMailTransport({ write: (line) => lines.push(line) });
  const message = buildPasswordResetEmail({
    to: 'ada@example.com',
    link: 'https://app.scope.test/reset-password#token=abc'
  });

  await transport.send(message);

  assert.equal(transport.operational, true);
  assert.equal(transport.outbox.length, 1);
  assert.match(lines[0], /DEV ONLY/);
  assert.match(lines[0], /reset-password#token=abc/);
});

test('the log transport can simulate delivery failures of every kind', async () => {
  for (const kind of ['not_sent', 'rejected', 'ambiguous'] as const) {
    const transport = new LogMailTransport({
      write: () => undefined,
      beforeSend: () => {
        throw new MailDeliveryError(kind);
      }
    });

    await assert.rejects(
      transport.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' }),
      (error: unknown) => error instanceof MailDeliveryError && error.kind === kind
    );
    assert.equal(transport.outbox.length, 0, 'un envio que fallo no queda en la bandeja');
  }
});

// ---------------------------------------------------------------------------
// TRUST_PROXY_HOPS
// ---------------------------------------------------------------------------

test('TRUST_PROXY_HOPS: unset means 0 -- trust no header', () => {
  assert.equal(resolveTrustProxyHops({}), 0);
  assert.equal(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '' }), 0);
  assert.equal(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '  ' }), 0);
});

test('TRUST_PROXY_HOPS: a valid count is parsed; anything else fails loudly at boot', () => {
  assert.equal(resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1' }), 1);
  assert.equal(resolveTrustProxyHops({ TRUST_PROXY_HOPS: ' 2 ' }), 2);

  for (const bad of ['-1', '1.5', 'abc', 'true', '1e1', '0x1', '11', '99999999999999999999', '1 2']) {
    assert.throws(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: bad }), /TRUST_PROXY_HOPS/, bad);
  }
});

test('applyTrustProxy: 0 leaves Express untouched; N sets exactly N', () => {
  const settings: Array<[string, unknown]> = [];
  const app = { set: (key: string, value: unknown) => settings.push([key, value]) };

  applyTrustProxy(app, 0);
  assert.deepEqual(settings, []);

  applyTrustProxy(app, 1);
  assert.deepEqual(settings, [['trust proxy', 1]]);
});

// ---------------------------------------------------------------------------
// Plantilla: ver password-reset-email.test.ts (contenido, escape, fragmento, sin tracking)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ejecutor en segundo plano
// ---------------------------------------------------------------------------

test('the runner starts a task AFTER the caller returns, never inside it', async () => {
  const runner = new BackgroundTaskRunner();
  const order: string[] = [];

  runner.run('t', async () => {
    order.push('task');
  });
  order.push('caller-returned');

  await runner.idle();
  assert.deepEqual(order, ['caller-returned', 'task']);
});

test('the runner contains errors and logs only the error NAME', async () => {
  const runner = new BackgroundTaskRunner();
  const start = logs.length;

  runner.run('job', async () => {
    throw new TypeError('secret detail: ada@example.com');
  });
  await runner.idle();

  const written = logs.slice(start).join('\n');
  assert.match(written, /job failed \(TypeError\)/);
  assert.doesNotMatch(written, /secret detail|ada@example/);
});

test('the runner caps tasks in flight and drops the excess without throwing', async () => {
  const runner = new BackgroundTaskRunner();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let ran = 0;

  for (let index = 0; index < MAX_BACKGROUND_TASKS_IN_FLIGHT + 25; index += 1) {
    runner.run('burst', async () => {
      await gate;
      ran += 1;
    });
  }

  assert.equal(runner.pending, MAX_BACKGROUND_TASKS_IN_FLIGHT);
  release();
  await runner.idle();
  assert.equal(ran, MAX_BACKGROUND_TASKS_IN_FLIGHT);
  assert.equal(runner.pending, 0);
});

test('idle() with a timeout gives up on a task that never ends', async () => {
  const runner = new BackgroundTaskRunner();
  runner.run('stuck', () => new Promise<void>(() => undefined));

  const started = Date.now();
  await runner.idle(50);

  assert.ok(Date.now() - started < 1_000);
  assert.equal(runner.pending, 1, 'sigue en vuelo; solo se dejo de esperar');
});

test('onModuleDestroy waits for in-flight work (a clean shutdown drains it)', async () => {
  const runner = new BackgroundTaskRunner();
  let finished = false;

  runner.run('slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    finished = true;
  });
  await runner.onModuleDestroy();

  assert.equal(finished, true);
});
