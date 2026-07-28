import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuerHolderResolutionService } from './issuer-holder-resolution.service';

interface HolderFixture {
  id: string;
  email: string | null;
  did: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
}

const currentUser: AuthenticatedUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: UserStatus.active
};

function createHolderFixture(
  overrides: Partial<HolderFixture> = {}
): HolderFixture {
  return {
    id: 'holder-1',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    displayName: 'Demo Holder',
    firstName: 'Demo',
    lastName: 'Holder',
    status: UserStatus.active,
    ...overrides
  };
}

function createHarness(options?: {
  holders?: HolderFixture[];
  authorizationError?: Error;
}) {
  const authorizationCalls: Array<Record<string, string>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const writeCalls: string[] = [];
  const holders = options?.holders ?? [createHolderFixture()];

  const service = new IssuerHolderResolutionService(
    {
      user: {
        async findMany(args: Record<string, unknown>) {
          findManyCalls.push(args);
          return holders;
        },
        async create() {
          writeCalls.push('user.create');
        },
        async update() {
          writeCalls.push('user.update');
        },
        async delete() {
          writeCalls.push('user.delete');
        }
      },
      credential: {
        async create() {
          writeCalls.push('credential.create');
        }
      },
      issuerMembership: {
        async create() {
          writeCalls.push('issuerMembership.create');
        }
      }
    } as never,
    {
      async assertUserCanResolveHolderForIssuer(
        userId: string,
        issuerId: string
      ) {
        authorizationCalls.push({ userId, issuerId });

        if (options?.authorizationError) {
          throw options.authorizationError;
        }
      }
    } as never
  );

  return {
    service,
    authorizationCalls,
    findManyCalls,
    writeCalls
  };
}

test('resolution authorizes the actor before looking up the holder', async () => {
  const harness = createHarness({
    authorizationError: new ForbiddenException('forbidden')
  });

  await assert.rejects(
    harness.service.resolveHolder(
      'issuer-arbitrary',
      'holder.demo@example.com',
      currentUser
    ),
    ForbiddenException
  );

  assert.deepEqual(harness.authorizationCalls, [
    {
      userId: 'issuer-user-1',
      issuerId: 'issuer-arbitrary'
    }
  ]);
  assert.equal(harness.findManyCalls.length, 0);
});

test('resolution normalizes email and uses exact case-insensitive equality with a minimal select', async () => {
  const harness = createHarness();

  const response = await harness.service.resolveHolder(
    'issuer-1',
    '  Holder.Demo@Example.COM  ',
    currentUser
  );

  assert.equal(response.email, 'holder.demo@example.com');
  assert.deepEqual(harness.findManyCalls, [
    {
      where: {
        email: {
          equals: 'holder.demo@example.com',
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        email: true,
        did: true,
        displayName: true,
        firstName: true,
        lastName: true,
        status: true
      },
      take: 2
    }
  ]);
  assert.equal(
    JSON.stringify(harness.findManyCalls).includes('contains'),
    false
  );
});

test('resolution rejects missing, empty, non-string and invalid email inputs', async () => {
  for (const email of [
    undefined,
    null,
    '',
    '   ',
    'not-an-email',
    ['holder.demo@example.com'],
    { email: 'holder.demo@example.com' },
    42,
    true
  ]) {
    const harness = createHarness();

    await assert.rejects(
      harness.service.resolveHolder('issuer-1', email, currentUser),
      BadRequestException
    );
    assert.equal(harness.findManyCalls.length, 0);
  }
});

test('resolution does not accept a partial email match', async () => {
  const harness = createHarness({ holders: [] });

  await assert.rejects(
    harness.service.resolveHolder(
      'issuer-1',
      'holder.demo@example.co',
      currentUser
    ),
    NotFoundException
  );

  const query = harness.findManyCalls[0];
  assert.deepEqual(query, {
    where: {
      email: {
        equals: 'holder.demo@example.co',
        mode: 'insensitive'
      }
    },
    select: {
      id: true,
      email: true,
      did: true,
      displayName: true,
      firstName: true,
      lastName: true,
      status: true
    },
    take: 2
  });
});

test('active holder with DID resolves to the exact minimized response', async () => {
  const harness = createHarness();

  const response = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.deepEqual(response, {
    id: 'holder-1',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    displayLabel: 'Demo Holder'
  });
  assert.deepEqual(Object.keys(response).sort(), [
    'did',
    'displayLabel',
    'email',
    'id'
  ]);

  for (const forbiddenField of [
    'status',
    'memberships',
    'authCredential',
    'passwordHash',
    'createdAt',
    'updatedAt',
    'displayName',
    'firstName',
    'lastName',
    'credentials',
    'metadata'
  ]) {
    assert.equal(forbiddenField in response, false);
  }
});

test('active holder without DID resolves with did null', async () => {
  const harness = createHarness({
    holders: [createHolderFixture({ did: null })]
  });

  const response = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.equal(response.did, null);
});

test('missing, inactive and email-less holders return the same safe 404', async () => {
  const scenarios: HolderFixture[][] = [
    [],
    [createHolderFixture({ status: UserStatus.suspended })],
    [createHolderFixture({ email: null })],
    [createHolderFixture({ email: 'invalid stored email' })]
  ];

  for (const holders of scenarios) {
    const harness = createHarness({ holders });

    await assert.rejects(
      harness.service.resolveHolder(
        'issuer-1',
        'holder.demo@example.com',
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(
          error.message,
          'No se encontro un titular elegible con el email indicado.'
        );
        assert.equal(error.message.includes('holder.demo@example.com'), false);
        return true;
      }
    );
  }
});

test('logical duplicate emails fail as an internal integrity error without PII', async () => {
  const harness = createHarness({
    holders: [
      createHolderFixture({ id: 'holder-1' }),
      createHolderFixture({ id: 'holder-2', email: 'Holder.Demo@example.com' })
    ]
  });

  await assert.rejects(
    harness.service.resolveHolder(
      'issuer-1',
      'holder.demo@example.com',
      currentUser
    ),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException);
      assert.equal(error.message.includes('holder.demo@example.com'), false);
      return true;
    }
  );
});

