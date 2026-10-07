/**
 * Helpers did:web del plano de ISSUER -- S8c3.
 *
 * Lo central aca es la ida y vuelta EXACTA entre el DID y la ruta publica
 * (addendum A): no alcanza con comprobar que la ruta contiene el issuerId ni que
 * el DID empieza con `did:web`. Se congela la transformacion completa.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDidForIssuer, isDidForIssuerPath } from './did-web-issuer';
import { buildDidForUser } from './did-web';

const CONFIG = { host: 'api.scopeedu.technology' };
const ISSUER_A = '3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const ISSUER_B = '44444444-4444-4444-8444-444444444444';

test('buildDidForIssuer es deterministico y deriva solo de host + issuerId', () => {
  assert.equal(
    buildDidForIssuer(CONFIG, ISSUER_A),
    buildDidForIssuer(CONFIG, ISSUER_A)
  );
  assert.equal(
    buildDidForIssuer(CONFIG, ISSUER_A),
    `did:web:api.scopeedu.technology:did:issuers:${ISSUER_A}`
  );
  assert.notEqual(
    buildDidForIssuer(CONFIG, ISSUER_A),
    buildDidForIssuer(CONFIG, ISSUER_B)
  );
});

test('buildDidForIssuer incluye el puerto percent-encoded cuando esta configurado', () => {
  assert.equal(
    buildDidForIssuer({ host: 'api.scopeedu.technology%3A8443' }, ISSUER_A),
    `did:web:api.scopeedu.technology%3A8443:did:issuers:${ISSUER_A}`
  );
});

test('buildDidForIssuer rechaza un issuerId que no es UUID', () => {
  assert.throws(() => buildDidForIssuer(CONFIG, 'uade'), /UUID/);
  assert.throws(() => buildDidForIssuer(CONFIG, ''), /UUID/);
});

// ---------------------------------------------------------------------------
// ADDENDUM A: IDA Y VUELTA did:web EXACTA
// ---------------------------------------------------------------------------

/**
 * Algoritmo did:web, tal como lo define la especificacion del metodo:
 *   1. reemplazar ':' por '/' en el identificador especifico de metodo;
 *   2. si el dominio trae puerto, percent-decode de los dos puntos;
 *   3. prefijar https://;
 *   4. si no hay path, agregar /.well-known;
 *   5. agregar /did.json.
 */
function didWebResolutionUrl(did: string): string {
  assert.ok(did.startsWith('did:web:'), 'no es un did:web');

  const methodSpecificId = did.slice('did:web:'.length);
  const [encodedHost, ...pathSegments] = methodSpecificId.split(':');
  const host = decodeURIComponent(encodedHost.replace(/%3A/gi, ':'));

  const path =
    pathSegments.length === 0
      ? '/.well-known'
      : `/${pathSegments.join('/')}`;

  return `https://${host}${path}/did.json`;
}

test('addendum A: el DID del issuer resuelve EXACTAMENTE a la ruta publica implementada', () => {
  const did = buildDidForIssuer(CONFIG, ISSUER_A);

  assert.equal(
    did,
    `did:web:api.scopeedu.technology:did:issuers:${ISSUER_A}`
  );
  assert.equal(
    didWebResolutionUrl(did),
    `https://api.scopeedu.technology/did/issuers/${ISSUER_A}/did.json`
  );
});

test('addendum A: la ruta derivada coincide con el path del controller, segmento por segmento', () => {
  const did = buildDidForIssuer(CONFIG, ISSUER_A);
  const url = new URL(didWebResolutionUrl(did));

  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, 'api.scopeedu.technology');
  assert.deepEqual(url.pathname.split('/'), [
    '',
    'did',
    'issuers',
    ISSUER_A,
    'did.json'
  ]);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('addendum A: con puerto, el host se percent-decodifica y el path no cambia', () => {
  const did = buildDidForIssuer(
    { host: 'api.scopeedu.technology%3A8443' },
    ISSUER_A
  );

  assert.equal(
    didWebResolutionUrl(did),
    `https://api.scopeedu.technology:8443/did/issuers/${ISSUER_A}/did.json`
  );
});

test('addendum A: el documento nunca cae en /.well-known -- siempre hay path', () => {
  const url = didWebResolutionUrl(buildDidForIssuer(CONFIG, ISSUER_A));
  assert.ok(!url.includes('/.well-known'));
});

// ---------------------------------------------------------------------------
// FILTRO DEFENSIVO
// ---------------------------------------------------------------------------

test('isDidForIssuerPath acepta el DID del issuer solicitado', () => {
  assert.equal(
    isDidForIssuerPath(buildDidForIssuer(CONFIG, ISSUER_A), ISSUER_A),
    true
  );
});

test('isDidForIssuerPath rechaza el DID de otro issuer', () => {
  assert.equal(
    isDidForIssuerPath(buildDidForIssuer(CONFIG, ISSUER_A), ISSUER_B),
    false
  );
});

test('isDidForIssuerPath rechaza metodos que no son did:web', () => {
  assert.equal(isDidForIssuerPath('did:example:issuer-demo', ISSUER_A), false);
  assert.equal(isDidForIssuerPath(`did:key:z6Mk${ISSUER_A}`, ISSUER_A), false);
  assert.equal(isDidForIssuerPath('', ISSUER_A), false);
});

test('isDidForIssuerPath rechaza una forma de path que no sea did:issuers:<issuerId>', () => {
  assert.equal(
    isDidForIssuerPath(
      `did:web:api.scopeedu.technology:issuers:${ISSUER_A}`,
      ISSUER_A
    ),
    false
  );
  assert.equal(
    isDidForIssuerPath(
      `did:web:api.scopeedu.technology:did:issuer:${ISSUER_A}`,
      ISSUER_A
    ),
    false
  );
});

test('isDidForIssuerPath rechaza un host vacio', () => {
  assert.equal(
    isDidForIssuerPath(`did:web::did:issuers:${ISSUER_A}`, ISSUER_A),
    false
  );
});

// ---------------------------------------------------------------------------
// LOS DOS PLANOS NO SE CRUZAN
// ---------------------------------------------------------------------------

test('un DID de holder NUNCA resuelve como DID de issuer, ni al reves', () => {
  const issuerDid = buildDidForIssuer(CONFIG, ISSUER_A);
  const userDid = buildDidForUser(CONFIG, ISSUER_A);

  assert.notEqual(issuerDid, userDid);
  assert.equal(isDidForIssuerPath(userDid, ISSUER_A), false);
});
