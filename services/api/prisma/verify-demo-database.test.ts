import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  UserStatus
} from '@prisma/client';

import { buildDemoSeedSummary } from './demo-seed-summary';
import { verifyDemoDatabase } from './verify-demo-database';

test('demo seed summary contains counts without identifiers or authentication data', () => {
  const summary = buildDemoSeedSummary({
    academicCoursesImported: 617,
    academicProgramsImported: 22,
    curriculumVersionsImported: 22,
    programCoursesImported: 977
  });

  assert.deepEqual(summary, {
    status: 'ok',
    demoIssuerReady: true,
    demoUsersReady: 2,
    academicCoursesImported: 617,
    academicProgramsImported: 22,
    curriculumVersionsImported: 22,
    programCoursesImported: 977
  });
  assert.equal(
    Object.keys(summary).some((key) =>
      /password|email|userId|issuerId|credential/i.test(key)
    ),
    false
  );
});

test('demo database verifier reads stable keys and returns only a sanitary summary', async () => {
  const { database, calls } = createDatabaseFixture();
  const result = await verifyDemoDatabase(database as never);

  assert.deepEqual(result, {
    status: 'ok',
    connection: 'ok',
    demoIssuer: { authorized: true },
    demoUsers: {
      expected: 2,
      active: 2,
      withEmail: 2,
      withAuthCredential: 2
    },
    issuerAdminMembership: { active: true, role: 'admin' },
    catalog: {
      academicCourses: 617,
      programs: 22,
      curriculumVersions: 22,
      programCourses: 977,
      stableProgramPresent: true
    },
    recentModels: {
      documentEvidenceReadable: true,
      textEvidenceReadable: true
    }
  });
  assert.equal(JSON.stringify(result).includes('email'), false);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.equal(JSON.stringify(result).includes('DATABASE_URL'), false);
  assert.deepEqual(calls.programLookup, {
    where: {
      issuerId_code: {
        issuerId: 'issuer-demo-id',
        code: '3824'
      }
    },
    select: { id: true }
  });
  assert.equal(calls.writes, 0);
});

test('demo database verifier fails safely for an unauthorized issuer', async () => {
  const { database } = createDatabaseFixture({
    issuerAuthorizationStatus: IssuerAuthorizationStatus.pending
  });

  await assert.rejects(
    verifyDemoDatabase(database as never),
    /issuer demo no esta autorizado/
  );
});

test('demo database verifier rejects catalog drift without reset or writes', async () => {
  const { database, calls } = createDatabaseFixture({ academicCourses: 616 });

  await assert.rejects(
    verifyDemoDatabase(database as never),
    /conteo demo de AcademicCourse/
  );
  assert.equal(calls.writes, 0);
});

interface FixtureOptions {
  issuerAuthorizationStatus?: IssuerAuthorizationStatus;
  academicCourses?: number;
}

function createDatabaseFixture(options: FixtureOptions = {}) {
  const calls = {
    programLookup: null as unknown,
    writes: 0
  };
  const database = {
    issuer: {
      async findUnique() {
        return {
          id: 'issuer-demo-id',
          authorizationStatus:
            options.issuerAuthorizationStatus ??
            IssuerAuthorizationStatus.authorized
        };
      }
    },
    user: {
      async findMany() {
        return [
          {
            id: 'issuer-admin-id',
            did: 'did:example:issuer-admin-demo',
            email: 'issuer.admin@example.com',
            status: UserStatus.active,
            authCredential: { id: 'auth-1' }
          },
          {
            id: 'holder-id',
            did: 'did:example:holder-demo',
            email: 'holder.demo@example.com',
            status: UserStatus.active,
            authCredential: { id: 'auth-2' }
          }
        ];
      }
    },
    issuerMembership: {
      async findUnique() {
        return {
          role: IssuerMembershipRole.admin,
          status: IssuerMembershipStatus.active
        };
      }
    },
    academicCourse: {
      async count() {
        return options.academicCourses ?? 617;
      }
    },
    program: {
      async count() {
        return 22;
      },
      async findUnique(args: unknown) {
        calls.programLookup = args;
        return { id: 'program-id' };
      }
    },
    curriculumVersion: {
      async count() {
        return 22;
      }
    },
    programCourse: {
      async count() {
        return 977;
      }
    },
    documentEvidence: {
      async count() {
        return 0;
      }
    },
    textEvidence: {
      async count() {
        return 0;
      }
    },
    credential: {
      async create() {
        calls.writes += 1;
      }
    }
  };

  return { database, calls };
}
