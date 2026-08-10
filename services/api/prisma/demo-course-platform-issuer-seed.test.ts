import assert from 'node:assert/strict';
import test from 'node:test';

import { IssuerAuthorizationStatus } from '@prisma/client';

import {
  buildDemoCoursePlatformIssuerUpsertArgs,
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
