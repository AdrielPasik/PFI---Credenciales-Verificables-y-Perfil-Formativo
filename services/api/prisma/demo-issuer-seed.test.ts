import assert from 'node:assert/strict';
import test from 'node:test';

import { IssuerAuthorizationStatus } from '@prisma/client';

import {
  buildDemoIssuerUpsertArgs,
  DEMO_ISSUER_DID,
  DEMO_ISSUER_NAME,
  DEMO_ISSUER_WALLET_ADDRESS
} from './demo-issuer-seed';

test('demo issuer upsert is idempotent and preserves its stable identity and relations', () => {
  const firstArgs = buildDemoIssuerUpsertArgs();
  const secondArgs = buildDemoIssuerUpsertArgs();
  const issuersByDid = new Map<string, Record<string, unknown>>();

  function applyUpsert(args: ReturnType<typeof buildDemoIssuerUpsertArgs>) {
    const did = args.where.did as string;
    const current = issuersByDid.get(did);

    if (current) {
      Object.assign(current, args.update);
      return current;
    }

    const created = {
      id: 'stable-demo-issuer-id',
      ...args.create,
      memberships: ['membership-1'],
      academicCourses: ['course-1'],
      programs: ['program-1'],
      credentials: ['credential-1']
    };
    issuersByDid.set(did, created);
    return created;
  }

  const first = applyUpsert(firstArgs);
  const second = applyUpsert(secondArgs);

  assert.equal(issuersByDid.size, 1);
  assert.equal(second, first);
  assert.equal(second.id, 'stable-demo-issuer-id');
  assert.equal(second.name, DEMO_ISSUER_NAME);
  assert.equal(second.legalName, DEMO_ISSUER_NAME);
  assert.equal(second.did, DEMO_ISSUER_DID);
  assert.equal(second.walletAddress, DEMO_ISSUER_WALLET_ADDRESS);
  assert.equal(
    second.authorizationStatus,
    IssuerAuthorizationStatus.authorized
  );
  assert.deepEqual(second.memberships, ['membership-1']);
  assert.deepEqual(second.academicCourses, ['course-1']);
  assert.deepEqual(second.programs, ['program-1']);
  assert.deepEqual(second.credentials, ['credential-1']);
});

test('demo issuer rename does not contain any historical credential snapshot update', () => {
  const args = buildDemoIssuerUpsertArgs();

  assert.deepEqual(Object.keys(args), ['where', 'update', 'create']);
  assert.equal('credentials' in args.update, false);
  assert.equal('credentialSubject' in args.update, false);
});
