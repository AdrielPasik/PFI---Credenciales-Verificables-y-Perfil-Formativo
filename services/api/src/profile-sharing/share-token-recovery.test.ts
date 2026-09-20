/**
 * Sobre de recuperacion del enlace compartido.
 *
 * Lo que se defiende: el token crudo no se persiste, el sobre esta atado a SU
 * fila y a SU dueno, y cualquier duda al abrirlo falla cerrado.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  SHARE_TOKEN_KEY_ENV,
  ShareTokenRecoveryError,
  buildSharePath,
  buildShareUrl,
  openShareToken,
  sealShareToken,
  shareTokenRecoveryConfigured
} from './share-token-recovery';

const TOKEN = 't'.repeat(43);
const CONTEXT = { sharingGrantId: 'grant-1', userId: 'user-1' };

function env(key?: string): NodeJS.ProcessEnv {
  return key === undefined ? {} : { [SHARE_TOKEN_KEY_ENV]: key };
}

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

test('sella y abre el MISMO token', () => {
  const envelope = sealShareToken(TOKEN, CONTEXT, env(KEY));
  assert.equal(openShareToken(envelope, CONTEXT, env(KEY)), TOKEN);
});

test('el sobre no contiene el token en claro', () => {
  const envelope = sealShareToken(TOKEN, CONTEXT, env(KEY));
  assert.equal(envelope.includes(TOKEN), false);
  assert.match(envelope, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('dos sobres del mismo token son distintos: nonce aleatorio por sobre', () => {
  const first = sealShareToken(TOKEN, CONTEXT, env(KEY));
  const second = sealShareToken(TOKEN, CONTEXT, env(KEY));
  assert.notEqual(first, second);
  assert.equal(openShareToken(first, CONTEXT, env(KEY)), openShareToken(second, CONTEXT, env(KEY)));
});

test('VALIDACION DE CLAVE: solo base64 o hex de 32 bytes exactos', () => {
  const valid = [randomBytes(32).toString('base64'), randomBytes(32).toString('hex')];
  for (const key of valid) {
    assert.equal(shareTokenRecoveryConfigured(env(key)), true, key.slice(0, 6));
  }

  const invalid: Array<[string | undefined, string]> = [
    [undefined, 'KEY_NOT_CONFIGURED'],
    ['', 'KEY_NOT_CONFIGURED'],
    ['   ', 'KEY_NOT_CONFIGURED'],
    ['no-es-base64-valida!!', 'KEY_INVALID'],
    ['zz'.repeat(32), 'KEY_INVALID'],
    [randomBytes(16).toString('base64'), 'KEY_INVALID'],
    [randomBytes(64).toString('base64'), 'KEY_INVALID'],
    [randomBytes(16).toString('hex'), 'KEY_INVALID'],
    ['contrasena-humana-que-no-es-una-clave', 'KEY_INVALID']
  ];
  for (const [key, code] of invalid) {
    assert.throws(
      () => sealShareToken(TOKEN, CONTEXT, env(key)),
      (error: unknown) => {
        assert.ok(error instanceof ShareTokenRecoveryError);
        // Nunca se trunca, ni se rellena, ni se deriva una clave de un texto.
        assert.equal(error.code, code);
        return true;
      },
      String(key)
    );
  }
});

test('acepta la clave en hex o en base64, y exige 32 bytes', () => {
  const hex = randomBytes(32).toString('hex');
  assert.equal(openShareToken(sealShareToken(TOKEN, CONTEXT, env(hex)), CONTEXT, env(hex)), TOKEN);

  const short = randomBytes(16).toString('base64');
  assert.throws(() => sealShareToken(TOKEN, CONTEXT, env(short)), (error: unknown) => {
    assert.ok(error instanceof ShareTokenRecoveryError);
    assert.equal(error.code, 'KEY_INVALID');
    return true;
  });
});

test('sin clave configurada no se sella nada: falla cerrado', () => {
  assert.equal(shareTokenRecoveryConfigured(env()), false);
  assert.throws(() => sealShareToken(TOKEN, CONTEXT, env()), (error: unknown) => {
    assert.ok(error instanceof ShareTokenRecoveryError);
    assert.equal(error.code, 'KEY_NOT_CONFIGURED');
    return true;
  });
});

test('un sobre movido a OTRO enlace o a OTRO dueno no abre', () => {
  const envelope = sealShareToken(TOKEN, CONTEXT, env(KEY));
  for (const foreign of [
    { sharingGrantId: 'grant-2', userId: 'user-1' },
    { sharingGrantId: 'grant-1', userId: 'user-2' }
  ]) {
    assert.throws(() => openShareToken(envelope, foreign, env(KEY)), (error: unknown) => {
      assert.ok(error instanceof ShareTokenRecoveryError);
      assert.equal(error.code, 'ENVELOPE_UNUSABLE');
      return true;
    });
  }
});

test('otra clave no abre el sobre', () => {
  const envelope = sealShareToken(TOKEN, CONTEXT, env(KEY));
  assert.throws(() => openShareToken(envelope, CONTEXT, env(OTHER_KEY)), ShareTokenRecoveryError);
});

test('corrupcion, version desconocida y forma rota fallan cerrado', () => {
  const envelope = sealShareToken(TOKEN, CONTEXT, env(KEY));
  const [, nonce, payload] = envelope.split('.');
  const corrupted = [
    '',
    'v1',
    'v1.solo-dos-partes',
    `v2.${nonce}.${payload}`,
    `v1.${nonce}.${payload.slice(0, -4)}`,
    `v1.AAAA.${payload}`,
    `v1.${nonce}.AAAA`
  ];
  for (const candidate of corrupted) {
    assert.throws(
      () => openShareToken(candidate, CONTEXT, env(KEY)),
      ShareTokenRecoveryError,
      candidate.slice(0, 20)
    );
  }
});

test('la URL publica se ARMA con el origen configurado; nunca se persiste', () => {
  assert.equal(buildSharePath('abc'), '/share/profile/abc');
  assert.equal(buildShareUrl('abc', 'https://scope.example.com'), 'https://scope.example.com/share/profile/abc');
  // Un cambio de dominio solo cambia el prefijo: nada persistido queda invalido.
  assert.equal(buildShareUrl('abc', 'https://otro.example.com/'), 'https://otro.example.com/share/profile/abc');
  for (const invalid of [
    undefined,
    '',
    '   ',
    'no-es-una-url',
    'ftp://scope.example.com',
    // Path, query o fragmento NO se limpian en silencio: se rechazan, porque de
    // aca sale lo que el holder copia y pega.
    'https://scope.example.com/algo',
    'https://scope.example.com/?x=1',
    'https://scope.example.com/#y',
    'https://usuario:clave@scope.example.com'
  ]) {
    assert.equal(buildShareUrl('abc', invalid), null, String(invalid));
  }
});
