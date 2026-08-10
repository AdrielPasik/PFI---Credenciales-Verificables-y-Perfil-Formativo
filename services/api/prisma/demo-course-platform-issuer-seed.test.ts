import assert from 'node:assert/strict';
import test from 'node:test';

import { IssuerAuthorizationStatus } from '@prisma/client';

import * as demoCoursePlatformIssuerSeed from './demo-course-platform-issuer-seed';
import {
  buildDemoCoursePlatformIssuerUpsertArgs,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
  DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD,
  DEMO_COURSE_PLATFORM_ISSUER_DID,
  DEMO_COURSE_PLATFORM_ISSUER_NAME,
  DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS
} from './demo-course-platform-issuer-seed';

test('demo course platform issuer upsert is idempotent and preserves its stable identity', () => {
  const firstArgs = buildDemoCoursePlatformIssuerUpsertArgs();
  const secondArgs = buildDemoCoursePlatformIssuerUpsertArgs();
  const issuersByDid = new Map<string, Record<string, unknown>>();

  function applyUpsert(args: ReturnType<typeof buildDemoCoursePlatformIssuerUpsertArgs>) {
    const did = args.where.did as string;
    const current = issuersByDid.get(did);

    if (current) {
      Object.assign(current, args.update);
      return current;
    }

    const created = {
      id: 'stable-demo-course-platform-issuer-id',
      ...args.create,
      memberships: ['membership-1'],
      credentials: []
    };
    issuersByDid.set(did, created);
    return created;
  }

  const first = applyUpsert(firstArgs);
  const second = applyUpsert(secondArgs);

  assert.equal(issuersByDid.size, 1);
  assert.equal(second, first);
  assert.equal(second.id, 'stable-demo-course-platform-issuer-id');
  assert.equal(second.name, DEMO_COURSE_PLATFORM_ISSUER_NAME);
  assert.equal(second.legalName, DEMO_COURSE_PLATFORM_ISSUER_NAME);
  assert.equal(second.did, DEMO_COURSE_PLATFORM_ISSUER_DID);
  assert.equal(second.walletAddress, DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS);
  assert.equal(
    second.authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.deepEqual(second.memberships, ['membership-1']);
});

test('demo course platform issuer name does not reference a real platform brand', () => {
  assert.doesNotMatch(
    DEMO_COURSE_PLATFORM_ISSUER_NAME,
    /udemy|coursera|aws|linkedin learning|edx/i
  );
});

test('demo course platform issuer upsert does not contain a historical credential snapshot update', () => {
  const args = buildDemoCoursePlatformIssuerUpsertArgs();

  assert.deepEqual(Object.keys(args), ['where', 'update', 'create']);
  assert.equal('credentials' in args.update, false);
});

test('demo course platform admin email is exactly cursos.demo@example.com', () => {
  assert.equal(
    DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL,
    'cursos.demo@example.com'
  );
  assert.equal(
    DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME,
    'Administrador Cursos Demo'
  );
  assert.equal(
    DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID,
    'did:example:cursos-demo-admin'
  );
  assert.equal(DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD, 'CursosDemo123!');
});

test('demo course platform issuer name is a natural Spanish generic name', () => {
  assert.equal(DEMO_COURSE_PLATFORM_ISSUER_NAME, 'Plataforma de Cursos Demo');
});

test('demo course platform issuer DID and wallet stay unchanged across the naming hotfix', () => {
  assert.equal(
    DEMO_COURSE_PLATFORM_ISSUER_DID,
    'did:example:course-platform-issuer-demo'
  );
  assert.equal(
    DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS,
    '0x00000000000000000000000000000000000000bb'
  );
});

test('no exported demo course platform constant contains markdown/mailto-wrapped email syntax', () => {
  const stringExports = Object.entries(demoCoursePlatformIssuerSeed).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );

  assert.ok(stringExports.length > 0);

  for (const [name, value] of stringExports) {
    assert.doesNotMatch(
      value,
      /mailto:/i,
      `${name} no debe contener "mailto:"`
    );
    assert.doesNotMatch(
      value,
      /\[(platform\.issuer\.demo|cursos\.demo)/i,
      `${name} no debe contener un email envuelto en corchetes markdown`
    );
    assert.doesNotMatch(
      value,
      /\]\(mailto/i,
      `${name} no debe contener "](mailto" (markdown de link)`
    );
  }
});
