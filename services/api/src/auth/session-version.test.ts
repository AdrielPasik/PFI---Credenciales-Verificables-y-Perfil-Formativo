/**
 * Version de sesion en los access tokens -- Etapa 1 de recuperacion de cuenta.
 *
 * Usa el `JwtService` REAL de @nestjs/jwt (firma y verificacion de verdad, no un
 * stub que devuelve "signed-token"): lo que se prueba es que el claim `sv`
 * viaja DENTRO de un JWT firmado y que la verificacion lo compara contra la fila.
 *
 * El doble de Prisma proyecta ESTRICTAMENTE lo que el codigo pide en `select`.
 * Si `resolveAuthenticatedUser` dejara de seleccionar `sessionVersion`, la
 * version persistida llegaria `undefined` y los casos de version distinta de 0
 * fallarian: el test no puede pasar por casualidad.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InternalServerErrorException,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { hashPassword } from './password-hashing';

const SECRET = 'session-version-test-secret';
const INVALID_TOKEN_MESSAGE = 'Token invalido o expirado.';
const PASSWORD = 'CorrectHorse123';

process.env.JWT_SECRET = SECRET;
delete process.env.JWT_EXPIRES_IN;
delete process.env.PUBLIC_DID_BASE_URL;

const jwt = new JwtService({});

// ---------------------------------------------------------------------------
// Dobles
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  email: string;
  status: UserStatus;
  passwordHash: string;
  /** `null` = la cuenta no tiene fila AuthCredential. */
  sessionVersion: number | null;
}

type Projection = Record<string, unknown>;

interface FindUniqueArgs {
  where: { id?: string; email?: string };
  select?: Record<string, unknown>;
  include?: { authCredential?: boolean };
}

async function account(
  id: string,
  overrides: Partial<Account> = {}
): Promise<Account> {
  return {
    id,
    email: `${id}@example.com`,
    status: UserStatus.active,
    passwordHash: await hashPassword(PASSWORD),
    sessionVersion: 0,
    ...overrides
  };
}

function createLoginWorld(accounts: Account[]) {
  const calls: Array<{ delegate: string; method: string; args: unknown }> = [];

  const prisma = {
    user: {
      async findUnique(args: FindUniqueArgs): Promise<Projection | null> {
        calls.push({ delegate: 'user', method: 'findUnique', args });

        const row = accounts.find((candidate) =>
          args.where.id !== undefined
            ? candidate.id === args.where.id
            : candidate.email === args.where.email
        );

        if (!row) {
          return null;
        }

        const credential =
          row.sessionVersion === null
            ? null
            : {
                passwordHash: row.passwordHash,
                sessionVersion: row.sessionVersion
              };
        const scalars: Projection = {
          id: row.id,
          email: row.email,
          did: null,
          status: row.status,
          displayName: null,
          firstName: 'Ada',
          lastName: 'Lovelace'
        };

        if (args.include?.authCredential) {
          return { ...scalars, authCredential: credential };
        }

        const projected: Projection = {};

        for (const [key, value] of Object.entries(args.select ?? {})) {
          if (key === 'authCredential') {
            const nested =
              (value as { select?: Record<string, boolean> }).select ?? {};
            projected.authCredential = credential
              ? Object.fromEntries(
                  Object.entries(nested)
                    .filter(([, wanted]) => wanted === true)
                    .map(([field]) => [
                      field,
                      (credential as Projection)[field]
                    ])
                )
              : null;
          } else if (value === true) {
            projected[key] = scalars[key];
          }
        }

        return projected;
      }
    }
  };

  return { prisma, calls, accounts };
}

function createRegisterWorld(persistedSessionVersion = 0) {
  const users: Projection[] = [];
  const credentials: Projection[] = [];

  const transaction = {
    user: {
      async create(args: { data: Projection }) {
        const row = {
          id: '11111111-1111-4111-8111-000000000001',
          did: null,
          displayName: null,
          ...args.data
        };
        users.push(row);
        return row;
      },
      // ensureDidForUser: sin PUBLIC_DID_BASE_URL no provisiona nada.
      async findUnique() {
        return { did: null };
      },
      async updateMany() {
        return { count: 0 };
      }
    },
    authCredential: {
      async create(args: { data: Projection }) {
        credentials.push(args.data);
        // Lo que la base devuelve para el `select: { sessionVersion }`.
        return { sessionVersion: persistedSessionVersion };
      }
    }
  };

  const prisma = {
    user: {
      async findUnique() {
        return null;
      }
    },
    async $transaction(callback: (tx: typeof transaction) => Promise<unknown>) {
      return callback(transaction);
    }
  };

  return { prisma, users, credentials };
}

