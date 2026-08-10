import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword } from '../src/auth/password-hashing';
import {
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
  DEMO_COURSE_PLATFORM_ISSUER_DID,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
} from './demo-course-platform-issuer-seed';
import {
  DEMO_ISSUER_DID,
  DEMO_UADE_ISSUER_ADMIN_DID,
  DEMO_UADE_ISSUER_ADMIN_EMAIL,
  LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL
} from './demo-issuer-seed';
import { bootstrapDemoIdentities } from './seed-demo-identities';

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

  // Deliberadamente NO se implementan academicCourse/program/
  // curriculumVersion/programCourse: si bootstrapDemoIdentities intentara
  // tocar el catalogo academico, fallaria con un TypeError inmediato en
  // vez de completar silenciosamente.
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
      async findMany(args: { where: { OR: Array<Record<string, unknown>> } }) {
        const emailIn = args.where.OR.find((clause) => 'email' in clause)?.email as
          | { in: string[] }
          | undefined;
        const didClause = args.where.OR.find((clause) => 'did' in clause)?.did as
          | string
          | { in: string[] }
          | undefined;

        return [...usersById.values()].filter((user) => {
          const emailMatches = Boolean(
            emailIn && user.email && emailIn.in.includes(user.email)
          );
          const didMatches =
            didClause !== undefined &&
            user.did !== undefined &&
            (typeof didClause === 'string'
              ? user.did === didClause
              : didClause.in.includes(user.did));

          return emailMatches || didMatches;
        });
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

test('bootstrapDemoIdentities creates/asegura both UADE and Cursos Demo issuers and users', async () => {
  const fixture = createFakeDatabase();

  const summary = await bootstrapDemoIdentities(fixture.database, hashPassword);

  assert.deepEqual(summary, {
    uadeIssuerReady: true,
    uadeUserReady: true,
    uadeAuthCredentialReady: true,
    uadeMembershipReady: true,
    courseIssuerReady: true,
    courseUserReady: true,
    courseAuthCredentialReady: true,
    courseMembershipReady: true
  });

  assert.ok(fixture.issuersByDid.has(DEMO_ISSUER_DID));
  assert.ok(fixture.issuersByDid.has(DEMO_COURSE_PLATFORM_ISSUER_DID));
  assert.equal(fixture.issuersByDid.size, 2);

  const uadeUser = [...fixture.usersById.values()].find(
    (user) => user.email === DEMO_UADE_ISSUER_ADMIN_EMAIL
  );
  const courseUser = [...fixture.usersById.values()].find(
    (user) => user.email === DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL
  );
  assert.ok(uadeUser);
  assert.ok(courseUser);
  assert.equal(fixture.usersById.size, 2);
  assert.equal(fixture.membershipsByKey.size, 2);
  assert.equal(fixture.authCredentialsByUserId.size, 2);
});

test('bootstrapDemoIdentities renames a legacy UADE admin user in place', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'legacy-uade-1',
      email: LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: DEMO_UADE_ISSUER_ADMIN_DID,
      status: 'active'
    }
  ]);

  await bootstrapDemoIdentities(fixture.database, hashPassword);

  assert.ok(fixture.usersById.has('legacy-uade-1'));
  const renamed = fixture.usersById.get('legacy-uade-1')!;
  assert.equal(renamed.email, DEMO_UADE_ISSUER_ADMIN_EMAIL);
  // Solo se creo el usuario nuevo de Cursos Demo, el de UADE se renombro.
  assert.equal(fixture.usersById.size, 2);
});

test('bootstrapDemoIdentities renames a legacy Cursos Demo admin user in place', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'legacy-course-1',
      email: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
      did: LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
      status: 'active'
    }
  ]);

  await bootstrapDemoIdentities(fixture.database, hashPassword);

  assert.ok(fixture.usersById.has('legacy-course-1'));
  const renamed = fixture.usersById.get('legacy-course-1')!;
  assert.equal(renamed.email, DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL);
  assert.equal(fixture.usersById.size, 2);
});

test('bootstrapDemoIdentities is idempotent: running it twice does not duplicate anything', async () => {
  const fixture = createFakeDatabase();

  await bootstrapDemoIdentities(fixture.database, hashPassword);
  await bootstrapDemoIdentities(fixture.database, hashPassword);

  assert.equal(fixture.issuersByDid.size, 2);
  assert.equal(fixture.usersById.size, 2);
  assert.equal(fixture.membershipsByKey.size, 2);
  assert.equal(fixture.authCredentialsByUserId.size, 2);
});

test('bootstrapDemoIdentities fails clearly and does not touch Cursos Demo when UADE has a legacy/new conflict', async () => {
  const fixture = createFakeDatabase([
    {
      id: 'legacy-uade-1',
      email: LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: 'did:example:some-other-did',
      status: 'active'
    },
    {
      id: 'new-uade-1',
      email: DEMO_UADE_ISSUER_ADMIN_EMAIL,
      did: DEMO_UADE_ISSUER_ADMIN_DID,
      status: 'active'
    }
  ]);

  await assert.rejects(
    () => bootstrapDemoIdentities(fixture.database, hashPassword),
    /multiples usuarios/i
  );

  assert.equal(fixture.usersById.size, 2);
  // El bootstrap de UADE corre primero y falla antes de llegar a Cursos
  // Demo: ningun issuer ni usuario de Cursos Demo se llega a crear.
  assert.equal(fixture.issuersByDid.has(DEMO_COURSE_PLATFORM_ISSUER_DID), false);
});

test('bootstrapDemoIdentities summary never includes passwordHash or a DATABASE_URL-like value', async () => {
  const fixture = createFakeDatabase();

  const summary = await bootstrapDemoIdentities(fixture.database, hashPassword);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('passwordHash'), false);
  assert.equal(serialized.includes('scrypt:'), false);
  assert.equal(serialized.includes('postgres://'), false);
  assert.equal(serialized.includes('postgresql://'), false);
});
