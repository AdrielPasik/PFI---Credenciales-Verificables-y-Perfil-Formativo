import assert from 'node:assert/strict';
import test from 'node:test';

import { UserStatus } from '@prisma/client';

import {
  DEMO_UADE_ISSUER_ADMIN_DID,
  DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_UADE_ISSUER_ADMIN_EMAIL,
  LEGACY_DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
  LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL
} from './demo-issuer-seed';
import { resolveDemoUadeAdminUser } from './seed';

interface FakeUser {
  id: string;
  email?: string;
  did?: string;
  displayName?: string;
  status?: string;
}

function createFakeUserDatabase(seedUsers: FakeUser[] = []) {
  const usersById = new Map<string, FakeUser>(
    seedUsers.map((user) => [user.id, { ...user }])
  );
  let userSequence = seedUsers.length;

  const userDatabase = {
    async findMany(args: { where: { OR: Array<Record<string, unknown>> } }) {
      const emailIn = args.where.OR.find((clause) => 'email' in clause)?.email as
        | { in: string[] }
        | undefined;
      const didClause = args.where.OR.find((clause) => 'did' in clause)?.did as
        | string
        | undefined;

      return [...usersById.values()].filter(
        (user) =>
          (emailIn && user.email && emailIn.in.includes(user.email)) ||
          (didClause !== undefined && user.did === didClause)
      );
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = usersById.get(args.where.id);
      if (!existing) {
        throw new Error(`No existe el usuario ${args.where.id}`);
      }
      Object.assign(existing, args.data);
      return existing;
    },
    async create(args: { data: Record<string, unknown> }) {
      userSequence += 1;
      const created: FakeUser = { id: `user-${userSequence}`, ...args.data };
      usersById.set(created.id, created);
      return created;
    }
  };

  return { userDatabase, usersById };
}

test('resolveDemoUadeAdminUser creates the UADE admin with the new identity when nothing exists', async () => {
  const fixture = createFakeUserDatabase();

  const resolved = await resolveDemoUadeAdminUser(fixture.userDatabase);

  assert.equal(resolved.email, DEMO_UADE_ISSUER_ADMIN_EMAIL);
  assert.equal(resolved.displayName, DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME);
  assert.equal(resolved.did, DEMO_UADE_ISSUER_ADMIN_DID);
  assert.equal(resolved.status, UserStatus.active);
  assert.equal(fixture.usersById.size, 1);
});

test('resolveDemoUadeAdminUser renames a legacy issuer.admin@example.com user in place, preserving its id', async () => {
  const fixture = createFakeUserDatabase([
    {
      id: 'legacy-uade-admin-1',
      email: LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: DEMO_UADE_ISSUER_ADMIN_DID,
      displayName: LEGACY_DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
      status: UserStatus.active
    }
  ]);

  const resolved = await resolveDemoUadeAdminUser(fixture.userDatabase);

  assert.equal(resolved.id, 'legacy-uade-admin-1');
  assert.equal(fixture.usersById.size, 1);
  const stored = fixture.usersById.get('legacy-uade-admin-1')!;
  assert.equal(stored.email, DEMO_UADE_ISSUER_ADMIN_EMAIL);
  assert.equal(stored.displayName, DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME);
  assert.equal(stored.did, DEMO_UADE_ISSUER_ADMIN_DID);
});

test('resolveDemoUadeAdminUser is idempotent: running it twice does not duplicate the user', async () => {
  const fixture = createFakeUserDatabase([
    {
      id: 'legacy-uade-admin-1',
      email: LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: DEMO_UADE_ISSUER_ADMIN_DID,
      status: UserStatus.active
    }
  ]);

  await resolveDemoUadeAdminUser(fixture.userDatabase);
  const second = await resolveDemoUadeAdminUser(fixture.userDatabase);

  assert.equal(fixture.usersById.size, 1);
  assert.equal(second.id, 'legacy-uade-admin-1');
});

test('resolveDemoUadeAdminUser fails clearly instead of deleting anything when legacy and new users coexist', async () => {
  const fixture = createFakeUserDatabase([
    {
      id: 'legacy-uade-admin-1',
      email: LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: 'did:example:some-other-did',
      status: UserStatus.active
    },
    {
      id: 'new-uade-admin-1',
      email: DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: DEMO_UADE_ISSUER_ADMIN_DID,
      status: UserStatus.active
    }
  ]);

  await assert.rejects(
    () => resolveDemoUadeAdminUser(fixture.userDatabase),
    /multiples usuarios/i
  );

  assert.equal(fixture.usersById.size, 2);
});