const REGISTRATION = {
  email: 'persona.nueva@example.com',
  password: PASSWORD,
  firstName: 'Ada',
  lastName: 'Lovelace'
};

function serviceFor(prisma: unknown) {
  return new AuthService(prisma as never, jwt);
}

function guardFor(service: AuthService) {
  return new AuthGuard(service);
}

function decode(token: string): Record<string, unknown> {
  return jwt.decode(token) as Record<string, unknown>;
}

/** Firma un JWT REAL con el payload exacto que se le pase. */
function signToken(
  payload: Record<string, unknown>,
  options: { secret?: string; expiresIn?: string } = {}
): Promise<string> {
  return jwt.signAsync(payload, {
    secret: options.secret ?? SECRET,
    expiresIn: (options.expiresIn ?? '1h') as never
  });
}

/** JWT real ya vencido (sin `expiresIn`: el `exp` va en el payload). */
function signExpiredToken(payload: Record<string, unknown>): Promise<string> {
  return jwt.signAsync(
    { ...payload, exp: Math.floor(Date.now() / 1000) - 60 },
    { secret: SECRET }
  );
}

async function assertUnauthorized(
  promise: Promise<unknown>,
  message: string
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.equal(error.getStatus(), 401);
    assert.equal(error.message, message);
    return true;
  });
}

async function withEnv<T>(
  name: string,
  value: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  const original = process.env[name];

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await run();
  } finally {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
}

// ---------------------------------------------------------------------------
// 9.1 Emision
// ---------------------------------------------------------------------------

test('login signs sv with the PERSISTED sessionVersion, not a hardcoded 0', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 4 })]);

  const response = await serviceFor(world.prisma).login({
    email: 'holder-a@example.com',
    password: PASSWORD
  });

  const claims = decode(response.accessToken);
  assert.equal(claims.sub, 'holder-a');
  assert.equal(claims.sv, 4);
  // Es un JWT firmado de verdad: la firma verifica con el secreto configurado.
  await assert.doesNotReject(
    jwt.verifyAsync(response.accessToken, { secret: SECRET })
  );
});

test('login reuses the AuthCredential row it already loads -- the version costs no extra query', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 2 })]);

  await serviceFor(world.prisma).login({
    email: 'holder-a@example.com',
    password: PASSWORD
  });

  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0].method, 'findUnique');
});

test('register signs sv: 0 for a brand-new account', async () => {
  const world = createRegisterWorld();

  const response = await serviceFor(world.prisma).register(REGISTRATION);

  const claims = decode(response.accessToken);
  assert.equal(claims.sv, 0);
  assert.equal(claims.sub, '11111111-1111-4111-8111-000000000001');
});

test('register signs the version the database RETURNED, it does not assume 0', async () => {
  // Una base cuyo DEFAULT fuera otro: el token tiene que reflejar lo persistido.
  const world = createRegisterWorld(3);

  const response = await serviceFor(world.prisma).register(REGISTRATION);

  assert.equal(decode(response.accessToken).sv, 3);
});

test('register does not write sessionVersion itself -- the column default owns it', async () => {
  const world = createRegisterWorld();

  await serviceFor(world.prisma).register(REGISTRATION);

  assert.equal(world.credentials.length, 1);
  assert.equal('sessionVersion' in world.credentials[0], false);
});

test('login and register sign through the same mechanism: same claim set, same expiration', async () => {
  await withEnv('JWT_EXPIRES_IN', '2h', async () => {
    const login = await serviceFor(
      createLoginWorld([await account('holder-a')]).prisma
    ).login({ email: 'holder-a@example.com', password: PASSWORD });
    const register = await serviceFor(createRegisterWorld().prisma).register(
      REGISTRATION
    );

    const loginClaims = decode(login.accessToken);
    const registerClaims = decode(register.accessToken);

    assert.deepEqual(Object.keys(loginClaims).sort(), ['exp', 'iat', 'sub', 'sv']);
    assert.deepEqual(
      Object.keys(registerClaims).sort(),
      Object.keys(loginClaims).sort()
    );
    assert.equal(Number(loginClaims.exp) - Number(loginClaims.iat), 7200);
    assert.equal(Number(registerClaims.exp) - Number(registerClaims.iat), 7200);
  });
});