test('displayLabel prefers displayName and compacts whitespace', async () => {
  const harness = createHarness({
    holders: [
      createHolderFixture({
        displayName: '  Demo    Holder  ',
        firstName: 'Ignored',
        lastName: 'Name'
      })
    ]
  });

  const response = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.equal(response.displayLabel, 'Demo Holder');
});

test('displayLabel falls back to first and last name', async () => {
  const harness = createHarness({
    holders: [
      createHolderFixture({
        displayName: '   ',
        firstName: '  Ada ',
        lastName: ' Lovelace  '
      })
    ]
  });

  const response = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.equal(response.displayLabel, 'Ada Lovelace');
});

test('displayLabel falls back to first name or last name separately', async () => {
  const scenarios = [
    {
      holder: createHolderFixture({
        displayName: null,
        firstName: ' Ada ',
        lastName: ' '
      }),
      expected: 'Ada'
    },
    {
      holder: createHolderFixture({
        displayName: null,
        firstName: ' ',
        lastName: ' Lovelace '
      }),
      expected: 'Lovelace'
    }
  ];

  for (const scenario of scenarios) {
    const harness = createHarness({ holders: [scenario.holder] });
    const response = await harness.service.resolveHolder(
      'issuer-1',
      'holder.demo@example.com',
      currentUser
    );

    assert.equal(response.displayLabel, scenario.expected);
  }
});

test('displayLabel uses normalized email as the final fallback', async () => {
  const harness = createHarness({
    holders: [
      createHolderFixture({
        email: 'Holder.Demo@Example.com',
        displayName: null,
        firstName: ' ',
        lastName: null
      })
    ]
  });

  const response = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.equal(response.displayLabel, 'holder.demo@example.com');
});

test('a user with institutional memberships remains eligible as a holder', async () => {
  const harness = createHarness();

  await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  const queryText = JSON.stringify(harness.findManyCalls[0]);
  assert.equal(queryText.includes('memberships'), false);
  assert.equal(queryText.includes('role'), false);
});

test('resolution is idempotent and performs no writes', async () => {
  const harness = createHarness();

  const first = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );
  const second = await harness.service.resolveHolder(
    'issuer-1',
    'holder.demo@example.com',
    currentUser
  );

  assert.deepEqual(second, first);
  assert.equal(harness.findManyCalls.length, 2);
  assert.deepEqual(harness.writeCalls, []);
});
