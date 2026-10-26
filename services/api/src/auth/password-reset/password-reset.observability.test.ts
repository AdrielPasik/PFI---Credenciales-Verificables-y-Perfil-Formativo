/**
 * Observabilidad de los limites y de los fallos (seccion 13).
 *
 * La respuesta publica de `request` es SIEMPRE el mismo 202, asi que el log del servidor
 * es el UNICO lugar donde un operador puede enterarse de que alguien esta agotando un
 * presupuesto, de que el correo esta fallando o de que la funcion esta mal configurada.
 * Estos tests congelan el vocabulario de eventos: cada situacion tiene una cadena
 * propia y estable, que una alarma futura podra buscar, y NINGUNA lleva email, token,
 * hash ni enlace.
 *
 * No hay alarmas de CloudWatch ni Terraform en esta etapa: esto es solo la senal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DisabledMailTransport } from '../../mail/disabled-mail-transport';
import { MailDeliveryError } from '../../mail/mail-transport';
import { BackgroundTaskRunner } from './background-task-runner';
import {
  ACCOUNT_COOLDOWN_MS,
  ACCOUNT_QUOTA_MAX,
  GLOBAL_QUOTA_MAX,
  MAX_BACKGROUND_TASKS_IN_FLIGHT,
  PASSWORD_RESET_TTL_MS
} from './password-reset.limits';
import { hashPasswordResetToken } from './password-reset-token';
import { START } from './__fixtures__/auth-world';
import {
  buildRecovery,
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
const logs = installLogCapture();

const EMAIL = 'ada@example.com';

/** Lineas nuevas desde `mark`, como `nivel|mensaje`. */
function since(mark: number): string[] {
  return logs.slice(mark).map((line) => line.split('|').slice(0, 2).join('|'));
}

async function observe(run: () => Promise<void>): Promise<string[]> {
  const mark = logs.length;
  await run();
  return since(mark);
}

test('13A. global budget exhausted -> a WARN with its own name', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  r.world.state.tokens.push(
    ...Array.from({ length: GLOBAL_QUOTA_MAX }, (_, index) => ({
      id: `f${index}`,
      userId: 'x',
      tokenHash: `h${index}`,
      createdAt: new Date(START.getTime() - 3_600_000),
      expiresAt: new Date(START.getTime() - 1_800_000),
      consumedAt: null,
      invalidatedAt: null
    }))
  );

  const events = await observe(() => r.request(EMAIL).then(() => undefined));

  assert.ok(events.includes('warn|request.dropped (global_cap)'), events.join('\n'));
});

test('13B. per-account quota exceeded -> a WARN with its own name, distinct from the global one', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  for (let issued = 0; issued < ACCOUNT_QUOTA_MAX; issued += 1) {
    await r.request(EMAIL);
    r.world.clock.advance(ACCOUNT_COOLDOWN_MS + 1_000);
  }

  const events = await observe(() => r.request(EMAIL).then(() => undefined));

  assert.ok(events.includes('warn|request.dropped (account_quota)'), events.join('\n'));
  assert.ok(!events.some((event) => event.includes('global_cap')));
});

test('13C. cooldown -> a plain LOG (the normal double-click case), not an alert-level event', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  await r.request(EMAIL);

  const events = await observe(() => r.request(EMAIL).then(() => undefined));

  assert.ok(events.includes('log|request.dropped (cooldown)'), events.join('\n'));
  assert.ok(!events.some((event) => event.startsWith('warn|request.dropped')));
});

test('13D. an unknown or ineligible account -> its own LOG line', async () => {
  const r = buildRecovery();

  const events = await observe(() => r.request('nadie@example.com').then(() => undefined));

  assert.ok(events.includes('log|request.dropped (ineligible)'), events.join('\n'));
});

test('13E. transport failures are told apart by class, each at WARN', async () => {
  const expected: Array<[MailDeliveryError | Error, string]> = [
    [new MailDeliveryError('not_sent'), 'warn|email.failed:not_sent (token token-1)'],
    [new MailDeliveryError('rejected'), 'warn|email.failed:rejected (token token-1)'],
    [new MailDeliveryError('ambiguous'), 'warn|email.ambiguous (token token-1)'],
    [new Error('anything else'), 'warn|email.ambiguous (token token-1)']
  ];

  for (const [failure, line] of expected) {
    const r = buildRecovery();
    await r.world.seedUser({ email: EMAIL });
    r.behavior.beforeSend = () => {
      throw failure;
    };

    const events = await observe(() => r.request(EMAIL).then(() => undefined));

    assert.ok(events.includes(line), `${line}\n${events.join('\n')}`);
  }
});

