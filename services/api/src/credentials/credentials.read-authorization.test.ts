/**
 * Autorizacion de las lecturas genericas de credencial -- S8 cierre de Base
 * Sepolia.
 *
 * `GET /credentials/:id` y `GET /credentials/:id/status` eran PUBLICAS y
 * filtraban `credentialSubject`, `subjectUserId`, metadata y evidencia de
 * cadena -- borradores incluidos -- a cualquiera que conociera el UUID.
 *
 * Estos tests fijan quien puede leer ahora, con el servicio REAL y solo los
 * bordes doblados (Prisma y la autorizacion de membership).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { IssuersService } from '../issuers/issuers.service';
import { CredentialsService } from './credentials.service';

const ISSUER_ID = 'issuer-1';
const HOLDER = user('holder-1');
const MEMBER = user('member-1');
const OTHER_MEMBER_OF_OTHER_ISSUER = user('member-of-other-issuer');
const STRANGER = user('stranger-1');

function user(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    did: `did:example:${id}`,
    status: UserStatus.active
  };
}

function credentialRow(status: 'draft' | 'issued' | 'revoked') {
  return {
    id: 'cred-1',
    schemaVersion: 'credential_v2',
    issuerId: ISSUER_ID,
    subjectUserId: HOLDER.id,
    type: 'course',
    title: 'Curso privado',
    description: null,
    sourceType: 'manual_issuer',
    status,
    hours: null,
    academicCourseId: null,
    externalCourseId: null,
    credentialSubject: { achievement_name: 'Curso privado', institution_name: 'Demo' },
    metadata: { nota: 'interna' },
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    issuedAt: status === 'draft' ? null : new Date('2026-10-02T00:00:00Z'),
    canonicalHash: status === 'draft' ? null : `0x${'a'.repeat(64)}`,
    canonicalizationVersion: status === 'draft' ? null : 'canon_v2',
    revokedAt: null,
    blockchainRecords: []
  };
}

function createService(
  status: 'draft' | 'issued' | 'revoked',
  options: { membershipError?: Error } = {}
) {
  const membershipChecks: Array<{ userId: string; issuerId: string }> = [];
  const mutations: string[] = [];

  const prisma = {
    credential: {
      async findUnique() {
        return credentialRow(status);
      },
      async create() {
        mutations.push('create');
        throw new Error('no debe escribir');
      },
      async update() {
        mutations.push('update');
        throw new Error('no debe escribir');
      }
    }
  };

  const issuersService = {
    async assertUserCanReadCredentialsForIssuer(userId: string, issuerId: string) {
      membershipChecks.push({ userId, issuerId });

      if (options.membershipError) {
        throw options.membershipError;
      }

      // Solo MEMBER pertenece al issuer duenio de la credencial.
      if (userId !== MEMBER.id || issuerId !== ISSUER_ID) {
        throw new ForbiddenException('No pertenece al issuer.');
      }

      return { id: 'membership-1' };
    }
  };

  const service = new CredentialsService(
    prisma as never,
    issuersService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  return { service, membershipChecks, mutations };
}

for (const status of ['draft', 'issued', 'revoked'] as const) {
  test(`un miembro activo del issuer duenio lee la credencial ${status} (detalle y estado)`, async () => {
    const { service, membershipChecks } = createService(status);

    const detail = await service.getCredential('cred-1', MEMBER);
    const state = await service.getCredentialStatus('cred-1', MEMBER);

    assert.equal(detail.id, 'cred-1');
    assert.equal(detail.status, status);
    assert.equal(state.status, status);
    assert.deepEqual(membershipChecks[0], { userId: MEMBER.id, issuerId: ISSUER_ID });
  });

  test(`un usuario ajeno NO lee la credencial ${status}: 404 identico a inexistente`, async () => {
    const { service } = createService(status);

    for (const reader of [STRANGER, OTHER_MEMBER_OF_OTHER_ISSUER]) {
      for (const call of [
        () => service.getCredential('cred-1', reader),
        () => service.getCredentialStatus('cred-1', reader)
      ]) {
        await assert.rejects(call, (error: unknown) => {
          assert.ok(error instanceof NotFoundException);
          assert.equal(error.message, 'Credential cred-1 no existe.');
          return true;
        });
      }
    }
  });
}

test('el titular lee su credencial EMITIDA o REVOCADA', async () => {
  for (const status of ['issued', 'revoked'] as const) {
    const { service } = createService(status);

    const detail = await service.getCredential('cred-1', HOLDER);
    const state = await service.getCredentialStatus('cred-1', HOLDER);

    assert.equal(detail.subjectUserId, HOLDER.id);
    assert.equal(state.status, status);
  }
});

test('el titular NO lee su credencial mientras es BORRADOR', async () => {
  const { service } = createService('draft');

  await assert.rejects(
    () => service.getCredential('cred-1', HOLDER),
    NotFoundException
  );
  await assert.rejects(
    () => service.getCredentialStatus('cred-1', HOLDER),
    NotFoundException
  );
});

test('un usuario sin identidad (anonimo) es rechazado antes de tocar la base', async () => {
  const { service, membershipChecks } = createService('issued');

  for (const anonymous of [undefined, null, {}, { id: '' }]) {
    await assert.rejects(() => service.getCredential('cred-1', anonymous as never));
    await assert.rejects(() =>
      service.getCredentialStatus('cred-1', anonymous as never)
    );
  }

  assert.deepEqual(membershipChecks, []);
});

test('un error de infraestructura de la autorizacion NO se disfraza de 404', async () => {
  const { service } = createService('issued', {
    membershipError: new InternalServerErrorException('db caida')
  });

  // 500 es HttpException: se trata como denegacion. Un error NO HTTP se propaga.
  const boom = new Error('conexion perdida');
  const { service: broken } = createService('issued', { membershipError: boom });

  await assert.rejects(() => broken.getCredential('cred-1', STRANGER), boom);
  await assert.rejects(() => service.getCredential('cred-1', STRANGER), NotFoundException);
});

test('las lecturas no escriben', async () => {
  const { service, mutations } = createService('issued');

  await service.getCredential('cred-1', MEMBER);
  await service.getCredentialStatus('cred-1', MEMBER);

  assert.deepEqual(mutations, []);
});

// ---------------------------------------------------------------------------
// MATRIZ CON LA AUTORIZACION REAL (IssuersService), no doblada
// ---------------------------------------------------------------------------

function createServiceWithRealAuthorization(
  status: 'draft' | 'issued' | 'revoked',
  memberships: Record<string, { role: string; status: string; authorizationStatus: string }>
) {
  const prisma = {
    credential: {
      async findUnique() {
        return credentialRow(status);
      }
    },
    issuerMembership: {
      async findUnique(args: {
        where: { userId_issuerId: { userId: string; issuerId: string } };
      }) {
        const { userId, issuerId } = args.where.userId_issuerId;
        const entry = issuerId === ISSUER_ID ? memberships[userId] : undefined;

        return entry
          ? {
              id: 'm',
              userId,
              issuerId,
              role: entry.role,
              status: entry.status,
              issuer: { authorizationStatus: entry.authorizationStatus }
            }
          : null;
      }
    }
  };

  return new CredentialsService(
    prisma as never,
    new IssuersService(prisma as never),
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

const ACTIVE_ADMIN = { role: 'admin', status: 'active', authorizationStatus: 'authorized' };

test('G: la matriz de lectura con membership REAL (titular, miembros activos/inactivos, viewer, issuer no autorizado, ajenos)', async () => {
  const memberships = {
    [MEMBER.id]: ACTIVE_ADMIN,
    'operator-1': { ...ACTIVE_ADMIN, role: 'operator' },
    'viewer-1': { ...ACTIVE_ADMIN, role: 'viewer' },
    'suspended-1': { ...ACTIVE_ADMIN, status: 'revoked' },
    'unauthorized-issuer-member': { ...ACTIVE_ADMIN, authorizationStatus: 'pending' }
  };

  const allowed: Array<[string, ReturnType<typeof user>, Array<'draft' | 'issued' | 'revoked'>]> = [
    ['G1/G2/G3 titular: nunca borrador, si emitida/revocada', HOLDER, ['issued', 'revoked']],
    ['G4 admin activo', MEMBER, ['draft', 'issued', 'revoked']],
    ['G4 operator activo', user('operator-1'), ['draft', 'issued', 'revoked']]
  ];
  const denied: Array<[string, ReturnType<typeof user>, Array<'draft' | 'issued' | 'revoked'>]> = [
    ['G1 titular en borrador', HOLDER, ['draft']],
    ['G5 membership inactiva', user('suspended-1'), ['draft', 'issued', 'revoked']],
    ['G6 viewer', user('viewer-1'), ['draft', 'issued', 'revoked']],
    ['G6 issuer no autorizado', user('unauthorized-issuer-member'), ['draft', 'issued', 'revoked']],
    ['G7 autenticado ajeno', STRANGER, ['draft', 'issued', 'revoked']],
    ['G9 miembro de OTRO issuer', OTHER_MEMBER_OF_OTHER_ISSUER, ['draft', 'issued', 'revoked']]
  ];

  for (const [label, reader, statuses] of allowed) {
    for (const status of statuses) {
      const service = createServiceWithRealAuthorization(status, memberships);
      assert.equal((await service.getCredential('cred-1', reader)).id, 'cred-1', `${label} ${status}`);
      assert.equal((await service.getCredentialStatus('cred-1', reader)).status, status, `${label} ${status}`);
    }
  }

  for (const [label, reader, statuses] of denied) {
    for (const status of statuses) {
      const service = createServiceWithRealAuthorization(status, memberships);
      for (const call of [
        () => service.getCredential('cred-1', reader),
        () => service.getCredentialStatus('cred-1', reader)
      ]) {
        await assert.rejects(call, (error: unknown) => {
          // G10: mismo 404 y mismo mensaje que una credencial inexistente.
          assert.ok(error instanceof NotFoundException, `${label} ${status}`);
          assert.equal(error.message, 'Credential cred-1 no existe.');
          return true;
        });
      }
    }
  }
});
