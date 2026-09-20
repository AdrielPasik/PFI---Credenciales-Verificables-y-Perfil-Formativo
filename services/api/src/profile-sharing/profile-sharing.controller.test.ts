import assert from 'node:assert/strict';
import test from 'node:test';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import {
  MyProfileSharingController,
  PublicProfileSharingController
} from './profile-sharing.controller';

const currentUser = { id: 'holder-1', email: 'holder@example.com', did: null, status: UserStatus.active };

test('profile sharing creation requires auth while public token reading has no auth guard', async () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, MyProfileSharingController), [AuthGuard]);
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, PublicProfileSharingController), undefined);
  const calls: string[] = [];
  const own = new MyProfileSharingController(
    { createForUser: async (userId: string) => { calls.push(userId); return { sharePath: '/share/profile/token', expiresAt: null }; } } as never,
    {} as never
  );
  const publicController = new PublicProfileSharingController({ getPublicProfile: async (token: string) => ({ token }) } as never);

  assert.deepEqual(await own.createProfileShare(currentUser), { sharePath: '/share/profile/token', expiresAt: null });
  assert.deepEqual(calls, ['holder-1']);
  assert.deepEqual(await publicController.getSharedProfile('opaque-token'), { token: 'opaque-token' });
});

// ---------------------------------------------------------------------------
// Gestion de enlaces y consentimiento de computo
// ---------------------------------------------------------------------------

test('gestionar enlaces y politica pasa por AuthGuard y delega con el usuario actual', async () => {
  // Las tres operaciones nuevas viven en el controller autenticado. Ninguna
  // cuelga del controller publico: un endpoint publico JAMAS puede mutar el
  // consentimiento.
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, MyProfileSharingController), [AuthGuard]);

  const seen: Array<[string, string, unknown]> = [];
  const controller = new MyProfileSharingController(
    {
      listForUser: async (userId: string) => { seen.push(['list', userId, null]); return []; },
      revokeForUser: async (userId: string, shareId: string) => {
        seen.push(['revoke', userId, shareId]);
        return { status: 'REVOKED', revokedAt: '2026-09-15T00:00:00.000Z' };
      }
    } as never,
    {
      replaceForShare: async (userId: string, shareId: string, body: unknown) => {
        seen.push(['policy', userId, [shareId, body]]);
        return { enabled: true, policyVersion: 2, authorizedCredentialIds: [], effectiveAuthorizedCredentialIds: [], updatedAt: null };
      }
    } as never
  );

  await controller.listProfileShares(currentUser);
  await controller.revokeProfileShare('share-1', currentUser);
  await controller.replaceVerificationPolicy('share-1', currentUser, { enabled: true, credentialIds: ['c1'] });

  assert.deepEqual(seen, [
    ['list', 'holder-1', null],
    ['revoke', 'holder-1', 'share-1'],
    ['policy', 'holder-1', ['share-1', { enabled: true, credentialIds: ['c1'] }]]
  ]);
});

test('el controller publico no expone ninguna operacion de gestion', () => {
  // Regresion de autoridad: si alguna de estas apareciera en el controller sin
  // guard, un tercero con el token podria administrar el permiso del holder.
  const publicMethods = Object.getOwnPropertyNames(PublicProfileSharingController.prototype);
  for (const forbidden of ['listProfileShares', 'revokeProfileShare', 'replaceVerificationPolicy']) {
    assert.equal(publicMethods.includes(forbidden), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Recuperacion del enlace por su dueno — V1
// ---------------------------------------------------------------------------

test('la recuperacion del enlace es autenticada, delega con el usuario actual y no se cachea', async () => {
  const seen: Array<[string, string]> = [];
  const controller = new MyProfileSharingController(
    {
      recoverLinkForUser: async (userId: string, shareId: string) => {
        seen.push([userId, shareId]);
        return { shareUrl: 'https://scope.example.com/share/profile/abc', sharePath: '/share/profile/abc' };
      }
    } as never,
    {} as never
  );

  const link = await controller.recoverProfileShareLink('share-1', currentUser);

  assert.deepEqual(seen, [['holder-1', 'share-1']]);
  assert.deepEqual(Object.keys(link).sort(), ['sharePath', 'shareUrl']);
  // El AuthGuard es del controller entero.
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, MyProfileSharingController), [AuthGuard]);

  // La respuesta lleva un bearer: no debe quedar en cache ni en un prefetch.
  const headers = Reflect.getMetadata('__headers__', controller.recoverProfileShareLink) as
    | Array<{ name: string; value: string }>
    | undefined;
  assert.ok(headers?.some((header) => header.name === 'Cache-Control' && header.value === 'no-store'));
});

test('el controller publico NO expone ninguna recuperacion de enlace', () => {
  const publicMethods = Object.getOwnPropertyNames(PublicProfileSharingController.prototype);
  assert.equal(publicMethods.includes('recoverProfileShareLink'), false);
  assert.deepEqual(publicMethods.sort(), ['constructor', 'getSharedProfile']);
});
