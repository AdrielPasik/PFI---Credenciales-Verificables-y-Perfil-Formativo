import assert from 'node:assert/strict';
import test from 'node:test';

import { IssuerMembershipRole, IssuerMembershipStatus, UserStatus } from '@prisma/client';

import { hashPassword, verifyPasswordHash } from '../src/auth/password-hashing';
import {
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD,
  DEMO_COURSE_PLATFORM_ISSUER_DID,
  DEMO_COURSE_PLATFORM_ISSUER_NAME,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
} from './demo-course-platform-issuer-seed';
import {
  bootstrapDemoCoursePlatformUser,
  resolveDemoCoursePlatformAdminUser
} from './seed-course-platform-user';

interface FakeUser {
  id: string;
  email?: string;
  did?: string;
  displayName?: string;
  status?: string;
}

function createFakeDatabase(seedUsers: FakeUser[] = []) {
  const issuersByDid = new Map<string, Record<string, unknown>>();
  const usersById = new Map<string, FakeUser>(
    seedUsers.map((user) => [user.id, { ...user }])
  );
  const membershipsByKey = new Map<string, Record<string, unknown>>();
  const authCredentialsByUserId = new Map<string, Record<string, unknown>>();
  let issuerSequence = 0;
  let userSequence = seedUsers.length;

  const database = {
    issuer: {
      async upsert(args: {
        where: { did: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        const existing = issuersByDid.get(args.where.did);
        if (existing) {
          Object.assign(existing, args.update);
          return existing as { id: string; name: string };
        }
        issuerSequence += 1;
        const created = { id: `issuer-${issuerSequence}`, ...args.create };
        issuersByDid.set(args.where.did, created);
        return created as { id: string; name: string };
      }
    },
    user: {
      async findMany(args: {
        where: { OR: Array<Record<string, unknown>> };
      }) {
        const emailIn = args.where.OR.find((clause) => 'email' in clause)?.email as
          | { in: string[] }
          | undefined;
        const didIn = args.where.OR.find((clause) => 'did' in clause)?.did as
          | { in: string[] }
          | undefined;

        return [...usersById.values()].filter(
          (user) =>
            (emailIn && user.email && emailIn.in.includes(user.email)) ||
            (didIn && user.did && didIn.in.includes(user.did))
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
    },
    issuerMembership: {
      async upsert(args: {
        where: { userId_issuerId: { userId: string; issuerId: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        const key = `${args.where.userId_issuerId.userId}:${args.where.userId_issuerId.issuerId}`;
        const existing = membershipsByKey.get(key);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created = { ...args.create };
        membershipsByKey.set(key, created);
        return created;
      }
    },
    authCredential: {
      async upsert(args: {
        where: { userId: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) {
        const existing = authCredentialsByUserId.get(args.where.userId);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created = { ...args.create };
        authCredentialsByUserId.set(args.where.userId, created);
        return created;
      }
    }
  };

  return {
    database,
    issuersByDid,
    usersById,
    membershipsByKey,
    authCredentialsByUserId
  };
}

test('bootstrap creates the issuer, user, membership and a hashed (never plain) auth credential', async () => {
  const fixture = createFakeDatabase();

  const summary = await bootstrapDemoCoursePlatformUser(
    fixture.database,
    hashPassword
  );

  assert.deepEqual(summary, {
    issuerReady: true,
    userReady: true,
    authCredentialReady: true,
    membershipReady: true,
    email: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
    issuerName: DEMO_COURSE_PLATFORM_ISSUER_NAME
  });

  const issuer = fixture.issuersByDid.get(DEMO_COURSE_PLATFORM_ISSUER_DID);
  assert.ok(issuer);
  const user = [...fixture.usersById.values()].find(
    (candidate) => candidate.email === DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
  );
  assert.ok(user);
  assert.equal(user!.displayName, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME);
  assert.equal(user!.did, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID);
  assert.equal(user!.status, UserStatus.active);

  const membership = fixture.membershipsByKey.get(
    `${user!.id}:${(issuer as { id: string }).id}`
  );
  assert.ok(membership);
  assert.equal(membership!.role, IssuerMembershipRole.admin);
  assert.equal(membership!.status, IssuerMembershipStatus.active);

  const authCredential = fixture.authCredentialsByUserId.get(user!.id);
  assert.ok(authCredential);
  const passwordHash = authCredential!.passwordHash as string;
  assert.notEqual(passwordHash, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD);
  assert.ok(passwordHash.startsWith('scrypt:v1:'));
  assert.equal(
    await verifyPasswordHash(
      DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD,
      passwordHash
    ),
    true
  );
});

test('bootstrap is idempotent: running it twice does not duplicate the issuer, user, membership or auth credential', async () => {
  const fixture = createFakeDatabase();

  await bootstrapDemoCoursePlatformUser(fixture.database, hashPassword);
  await bootstrapDemoCoursePlatformUser(fixture.database, hashPassword);

  assert.equal(fixture.issuersByDid.size, 1);
  assert.equal(fixture.usersById.size, 1);
  assert.equal(fixture.membershipsByKey.size, 1);
  assert.equal(fixture.authCredentialsByUserId.size, 1);
});

test('bootstrap summary never includes passwordHash or a DATABASE_URL-like value', async () => {
  const fixture = createFakeDatabase();

  const summary = await bootstrapDemoCoursePlatformUser(
    fixture.database,
    hashPassword
  );

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('scrypt:'), false);
  assert.equal(serialized.includes('postgres://'), false);
  assert.equal(serialized.includes('postgresql://'), false);
});

test('resolveDemoCoursePlatformAdminUser renames a legacy user in place, preserving its id', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'legacy-user-1',
      email: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
      did: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
      displayName: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
      status: UserStatus.active
    }
  ]);

  const resolved = await resolveDemoCoursePlatformAdminUser(fixture.database.user);

  assert.equal(resolved.id, 'legacy-user-1');
  assert.equal(fixture.usersById.size, 1);
  const stored = fixture.usersById.get('legacy-user-1')!;
  assert.equal(stored.email, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL);
  assert.equal(stored.displayName, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME);
  assert.equal(stored.did, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID);
});

test('resolveDemoCoursePlatformAdminUser is a no-op rename when the user already has the new identity', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'already-renamed-1',
      email: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
      did: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
      displayName: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
      status: UserStatus.active
    }
  ]);

  const resolved = await resolveDemoCoursePlatformAdminUser(fixture.database.user);

  assert.equal(resolved.id, 'already-renamed-1');
  assert.equal(fixture.usersById.size, 1);
});

test('resolveDemoCoursePlatformAdminUser fails clearly instead of deleting anything when legacy and new users coexist', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'legacy-user-1',
      email: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
      did: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
      status: UserStatus.active
    },
    {
      id: 'new-user-1',
      email: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
      did: DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
      status: UserStatus.active
    }
  ]);

  await assert.rejects(
    () => resolveDemoCoursePlatformAdminUser(fixture.database.user),
    /multiples usuarios/i
  );

  assert.equal(fixture.usersById.size, 2);
});
