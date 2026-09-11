import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthGuard } from '../auth/auth.guard';
import { SemanticController } from './semantic.controller';

test('SemanticController delegates latest semantic analysis lookup to the service', async () => {
  const calls: Array<{ credentialId: string; userId: string }> = [];
  const expectedResponse = {
    credentialId: 'cred-123',
    latestSemanticAnalysis: null
  };

  const controller = new SemanticController({
    async getLatestForCredential(credentialId: string, userId: string) {
      calls.push({ credentialId, userId });
      return expectedResponse;
    }
  } as never);

  const response = await controller.getLatestForCredential('cred-123', {
    id: 'user-1'
  } as never);

  assert.deepEqual(calls, [{ credentialId: 'cred-123', userId: 'user-1' }]);
  assert.deepEqual(response, expectedResponse);
});

test('SemanticController takes the userId from the token, never from the request', async () => {
  // F1.5: el `credentialId` viene del path, pero la identidad SOLO del usuario
  // autenticado. Si el userId pudiera venir de un parametro, la autorizacion la
  // decidiria el llamador.
  const calls: string[] = [];
  const controller = new SemanticController({
    async getLatestForCredential(_credentialId: string, userId: string) {
      calls.push(userId);
      return { credentialId: 'cred-123', latestSemanticAnalysis: null };
    }
  } as never);

  await controller.getLatestForCredential('cred-123', {
    id: 'user-del-token',
    // Un intento de suplantacion en el objeto de usuario no cambia nada: el
    // controller lee `id` y nada mas.
    userId: 'user-suplantado'
  } as never);

  assert.deepEqual(calls, ['user-del-token']);
});

test('SemanticController is protected by AuthGuard — the route is no longer public', () => {
  // Hasta F1.5 este era el unico controller sin guard que no lo declaraba a
  // proposito. El assert mira los metadatos reales de Nest, no el texto.
  const guards = Reflect.getMetadata('__guards__', SemanticController) ?? [];
  assert.ok(
    guards.includes(AuthGuard),
    'SemanticController debe estar protegido por AuthGuard'
  );
});