test('the default expiration is still 1h when JWT_EXPIRES_IN is not configured', async () => {
  await withEnv('JWT_EXPIRES_IN', undefined, async () => {
    const response = await serviceFor(
      createLoginWorld([await account('holder-a')]).prisma
    ).login({ email: 'holder-a@example.com', password: PASSWORD });

    const claims = decode(response.accessToken);
    assert.equal(Number(claims.exp) - Number(claims.iat), 3600);
  });
});

test('public responses keep their shape: sessionVersion / sv never reach the client', async () => {
  const login = await serviceFor(
    createLoginWorld([await account('holder-a', { sessionVersion: 5 })]).prisma
  ).login({ email: 'holder-a@example.com', password: PASSWORD });
  const register = await serviceFor(createRegisterWorld().prisma).register(
    REGISTRATION
  );

  for (const response of [login, register]) {
    assert.deepEqual(Object.keys(response).sort(), ['accessToken', 'user']);
    assert.deepEqual(Object.keys(response.user).sort(), [
      'did',
      'displayLabel',
      'email',
      'id',
      'status'
    ]);
    assert.doesNotMatch(JSON.stringify(response.user), /sessionVersion|"sv"/);
  }
});

test('login validates the password exactly as before: a wrong password is a 401 and signs nothing', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 9 })]);

  await assertUnauthorized(
    serviceFor(world.prisma).login({
      email: 'holder-a@example.com',
      password: 'not-the-password'
    }),
    'Credenciales invalidas.'
  );
});

test('login of an inactive account is still rejected before any token exists', async () => {
  const world = createLoginWorld([
    await account('holder-a', { status: UserStatus.suspended })
  ]);

  await assertUnauthorized(
    serviceFor(world.prisma).login({
      email: 'holder-a@example.com',
      password: PASSWORD
    }),
    'El usuario no esta activo.'
  );
});

test('signing refuses an invalid persisted version instead of minting a token with a bad claim', async () => {
  for (const broken of [-1, 1.5, Number.NaN, 2 ** 53]) {
    const world = createLoginWorld([
      await account('holder-a', { sessionVersion: broken })
    ]);

    await assert.rejects(
      serviceFor(world.prisma).login({
        email: 'holder-a@example.com',
        password: PASSWORD
      }),
      (error: unknown) => {
        assert.ok(error instanceof InternalServerErrorException);
        return true;
      },
      `sessionVersion ${String(broken)} no debe firmarse`
    );
  }
});