test('13E2. a successful hand-off is logged as such, with the internal id only', async () => {
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });

  const events = await observe(() => r.request(EMAIL).then(() => undefined));

  assert.ok(events.includes('log|email.sent (token token-1)'), events.join('\n'));
});

test('13F. invalid configuration is visible on every refused request, with the reason', async () => {
  const original = process.env.WEB_PUBLIC_BASE_URL;

  try {
    const disabled = buildRecovery({ transport: new DisabledMailTransport() });
    const events = await observe(async () => {
      assert.throws(() => disabled.service.requestReset({ email: EMAIL }));
    });
    assert.ok(events.includes('warn|recovery.unavailable (mail_transport)'), events.join('\n'));

    for (const [value, reason] of [
      [undefined, 'missing'],
      ['http://app.scope.test', 'insecure_non_local_host'],
      ['https://app.scope.test/app', 'has_path'],
      ['https://u:p@app.scope.test', 'has_credentials']
    ] as const) {
      if (value === undefined) delete process.env.WEB_PUBLIC_BASE_URL;
      else process.env.WEB_PUBLIC_BASE_URL = value;
      const r = buildRecovery();

      const seen = await observe(async () => {
        assert.throws(() => r.service.requestReset({ email: EMAIL }));
      });

      assert.ok(seen.includes(`warn|recovery.unavailable (web_url:${reason})`), seen.join('\n'));
    }
  } finally {
    process.env.WEB_PUBLIC_BASE_URL = original;
  }
});

test('13G. tasks dropped because the runner is full -> a WARN naming the limit', async () => {
  const runner = new BackgroundTaskRunner();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  for (let index = 0; index < MAX_BACKGROUND_TASKS_IN_FLIGHT; index += 1) {
    runner.run('fill', () => gate);
  }

  const events = await observe(async () => {
    runner.run('overflow', async () => undefined);
  });

  assert.ok(events.includes('warn|overflow dropped (too many in flight)'), events.join('\n'));
  release();
  await runner.idle();
});

test('13H. shutdown-related losses are observable: refusal, drain start, completion and timeout', async () => {
  const runner = new BackgroundTaskRunner(60);
  runner.run('slow', () => new Promise<void>(() => undefined));

  const events = await observe(async () => {
    await runner.onModuleDestroy();
    runner.run('after-close', async () => undefined);
  });

  assert.ok(events.includes('log|drain.started (1 in flight, up to 60ms)'), events.join('\n'));
  assert.ok(events.includes('warn|drain.timeout (1 still running after 60ms; they may be lost)'));
  assert.ok(events.includes('warn|after-close dropped (shutting down)'));
});

test('13I. every denial and failure has a DISTINCT, stable name -- the alerting vocabulary', () => {
  const vocabulary = [
    'request.dropped (global_cap)',
    'request.dropped (account_quota)',
    'request.dropped (cooldown)',
    'request.dropped (ineligible)',
    'email.failed:not_sent',
    'email.failed:rejected',
    'email.ambiguous',
    'recovery.unavailable (mail_transport)',
    'recovery.unavailable (shutting_down)',
    'dropped (too many in flight)',
    'dropped (shutting down)',
    'drain.timeout'
  ];

  assert.equal(new Set(vocabulary).size, vocabulary.length);
  // Ninguno contiene datos de la persona ni un secreto.
  for (const event of vocabulary) {
    assert.doesNotMatch(event, /@|token=|password|hash|re_/i);
  }
});

test('13J. none of these events carries an email, a token, a hash or a link', async () => {
  const start = logs.length;
  const r = buildRecovery();
  await r.world.seedUser({ email: EMAIL });
  await r.request(EMAIL);
  const token = r.lastToken();
  await r.request(EMAIL);
  await r.request('nadie@example.com');

  const written = logs.slice(start).join('\n');
  for (const secret of [EMAIL, 'nadie@example.com', token, hashPasswordResetToken(token), 'reset-password#token']) {
    assert.ok(!written.includes(secret), secret.slice(0, 12));
  }
  void PASSWORD_RESET_TTL_MS;
});
