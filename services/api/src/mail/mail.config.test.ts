/**
 * Seleccion y validacion de la configuracion de correo (16.1, parte unitaria).
 *
 * La parte de integracion -- el modulo Nest cargando con CADA configuracion, y el
 * login / registro operativos aunque la recuperacion este apagada -- vive en
 * `password-reset.mail-modules.test.ts`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import util, { inspect } from 'node:util';

import { DisabledMailTransport } from './disabled-mail-transport';
import { LogMailTransport } from './log-mail-transport';
import {
  createMailTransport,
  parseMailFrom,
  readResendConfig,
  selectMailTransportKind
} from './mail.config';
import { ResendMailTransport } from './resend-mail-transport';

const KEY = 're_TEST_SECRET_KEY_do_not_leak_123';
const FROM = 'Scope <no-responder@mail.scopeedu.technology>';
const VALID = { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: KEY, MAIL_FROM: FROM };

test('1. disabled (and the unset default) sends nothing and is not operational', () => {
  for (const env of [{}, { MAIL_TRANSPORT: 'disabled' }, { MAIL_TRANSPORT: ' DISABLED ' }]) {
    const transport = createMailTransport(env);

    assert.ok(transport instanceof DisabledMailTransport);
    assert.equal(transport.operational, false);
  }
});

test('2. log works in development and test', () => {
  for (const env of [{ MAIL_TRANSPORT: 'log' }, { MAIL_TRANSPORT: 'log', NODE_ENV: 'development' }, { MAIL_TRANSPORT: 'log', NODE_ENV: 'test' }]) {
    assert.ok(createMailTransport(env) instanceof LogMailTransport);
  }
});

test('3. log is FORBIDDEN in production, whatever else is configured', () => {
  const reasons: string[] = [];
  const transport = createMailTransport(
    { ...VALID, MAIL_TRANSPORT: 'log', NODE_ENV: 'production' },
    (reason) => reasons.push(reason)
  );

  assert.ok(transport instanceof DisabledMailTransport);
  assert.deepEqual(reasons, ['production_forbids_log']);
});

test('4. resend with a complete, valid configuration is an operational ResendMailTransport', () => {
  for (const nodeEnv of [undefined, 'development', 'production']) {
    const transport = createMailTransport({ ...VALID, NODE_ENV: nodeEnv });

    assert.ok(transport instanceof ResendMailTransport, String(nodeEnv));
    assert.equal(transport.operational, true);
    assert.equal(transport.kind, 'resend');
  }
});

test('5. resend without an API key falls back to disabled with a fixed reason', () => {
  for (const apiKey of [undefined, '', '   ']) {
    const reasons: string[] = [];
    const transport = createMailTransport(
      { ...VALID, RESEND_API_KEY: apiKey },
      (reason) => reasons.push(reason)
    );

    assert.ok(transport instanceof DisabledMailTransport);
    assert.deepEqual(reasons, ['resend_missing_api_key']);
  }
});

test('5b. an API key with illegal characters or an absurd length is rejected, and never echoed', () => {
  for (const apiKey of ['short', 'has space inside!!', 're_key\nwith-newline', 're_key\twith-tab', 're_clave-con-ñ', 'x'.repeat(257), 're_key\r\nBcc: evil@x.co']) {
    const reasons: string[] = [];
    const transport = createMailTransport(
      { ...VALID, RESEND_API_KEY: apiKey },
      (reason) => reasons.push(reason)
    );

    assert.ok(transport instanceof DisabledMailTransport, JSON.stringify(apiKey.slice(0, 12)));
    assert.deepEqual(reasons, ['resend_invalid_api_key']);
    // El motivo es una constante: no contiene (ni puede contener) el valor recibido.
    assert.ok(!reasons[0].includes(apiKey.slice(0, 6)));
  }
});

test('6. resend without a sender falls back to disabled', () => {
  for (const from of [undefined, '', '  ']) {
    const reasons: string[] = [];
    const transport = createMailTransport({ ...VALID, MAIL_FROM: from }, (reason) => reasons.push(reason));

    assert.ok(transport instanceof DisabledMailTransport);
    assert.deepEqual(reasons, ['resend_missing_from']);
  }
});

test('7. an invalid sender falls back to disabled (no header injection, one address only)', () => {
  const invalid = [
    'not-an-email',
    'a@b',
    'Scope <a@b>',
    'Scope <>',
    '<>',
    'Scope no-responder@mail.scopeedu.technology',
    'Scope <no-responder@mail.scopeedu.technology> extra',
    'Evil\r\nBcc: attacker@example.com',
    'Evil <a@mail.co>\nBcc: x@y.co',
    'a@b.co, c@d.co',
    'a@b.co; c@d.co',
    'Na"me <a@b.co>',
    'Na<me <a@b.co>',
    '<a@b.co><c@d.co>',
    `${'x'.repeat(65)}@mail.co`,
    'a@-bad.co',
    'a@bad-.co',
    'a@ba d.co',
    'x'.repeat(201)
  ];

  for (const from of invalid) {
    const reasons: string[] = [];
    const transport = createMailTransport({ ...VALID, MAIL_FROM: from }, (reason) => reasons.push(reason));

    assert.ok(transport instanceof DisabledMailTransport, JSON.stringify(from.slice(0, 30)));
    assert.deepEqual(reasons, ['resend_invalid_from'], JSON.stringify(from.slice(0, 30)));
  }
});

test('7b. valid senders are accepted and normalised; the logic does not depend on this exact string', () => {
  assert.equal(parseMailFrom('Scope <no-responder@mail.scopeedu.technology>'), 'Scope <no-responder@mail.scopeedu.technology>');
  assert.equal(parseMailFrom('no-responder@mail.scopeedu.technology'), 'no-responder@mail.scopeedu.technology');
  assert.equal(parseMailFrom('  Scope Educación <Hola@Mail.Example.COM>  '), 'Scope Educación <Hola@mail.example.com>');
  assert.equal(parseMailFrom("O'Connor Ltd. <a.b+tag@sub.example.co.uk>"), "O'Connor Ltd. <a.b+tag@sub.example.co.uk>");
  assert.equal(parseMailFrom('<a@b.co>'), 'a@b.co');
  // Otro remitente cualquiera funciona igual: el valor es configuracion, no codigo.
  const transport = createMailTransport({ ...VALID, MAIL_FROM: 'Otra Marca <hola@otro.example>' });
  assert.ok(transport instanceof ResendMailTransport);
});

test('9. an unknown transport value is disabled -- never an error, never log, never resend', () => {
  for (const value of ['smtp', 'ses', 'sendgrid', 'true', '1', 'resend ', 'RESENDX', 'log;resend', 'resend,log']) {
    const reasons: string[] = [];
    const transport = createMailTransport(
      { ...VALID, MAIL_TRANSPORT: value },
      (reason) => reasons.push(reason)
    );

    // "resend " (con espacio) se normaliza a resend y es valido; el resto no.
    if (value.trim().toLowerCase() === 'resend') {
      assert.ok(transport instanceof ResendMailTransport, value);
    } else {
      assert.ok(transport instanceof DisabledMailTransport, value);
      assert.deepEqual(reasons, ['unsupported_value'], value);
    }
  }
});

test('createMailTransport NEVER throws, whatever garbage is in the environment', () => {
  const garbage = ['', ' ', '\0', '\n', '💥', 'x'.repeat(100_000), '{"a":1}', '${jndi}', '../../etc/passwd'];

  for (const value of garbage) {
    for (const env of [
      { MAIL_TRANSPORT: value },
      { ...VALID, RESEND_API_KEY: value },
      { ...VALID, MAIL_FROM: value },
      { ...VALID, NODE_ENV: value }
    ]) {
      assert.doesNotThrow(() => createMailTransport(env));
    }
  }
});

test('the selection and the config result never carry the API key into anything that could be logged', () => {
  const selection = selectMailTransportKind(VALID);

  assert.deepEqual(selection, { kind: 'resend' });
  assert.ok(!JSON.stringify(selection).includes(KEY));
  // El unico objeto que lleva la key es el resultado interno, nunca la seleccion.
  const config = readResendConfig(VALID);
  assert.equal(config.ok, true);
  const failure = readResendConfig({ ...VALID, MAIL_FROM: 'bad' });
  assert.deepEqual(failure, { ok: false, reason: 'invalid_from' });
  assert.ok(!JSON.stringify(failure).includes(KEY));
});

test('a transport object cannot leak the key by being serialised, inspected or spread into a log', () => {
  const transport = createMailTransport(VALID) as ResendMailTransport;
  const suspicious = [KEY, KEY.slice(0, 10), 'Bearer'];

  const dumps = [
    JSON.stringify(transport),
    inspect(transport, { showHidden: true, depth: 6 }),
    JSON.stringify({ ...transport }),
    String(Object.keys(transport)),
    String(Object.getOwnPropertyNames(transport)),
    util.format('%o', transport),
    `${JSON.stringify(Object.entries(transport))}`
  ];

  for (const dump of dumps) {
    for (const secret of suspicious) {
      assert.ok(!dump.includes(secret), `la key aparece en: ${dump.slice(0, 60)}`);
    }
  }
  assert.equal(transport.kind, 'resend');
});