test('register still fails BEFORE creating anything when JWT_SECRET is missing', async () => {
  await withEnv('JWT_SECRET', undefined, async () => {
    const world = createRegisterWorld();

    await assert.rejects(
      serviceFor(world.prisma).register(REGISTRATION),
      InternalServerErrorException
    );
    assert.equal(world.users.length, 0);
    assert.equal(world.credentials.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 9.2 Verificacion: casos A-G de la especificacion
// ---------------------------------------------------------------------------

async function resolveWith(
  stored: number | null,
  claims: Record<string, unknown>
) {
  const world = createLoginWorld([
    await account('holder-a', { sessionVersion: stored })
  ]);
  const token = await signToken({ sub: 'holder-a', ...claims });
  return { world, outcome: serviceFor(world.prisma).resolveAuthenticatedUser(token) };
}

test('A: a token WITHOUT sv is accepted while the account is at version 0', async () => {
  const { outcome } = await resolveWith(0, {});

  const user = await outcome;
  assert.equal(user.id, 'holder-a');
});

test('B: sv 0 against version 0 is accepted', async () => {
  const { outcome } = await resolveWith(0, { sv: 0 });

  assert.equal((await outcome).id, 'holder-a');
});

test('C: sv 0 against version 1 is rejected with 401', async () => {
  const { outcome } = await resolveWith(1, { sv: 0 });

  await assertUnauthorized(outcome, INVALID_TOKEN_MESSAGE);
});

test('D: sv 1 against version 1 is accepted', async () => {
  const { outcome } = await resolveWith(1, { sv: 1 });

  assert.equal((await outcome).id, 'holder-a');
});

test('E: a legacy token (no sv) is rejected once the account was invalidated', async () => {
  const { outcome } = await resolveWith(1, {});

  await assertUnauthorized(outcome, INVALID_TOKEN_MESSAGE);
});

test('F: sv 2 against version 1 is rejected -- a NEWER claim is not accepted either', async () => {
  const { outcome } = await resolveWith(1, { sv: 2 });

  await assertUnauthorized(outcome, INVALID_TOKEN_MESSAGE);
});

test('G: a malformed sv is rejected, never read as version 0', async () => {
  // La cuenta esta en 0: si el claim mal formado se interpretara como 0, estos
  // tokens se aceptarian. Ese es exactamente el modo de falla que se prohibe.
  const malformed: Array<[string, unknown]> = [
    ['string "0"', '0'],
    ['null', null],
    ['decimal', 1.5],
    ['negative', -1],
    ['boolean', true],
    ['array', [0]],
    ['object', {}],
    ['beyond the safe integer range', 2 ** 53],
    ['exponent notation', 1e21]
  ];

  for (const [label, value] of malformed) {
    const { outcome } = await resolveWith(0, { sv: value });

    await assert.rejects(outcome, (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException, `sv ${label}`);
      assert.equal(error.getStatus(), 401, `sv ${label}`);
      assert.equal(error.message, INVALID_TOKEN_MESSAGE, `sv ${label}`);
      return true;
    });
  }
});

test('G2: a malformed sv costs no database query -- it is rejected from the token alone', async () => {
  const { world, outcome } = await resolveWith(0, { sv: '0' });

  await assert.rejects(outcome, UnauthorizedException);
  assert.equal(world.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 9.2 Verificacion: aislamiento y validaciones previas
// ---------------------------------------------------------------------------

test('an invalidated user A gets 401 while user B is not affected by A\'s version', async () => {
  const world = createLoginWorld([
    await account('holder-a', { sessionVersion: 1 }),
    await account('holder-b', { sessionVersion: 0 })
  ]);
  const service = serviceFor(world.prisma);

  const staleForA = await signToken({ sub: 'holder-a', sv: 0 });
  const freshForA = await signToken({ sub: 'holder-a', sv: 1 });
  const tokenForB = await signToken({ sub: 'holder-b', sv: 0 });

  await assertUnauthorized(
    service.resolveAuthenticatedUser(staleForA),
    INVALID_TOKEN_MESSAGE
  );
  assert.equal((await service.resolveAuthenticatedUser(freshForA)).id, 'holder-a');
  assert.equal((await service.resolveAuthenticatedUser(tokenForB)).id, 'holder-b');
});

test('an expired token still fails -- even when its sv matches', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 1 })]);
  const token = await signExpiredToken({ sub: 'holder-a', sv: 1 });

  await assertUnauthorized(
    serviceFor(world.prisma).resolveAuthenticatedUser(token),
    INVALID_TOKEN_MESSAGE
  );
  assert.equal(world.calls.length, 0);
});

test('a token with a bad signature still fails -- even when its sv matches', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 1 })]);
  const token = await signToken(
    { sub: 'holder-a', sv: 1 },
    { secret: 'another-secret' }
  );

  await assertUnauthorized(
    serviceFor(world.prisma).resolveAuthenticatedUser(token),
    INVALID_TOKEN_MESSAGE
  );
  assert.equal(world.calls.length, 0);
});

test('an inactive user is still rejected -- with the inactive message, ahead of any version comparison', async () => {
  // Version desactualizada Y cuenta inactiva: gana la validacion que ya existia.
  const world = createLoginWorld([
    await account('holder-a', { status: UserStatus.suspended, sessionVersion: 1 })
  ]);
  const token = await signToken({ sub: 'holder-a', sv: 0 });

  await assertUnauthorized(
    serviceFor(world.prisma).resolveAuthenticatedUser(token),
    'El usuario no esta activo.'
  );
});

test('a user that no longer exists is still rejected with its own message', async () => {
  const world = createLoginWorld([]);
  const token = await signToken({ sub: 'ghost', sv: 0 });

  await assertUnauthorized(
    serviceFor(world.prisma).resolveAuthenticatedUser(token),
    'Usuario autenticado no valido.'
  );
});

