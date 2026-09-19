/**
 * Superficie publica de intake y revision.
 *
 * Se verifica la FORMA por metadata de Nest: rutas, verbos, ausencia de guard, y
 * que el token de sesion salga del HEADER y nunca de la URL.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { PublicVerificationController } from './public-verification.controller';
import { VERIFICATION_REQUEST_TOKEN_HEADER, readRequestTokenHeader } from './verification-session.token';

function route(method: keyof PublicVerificationController) {
  const handler = PublicVerificationController.prototype[method] as unknown as object;
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
    verb: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
  };
}

test('las cuatro rutas y sus verbos', () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, PublicVerificationController), 'share/profile/:shareToken');
  assert.deepEqual(route('createRequest'), { path: 'verification-requests', verb: RequestMethod.POST });
  assert.deepEqual(route('propose'), { path: 'verification-requests/propose', verb: RequestMethod.POST });
  assert.deepEqual(route('readSession'), { path: 'verification-session', verb: RequestMethod.GET });
  assert.deepEqual(route('confirm'), { path: 'verification-requirements', verb: RequestMethod.PUT });
});

test('el verificador es anonimo: sin AuthGuard', () => {
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, PublicVerificationController), undefined);
  for (const method of ['createRequest', 'propose', 'readSession', 'confirm'] as const) {
    const handler = PublicVerificationController.prototype[method] as unknown as object;
    assert.equal(Reflect.getMetadata(GUARDS_METADATA, handler), undefined, method);
  }
});

test('NINGUNA ruta pone el token de sesion en el path', () => {
  const paths = [
    Reflect.getMetadata(PATH_METADATA, PublicVerificationController) as string,
    ...(['createRequest', 'propose', 'readSession', 'confirm'] as const).map((method) => route(method).path)
  ];
  for (const path of paths) {
    assert.equal(/request[_-]?token|requestToken|session[_-]?token|:token\b/i.test(path), false, path);
  }
});

test('ningun handler lee el token de sesion de @Query ni de @Param', () => {
  // Los parametros que Nest resuelve: solo `shareToken` puede venir del path.
  for (const method of ['propose', 'readSession', 'confirm'] as const) {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, PublicVerificationController, method) as Record<string, { data?: unknown }>;
    const data = Object.values(args).map((entry) => entry.data).filter((value) => typeof value === 'string');
    assert.deepEqual(data, ['shareToken'], method);
  }
});

test('el token de sesion se lee del header dedicado, y un header repetido es ambiguo', () => {
  assert.equal(VERIFICATION_REQUEST_TOKEN_HEADER, 'x-verification-request-token');
  assert.equal(readRequestTokenHeader({ 'x-verification-request-token': 'abc' }), 'abc');
  assert.equal(readRequestTokenHeader({ 'x-verification-request-token': ['a', 'b'] }), undefined);
  assert.equal(readRequestTokenHeader({ authorization: 'Bearer abc' }), undefined, 'no reusa Authorization');
});

test('los handlers delegan con el token del header', async () => {
  const seen: unknown[][] = [];
  const controller = new PublicVerificationController(
    {
      createDraft: async (...args: unknown[]) => { seen.push(['create', ...args]); return {}; },
      readSession: async (...args: unknown[]) => { seen.push(['read', ...args]); return {}; }
    } as never,
    { propose: async (...args: unknown[]) => { seen.push(['propose', ...args]); return {}; } } as never,
    { confirm: async (...args: unknown[]) => { seen.push(['confirm', ...args]); return {}; } } as never,
    { execute: async (...args: unknown[]) => { seen.push(['execute', ...args]); return {}; } } as never,
    { readResult: async (...args: unknown[]) => { seen.push(['result', ...args]); return {}; } } as never
  );
  const headers = { 'x-verification-request-token': 'session-secret' };

  await controller.createRequest('share-secret', { rawObjectiveText: 'x' });
  await controller.propose('share-secret', headers);
  await controller.readSession('share-secret', headers);
  await controller.confirm('share-secret', headers, { requirements: [] });
  await controller.execute('share-secret', headers);
  await controller.readResult('share-secret', headers);

  assert.deepEqual(seen, [
    ['create', 'share-secret', { rawObjectiveText: 'x' }],
    ['propose', 'share-secret', 'session-secret'],
    ['read', 'share-secret', 'session-secret'],
    ['confirm', 'share-secret', 'session-secret', { requirements: [] }],
    ['execute', 'share-secret', 'session-secret'],
    ['result', 'share-secret', 'session-secret']
  ]);
});
