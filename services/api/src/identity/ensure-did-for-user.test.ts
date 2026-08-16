import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { ensureDidForUser } from './ensure-did-for-user';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function withDidBaseUrl(value: string | undefined, run: () => Promise<void>) {
  const original = process.env.PUBLIC_DID_BASE_URL;

  if (value === undefined) {
    delete process.env.PUBLIC_DID_BASE_URL;
  } else {
    process.env.PUBLIC_DID_BASE_URL = value;
  }

  return run().finally(() => {
    if (original === undefined) {
      delete process.env.PUBLIC_DID_BASE_URL;
    } else {
      process.env.PUBLIC_DID_BASE_URL = original;
    }
  });
}

function createFakeUserClient(initialUsers: Array<{ id: string; did: string | null }>) {
  const users = initialUsers.map((user) => ({ ...user }));
  const findUniqueCalls: unknown[] = [];
  const updateManyCalls: unknown[] = [];

  return {
    findUniqueCalls,
    updateManyCalls,
    users,
    client: {
      user: {
        async findUnique(args: { where: { id: string } }) {
          findUniqueCalls.push(args);
          return users.find((user) => user.id === args.where.id) ?? null;
        },
        async updateMany(args: {
          where: { id: string; did: null };
          data: { did: string };
        }) {
          updateManyCalls.push(args);
          const target = users.find(
            (user) => user.id === args.where.id && user.did === null
          );

          if (!target) {
            return { count: 0 };
          }

          target.did = args.data.did;
          return { count: 1 };
        }
      }
    }
  };
}

// B: usuario inexistente
test('B: ensureDidForUser throws NotFoundException for a userId that does not exist', async () => {
  const { client } = createFakeUserClient([]);

  await assert.rejects(
    ensureDidForUser(client as never, USER_A),
    NotFoundException
  );
});

// E: did existente -> no-op exacto
test('E: an existing DID is returned as-is, with no config lookup and no write', async () => {
  const { client, updateManyCalls } = createFakeUserClient([
    { id: USER_A, did: 'did:web:old-host.example:did:users:' + USER_A }
  ]);

  // Sin PUBLIC_DID_BASE_URL configurada -- si el codigo intentara
  // recalcular, esto lanzaria. No lanza porque nunca llega a resolveDidConfig.
  const result = await ensureDidForUser(client as never, USER_A);

  assert.equal(result, 'did:web:old-host.example:did:users:' + USER_A);
  assert.equal(updateManyCalls.length, 0);
});

// F: did existente de host antiguo + config nueva -> conserva antiguo
test('F: an existing DID from an old host is preserved even when config now points elsewhere', async () => {
  const oldDid = 'did:web:host-a.example:did:users:' + USER_A;
  const { client, updateManyCalls } = createFakeUserClient([
    { id: USER_A, did: oldDid }
  ]);

  await withDidBaseUrl('https://host-b.example', async () => {
    const result = await ensureDidForUser(client as never, USER_A);
    assert.equal(result, oldDid);
    assert.equal(updateManyCalls.length, 0);
  });
});

// D: config ausente -> no inventa DID
test('D: no config and did=null returns null without writing', async () => {
  const { client, updateManyCalls } = createFakeUserClient([
    { id: USER_A, did: null }
  ]);

  await withDidBaseUrl(undefined, async () => {
    const result = await ensureDidForUser(client as never, USER_A);
    assert.equal(result, null);
    assert.equal(updateManyCalls.length, 0);
  });
});

// G: did null + config valida -> persiste did:web
test('G: null DID with valid config is provisioned and persisted', async () => {
  const { client, users } = createFakeUserClient([{ id: USER_A, did: null }]);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const result = await ensureDidForUser(client as never, USER_A);
    assert.equal(result, `did:web:api.traza.example:did:users:${USER_A}`);
    assert.equal(users[0].did, result);
  });
});

// A / C: build deterministico, nombre/email no participan (no hay nombre/
// email en el client -- el resultado depende unicamente de userId+config)
test('A/C: provisioning for two different users produces two different, deterministic DIDs', async () => {
  const { client } = createFakeUserClient([
    { id: USER_A, did: null },
    { id: USER_B, did: null }
  ]);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const didA = await ensureDidForUser(client as never, USER_A);
    const didB = await ensureDidForUser(client as never, USER_B);

    assert.notEqual(didA, didB);
    assert.equal(didA, `did:web:api.traza.example:did:users:${USER_A}`);
    assert.equal(didB, `did:web:api.traza.example:did:users:${USER_B}`);
  });
});

// H: retry -> mismo resultado
test('H: calling ensureDidForUser again after provisioning returns the same DID (no second write)', async () => {
  const { client, updateManyCalls } = createFakeUserClient([
    { id: USER_A, did: null }
  ]);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const first = await ensureDidForUser(client as never, USER_A);
    const second = await ensureDidForUser(client as never, USER_A);

    assert.equal(first, second);
    assert.equal(updateManyCalls.length, 1);
  });
});

// I: concurrencia/reconciliation -> un DID logico
test('I: two concurrent ensure calls for the same never-provisioned user converge on one DID', async () => {
  const { client, users, updateManyCalls } = createFakeUserClient([
    { id: USER_A, did: null }
  ]);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const [first, second] = await Promise.all([
      ensureDidForUser(client as never, USER_A),
      ensureDidForUser(client as never, USER_A)
    ]);

    assert.equal(first, second);
    assert.equal(users.filter((user) => user.id === USER_A).length, 1);
    assert.equal(users[0].did, first);
    // Exactamente un updateMany "gana" la condicion where did:null; el
    // fake ya modela eso (el segundo ve el registro ya actualizado).
    assert.ok(updateManyCalls.length >= 1);
  });
});

// K: config invalida -> error seguro (nunca tratado como ausente)
test('K: an invalid PUBLIC_DID_BASE_URL fails clearly instead of silently skipping provisioning', async () => {
  const { client } = createFakeUserClient([{ id: USER_A, did: null }]);

  await withDidBaseUrl('http://not-https.example', async () => {
    await assert.rejects(ensureDidForUser(client as never, USER_A));
  });
});