test('an account WITHOUT an AuthCredential row counts as version 0 -- exactly what the guard accepted before', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: null })]);
  const service = serviceFor(world.prisma);

  assert.equal(
    (await service.resolveAuthenticatedUser(await signToken({ sub: 'holder-a' }))).id,
    'holder-a'
  );
  assert.equal(
    (await service.resolveAuthenticatedUser(await signToken({ sub: 'holder-a', sv: 0 }))).id,
    'holder-a'
  );
  await assertUnauthorized(
    service.resolveAuthenticatedUser(await signToken({ sub: 'holder-a', sv: 1 })),
    INVALID_TOKEN_MESSAGE
  );
});

// ---------------------------------------------------------------------------
// 9.2 Seguridad del mensaje y costo por request
// ---------------------------------------------------------------------------

test('a stale version is indistinguishable from an expired token and leaks neither version', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 9 })]);
  const service = serviceFor(world.prisma);

  const errors: UnauthorizedException[] = [];
  for (const token of [
    await signToken({ sub: 'holder-a', sv: 7 }),
    await signExpiredToken({ sub: 'holder-a', sv: 9 }),
    await signToken({ sub: 'holder-a', sv: 9 }, { secret: 'another-secret' })
  ]) {
    try {
      await service.resolveAuthenticatedUser(token);
      assert.fail('debia rechazarse');
    } catch (error) {
      assert.ok(error instanceof UnauthorizedException);
      errors.push(error);
    }
  }

  // Misma respuesta HTTP completa para los tres.
  const bodies = errors.map((error) => JSON.stringify(error.getResponse()));
  assert.equal(new Set(bodies).size, 1);
  // Y no aparece ni la version presentada (7) ni la persistida (9).
  assert.doesNotMatch(bodies[0], /[79]/);
  assert.doesNotMatch(bodies[0], /version|sessionVersion|\bsv\b/i);
});

test('resolving a user costs exactly ONE query, and it selects the version in that same call', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 1 })]);
  const token = await signToken({ sub: 'holder-a', sv: 1 });

  await serviceFor(world.prisma).resolveAuthenticatedUser(token);

  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0].delegate, 'user');
  assert.equal(world.calls[0].method, 'findUnique');
  const select = (world.calls[0].args as FindUniqueArgs).select;
  assert.deepEqual(select?.authCredential, {
    select: { sessionVersion: true }
  });
});

test('the resolved AuthenticatedUser does not carry the version', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 1 })]);
  const token = await signToken({ sub: 'holder-a', sv: 1 });

  const user = await serviceFor(world.prisma).resolveAuthenticatedUser(token);

  assert.deepEqual(Object.keys(user).sort(), ['did', 'email', 'id', 'status']);
});

// ---------------------------------------------------------------------------
// AuthGuard de punta a punta (JwtService real + AuthService real)
// ---------------------------------------------------------------------------

function requestWith(token: string) {
  return {
    headers: { authorization: `Bearer ${token}` },
    user: undefined as unknown
  };
}

function contextFor(request: unknown) {
  return {
    switchToHttp() {
      return { getRequest: () => request };
    }
  } as never;
}

test('AuthGuard: a session opened by login stops working the moment its account is invalidated', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 0 })]);
  const service = serviceFor(world.prisma);
  const guard = guardFor(service);

  const { accessToken } = await service.login({
    email: 'holder-a@example.com',
    password: PASSWORD
  });

  // Antes de la invalidacion: el guard deja pasar y publica al usuario.
  const before = requestWith(accessToken);
  assert.equal(await guard.canActivate(contextFor(before)), true);
  assert.equal((before.user as { id: string }).id, 'holder-a');

  // Una etapa posterior incrementara la version; aca se simula la fila.
  world.accounts[0].sessionVersion = 1;

  await assertUnauthorized(
    guard.canActivate(contextFor(requestWith(accessToken))),
    INVALID_TOKEN_MESSAGE
  );

  // Una sesion NUEVA (login despues de la invalidacion) si funciona.
  const relogin = await service.login({
    email: 'holder-a@example.com',
    password: PASSWORD
  });
  assert.equal(decode(relogin.accessToken).sv, 1);
  assert.equal(
    await guard.canActivate(contextFor(requestWith(relogin.accessToken))),
    true
  );
});

test('AuthGuard: a legacy token keeps working for an account that was never invalidated', async () => {
  const world = createLoginWorld([await account('holder-a', { sessionVersion: 0 })]);
  const guard = guardFor(serviceFor(world.prisma));
  const legacy = await signToken({ sub: 'holder-a' });

  const request = requestWith(legacy);
  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.equal((request.user as { id: string }).id, 'holder-a');
});
