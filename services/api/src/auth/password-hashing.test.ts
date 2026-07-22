import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPasswordHash } from './password-hashing';

test('hashPassword stores a versioned scrypt hash that can be verified', async () => {
  const passwordHash = await hashPassword('DemoIssuer123!');

  assert.match(
    passwordHash,
    /^scrypt:v1:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/i
  );

  const matches = await verifyPasswordHash('DemoIssuer123!', passwordHash);
  assert.equal(matches, true);
});

test('verifyPasswordHash rejects a different password', async () => {
  const passwordHash = await hashPassword('DemoHolder123!');

  const matches = await verifyPasswordHash('WrongPassword123!', passwordHash);
  assert.equal(matches, false);
});
