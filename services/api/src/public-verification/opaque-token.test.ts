import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { generateOpaqueToken, hashOpaqueToken, normalizeOpaqueToken } from './opaque-token';

test('genera 256 bits en base64url', () => {
  const token = generateOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
});

test('dos tokens nunca coinciden', () => {
  const seen = new Set(Array.from({ length: 200 }, () => generateOpaqueToken()));
  assert.equal(seen.size, 200);
});

test('el hash es el MISMO algoritmo que SharingGrant: SHA-256 hex del valor crudo', () => {
  const token = 'a'.repeat(43);
  assert.equal(hashOpaqueToken(token), createHash('sha256').update(token).digest('hex'));
  assert.match(hashOpaqueToken(token), /^[a-f0-9]{64}$/);
});

test('normalizar rechaza lo que no tiene forma de token, sin lanzar', () => {
  assert.equal(normalizeOpaqueToken('a'.repeat(43)), 'a'.repeat(43));
  for (const bad of ['corto', 'a'.repeat(201), 'con espacio '.repeat(4), '../etc/passwd'.repeat(3), 42, null, undefined, {}]) {
    assert.equal(normalizeOpaqueToken(bad), null);
  }
});
