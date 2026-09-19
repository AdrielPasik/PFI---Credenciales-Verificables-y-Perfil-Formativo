import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebCorsOptions } from './web-cors';

test('WEB_ORIGIN creates a restricted CORS configuration for one origin', () => {
  const options = resolveWebCorsOptions('  http://127.0.0.1:3000  ');

  assert.deepEqual(options, {
    origin: 'http://127.0.0.1:3000',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Verification-Request-Token'],
    credentials: false
  });
  assert.equal(options?.origin.includes('*'), false);
  assert.equal(typeof options?.origin, 'string');
});

test('missing or blank WEB_ORIGIN does not enable a permissive CORS policy', () => {
  assert.equal(resolveWebCorsOptions(undefined), null);
  assert.equal(resolveWebCorsOptions(''), null);
  assert.equal(resolveWebCorsOptions('   '), null);
});

test('invalid, wildcard and non-origin WEB_ORIGIN values fail clearly', () => {
  for (const value of [
    '*',
    'not-a-url',
    'file:///tmp/index.html',
    'http://127.0.0.1:3000/path',
    'http://user:password@127.0.0.1:3000'
  ]) {
    assert.throws(
      () => resolveWebCorsOptions(value),
      /WEB_ORIGIN debe contener un origen HTTP o HTTPS valido/
    );
  }
});

test('el header de sesion del verificador esta permitido, y NO se abre ningun otro', () => {
  // Sin esta entrada el preflight bloquea el token de sesion, y la unica salida
  // seria mandarlo en la URL -- que es justo lo que se evita.
  const options = resolveWebCorsOptions('http://127.0.0.1:3000');
  assert.ok(options?.allowedHeaders.includes('X-Verification-Request-Token'));
  assert.equal(options?.allowedHeaders.includes('*'), false);
  assert.equal(options?.allowedHeaders.length, 3);
});
