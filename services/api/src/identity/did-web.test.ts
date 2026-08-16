import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDidForUser, isDidForUserPath } from './did-web';

const CONFIG = { host: 'api.traza.example' };
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

test('buildDidForUser is deterministic for the same userId and config', () => {
  assert.equal(
    buildDidForUser(CONFIG, USER_A),
    buildDidForUser(CONFIG, USER_A)
  );
});

test('buildDidForUser produces different DIDs for different users', () => {
  assert.notEqual(buildDidForUser(CONFIG, USER_A), buildDidForUser(CONFIG, USER_B));
});

test('buildDidForUser derives only from config.host and userId', () => {
  assert.equal(
    buildDidForUser(CONFIG, USER_A),
    `did:web:api.traza.example:did:users:${USER_A}`
  );
});

test('buildDidForUser includes the percent-encoded port when configured', () => {
  assert.equal(
    buildDidForUser({ host: 'api.traza.example%3A8443' }, USER_A),
    `did:web:api.traza.example%3A8443:did:users:${USER_A}`
  );
});

test('buildDidForUser rejects a non-UUID userId instead of embedding arbitrary input', () => {
  assert.throws(() => buildDidForUser(CONFIG, 'adriel-pasik'), /UUID/);
  assert.throws(() => buildDidForUser(CONFIG, 'adriel@example.com'), /UUID/);
});

// La transformacion did:web (reemplazar cada ':' del identificador
// especifico de metodo, salvo el host, por '/') debe reconstruir
// exactamente la ruta que sirve did.controller.ts: /did/users/:userId/did.json.
test('the DID built for a user reverse-transforms to the exact resolver path per the did:web algorithm', () => {
  const did = buildDidForUser(CONFIG, USER_A);
  const methodSpecificId = did.slice('did:web:'.length);
  const [host, ...pathSegments] = methodSpecificId.split(':');

  assert.equal(host, 'api.traza.example');
  assert.equal(`/${pathSegments.join('/')}/did.json`, `/did/users/${USER_A}/did.json`);
});

test('isDidForUserPath accepts a DID that matches the requested userId', () => {
  assert.equal(isDidForUserPath(buildDidForUser(CONFIG, USER_A), USER_A), true);
});

test('isDidForUserPath rejects a DID belonging to a different user', () => {
  assert.equal(isDidForUserPath(buildDidForUser(CONFIG, USER_A), USER_B), false);
});

test('isDidForUserPath rejects non did:web methods (did:example fixtures, did:key, etc.)', () => {
  assert.equal(isDidForUserPath('did:example:holder-demo', USER_A), false);
  assert.equal(isDidForUserPath(`did:key:z6Mk${USER_A}`, USER_A), false);
});

test('isDidForUserPath rejects a did:web whose path shape is not exactly did:users:<userId>', () => {
  assert.equal(
    isDidForUserPath(`did:web:api.traza.example:users:${USER_A}`, USER_A),
    false
  );
  assert.equal(
    isDidForUserPath(`did:web:api.traza.example:did:issuers:${USER_A}`, USER_A),
    false
  );
});

test('isDidForUserPath rejects a DID with an empty host segment', () => {
  assert.equal(isDidForUserPath(`did:web::did:users:${USER_A}`, USER_A), false);
});
