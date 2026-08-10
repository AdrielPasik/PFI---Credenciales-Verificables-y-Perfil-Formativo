import assert from 'node:assert/strict';
import test from 'node:test';

import { IssuerAuthorizationStatus } from '@prisma/client';

import * as demoIssuerSeed from './demo-issuer-seed';
import {
  buildDemoIssuerUpsertArgs,
  DEMO_ISSUER_DID,
  DEMO_ISSUER_NAME,
  DEMO_ISSUER_WALLET_ADDRESS,
  DEMO_UADE_ISSUER_ADMIN_DID,
  DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME,
  DEMO_UADE_ISSUER_ADMIN_EMAIL,
  DEMO_UADE_ISSUER_ADMIN_PASSWORD
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

test('demo UADE admin email is exactly emisor.uade@uade.edu.ar', () => {
  assert.equal(DEMO_UADE_ISSUER_ADMIN_EMAIL, 'emisor.uade@uade.edu.ar');
  assert.equal(DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME, 'Administrador UADE');
  assert.equal(DEMO_UADE_ISSUER_ADMIN_PASSWORD, 'UadeDemo123!');
});

test('demo UADE admin DID stays unchanged across the naming hotfix (stable anchor for renaming)', () => {
  assert.equal(DEMO_UADE_ISSUER_ADMIN_DID, 'did:example:issuer-admin-demo');
});

test('no exported demo UADE constant contains markdown/mailto-wrapped email syntax', () => {
  const stringExports = Object.entries(demoIssuerSeed).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );

  assert.ok(stringExports.length > 0);

  for (const [name, value] of stringExports) {
    assert.doesNotMatch(value, /mailto:/i, `${name} no debe contener "mailto:"`);
    assert.doesNotMatch(
      value,
      /\[(issuer\.admin|emisor\.uade)/i,
      `${name} no debe contener un email envuelto en corchetes markdown`
    );
    assert.doesNotMatch(
      value,
      /\]\(mailto/i,
      `${name} no debe contener "](mailto" (markdown de link)`
    );
  }
});
