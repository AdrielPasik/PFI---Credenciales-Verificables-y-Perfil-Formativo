import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { DidController } from './did.controller';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function createController(users: Array<{ id: string; did: string | null }>) {
  const findUniqueCalls: unknown[] = [];
  const prisma = {
    user: {
      async findUnique(args: { where: { id: string } }) {
        findUniqueCalls.push(args);
        return users.find((user) => user.id === args.where.id) ?? null;
      }
    }
  };

  return { controller: new DidController(prisma as never), findUniqueCalls };
}

// A: DID provisionado -> DID Document correcto
test('A: returns a minimal DID Document for a user with a persisted did:web', async () => {
  const did = `did:web:api.traza.example:did:users:${USER_A}`;
  const { controller } = createController([{ id: USER_A, did }]);

  const document = await controller.getDidDocument(USER_A);

  assert.deepEqual(document, {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: did
  });
});

// B: usuario inexistente -> 404
test('B: unknown userId resolves to NotFoundException', async () => {
  const { controller } = createController([]);

  await assert.rejects(
    controller.getDidDocument(USER_A),
    NotFoundException
  );
});

// C: user did=null -> 404
test('C: a user with did=null resolves to NotFoundException, never an invented document', async () => {
  const { controller } = createController([{ id: USER_A, did: null }]);

  await assert.rejects(
    controller.getDidDocument(USER_A),
    NotFoundException
  );
});

// D: persisted DID does not correspond to the requested path -> 404
test('D: a persisted DID belonging to a different userId never resolves for this path', async () => {
  const didForOtherUser = `did:web:api.traza.example:did:users:${USER_B}`;
  const { controller } = createController([
    { id: USER_A, did: didForOtherUser }
  ]);

  await assert.rejects(
    controller.getDidDocument(USER_A),
    NotFoundException
  );
});

test('D2: a legacy did:example fixture never resolves as a did:web document', async () => {
  const { controller } = createController([
    { id: USER_A, did: 'did:example:holder-demo' }
  ]);

  await assert.rejects(
    controller.getDidDocument(USER_A),
    NotFoundException
  );
});

// E: no expone email/firstName/lastName/displayName/status/credentials
test('E: the DID Document never exposes PII or account metadata fields', async () => {
  const did = `did:web:api.traza.example:did:users:${USER_A}`;
  const { controller } = createController([{ id: USER_A, did }]);

  const document = await controller.getDidDocument(USER_A);

  assert.deepEqual(Object.keys(document).sort(), ['@context', 'id']);
});

// F: GET nunca modifica User -- el fake solo expone findUnique, ningun
// metodo de escritura; si el controller intentara escribir, el test
// fallaria con un TypeError en tiempo de ejecucion.
test('F: resolving a DID Document never calls any write operation', async () => {
  const did = `did:web:api.traza.example:did:users:${USER_A}`;
  const { controller, findUniqueCalls } = createController([
    { id: USER_A, did }
  ]);

  await controller.getDidDocument(USER_A);

  assert.equal(findUniqueCalls.length, 1);
  assert.deepEqual(findUniqueCalls[0], {
    where: { id: USER_A },
    select: { did: true }
  });
});

test('rejects a blank userId without querying the database', async () => {
  const { controller, findUniqueCalls } = createController([]);

  await assert.rejects(controller.getDidDocument('   '), NotFoundException);
  assert.equal(findUniqueCalls.length, 0);
});
