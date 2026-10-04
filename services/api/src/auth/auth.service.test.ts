import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  UnauthorizedException
} from '@nestjs/common';
import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  Prisma,
  UserOnboardingIntent,
  UserStatus
} from '@prisma/client';

import { AuthService } from './auth.service';
import { hashPassword, verifyPasswordHash } from './password-hashing';

function prismaUniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('simulated unique violation', {
    code: 'P2002',
    clientVersion: '6.19.3'
  });
}

// A1: doble fake minimo -- una tabla `user` en memoria (para que
// findUnique/create se comporten como una DB real de un solo registro) mas
// authCredential/issuerMembership instrumentados. $transaction ejecuta el
// callback contra el mismo objeto (mismo patron ya usado en
// credentials.service.test.ts), asi que create() dentro de la transaccion
// muta la misma tabla que findUnique lee despues.
function createRegisterPrismaDouble() {
  const users: Array<{
    id: string;
    email: string;
    did: string | null;
    status: UserStatus;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  }> = [];
  const authCredentials: Array<{ userId: string; passwordHash: string }> = [];
  const issuerMembershipCreateCalls: unknown[] = [];
  // O1: el `data` CRUDO que recibe user.create -- es exactamente lo que Prisma
  // escribiria en la fila. `onboardingIntent: undefined` significa que la
  // columna se omite y queda NULL por el schema.
  const userCreateData: Array<Record<string, unknown>> = [];
  // O1: los otros delegates que register NUNCA debe tocar.
  const platformAdminCreateCalls: unknown[] = [];
  const issuerCreateCalls: unknown[] = [];
  let nextId = 1;

  const userFindUniqueByIdCalls: Array<Record<string, unknown>> = [];
  const userUpdateManyCalls: Array<Record<string, unknown>> = [];

  const transactionClient = {
    user: {
      async create(args: {
        data: { email: string; status: UserStatus; firstName: string; lastName: string };
      }) {
        userCreateData.push(args.data as unknown as Record<string, unknown>);

        if (users.some((user) => user.email === args.data.email)) {
          throw prismaUniqueConstraintError();
        }

        const created = {
          // A2.1: buildDidForUser exige un userId con forma de UUID (como
          // los que genera Prisma en produccion) -- el fake tambien debe
          // producir un id valido para ejercitar el path de provisioning.
          id: `11111111-1111-4111-8111-${String(nextId++).padStart(12, '0')}`,
          email: args.data.email,
          did: null,
          status: args.data.status,
          displayName: null,
          firstName: args.data.firstName,
          lastName: args.data.lastName
        };
        users.push(created);
        return created;
      },
      // A2.1: usados por ensureDidForUser dentro de la misma transaccion
      // de register (ver ensure-did-for-user.ts).
      async findUnique(args: { where: { id: string } }) {
        userFindUniqueByIdCalls.push(args);
        return users.find((user) => user.id === args.where.id) ?? null;
      },
      async updateMany(args: {
        where: { id: string; did: null };
        data: { did: string };
      }) {
        userUpdateManyCalls.push(args);
        const target = users.find(
          (user) => user.id === args.where.id && user.did === null
        );

        if (!target) {
          return { count: 0 };
        }

        target.did = args.data.did;
        return { count: 1 };
      }
    },
    authCredential: {
      async create(args: { data: { userId: string; passwordHash: string } }) {
        authCredentials.push(args.data);
        return { id: `auth-credential-${authCredentials.length}`, ...args.data };
      }
    },
    // O1: register no debe crear capacidad de plataforma ni instituciones en
    // NINGUNA rama de onboardingIntent.
    platformAdmin: {
      async create(args: unknown) {
        platformAdminCreateCalls.push(args);
        throw new Error('register nunca debe crear un PlatformAdmin');
      }
    },
    issuer: {
      async create(args: unknown) {
        issuerCreateCalls.push(args);
        throw new Error('register nunca debe crear un Issuer');
      }
    },
    issuerMembership: {
      async create(args: unknown) {
        issuerMembershipCreateCalls.push(args);
        throw new Error('issuerMembership.create should never be called by register().');
      }
    }
  };

  const prisma = {
    user: {
      async findUnique(args: { where: { email: string } }) {
        return users.find((user) => user.email === args.where.email) ?? null;
      }
    },
    async $transaction(callback: (tx: typeof transactionClient) => Promise<unknown>) {
      // Simula rollback real de Postgres: si el callback lanza (por
      // ejemplo, ensureDidForUser rechazando una PUBLIC_DID_BASE_URL
      // invalida), las filas que ya se habian "insertado" en este fake
      // dentro de la transaccion se deshacen -- nunca queda un User o un
      // AuthCredential huerfano (ver seccion 14/"atomicidad" del diseno).
      const usersSnapshot = users.length;
      const authCredentialsSnapshot = authCredentials.length;

      try {
        return await callback(transactionClient);
      } catch (error) {
        users.length = usersSnapshot;
        authCredentials.length = authCredentialsSnapshot;
        throw error;
      }
    }
  };

  return {
    prisma,
    users,
    authCredentials,
    issuerMembershipCreateCalls,
    userCreateData,
    platformAdminCreateCalls,
    issuerCreateCalls,
    userFindUniqueByIdCalls,
    userUpdateManyCalls
  };
}

function createJwtServiceStub() {
  return {
    signAsyncCalls: [] as Array<Record<string, unknown>>,
    async signAsync(payload: Record<string, unknown>, options: Record<string, unknown>) {
      this.signAsyncCalls.push({ payload, options });
      return 'signed-token';
    },
    async verifyAsync() {
      return {
        sub: 'user-123'
      };
    }
  };
}

test('AuthService.login succeeds with valid credentials and does not expose passwordHash', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  process.env.JWT_EXPIRES_IN = '2h';

  const jwtService = createJwtServiceStub();
  const prisma = {
    user: {
      async findUnique() {
        return {
          id: 'user-123',
          email: 'issuer.admin@example.com',
          did: 'did:example:issuer-admin-demo',
          status: UserStatus.active,
          displayName: null,
          firstName: 'Ada',
          lastName: 'Lovelace',
          authCredential: {
            passwordHash: await hashPassword('DemoIssuer123!')
          }
        };
      }
    }
  };

  const service = new AuthService(prisma as never, jwtService as never);
  const response = await service.login({
    email: 'issuer.admin@example.com',
    password: 'DemoIssuer123!'
  });

  assert.equal(response.accessToken, 'signed-token');
  assert.deepEqual(response.user, {
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active,
    displayLabel: 'Ada Lovelace'
  });
  assert.equal('passwordHash' in response.user, false);
  assert.deepEqual(jwtService.signAsyncCalls, [
    {
      payload: {
        sub: 'user-123'
      },
      options: {
        secret: 'demo-secret',
        expiresIn: '2h'
      }
    }
  ]);
});

test('AuthService.login fails when email does not exist', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return null;
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'missing@example.com',
      password: 'DemoIssuer123!'
    }),
    UnauthorizedException
  );
});

test('AuthService.login fails when password is incorrect', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            authCredential: {
              passwordHash: await hashPassword('DemoIssuer123!')
            }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'issuer.admin@example.com',
      password: 'WrongPassword123!'
    }),
    UnauthorizedException
  );
});

test('AuthService.login fails when user is not active', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.suspended,
            authCredential: {
              passwordHash: await hashPassword('DemoIssuer123!')
            }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.login({
      email: 'issuer.admin@example.com',
      password: 'DemoIssuer123!'
    }),
    UnauthorizedException
  );
});

// ---------------------------------------------------------------------------
// A1: AuthService.register -- registro publico de holder (email+password),
// auto-login reutilizando el mismo mecanismo de sesion que login().
// ---------------------------------------------------------------------------

test('A: register creates a User with the submitted email and active status', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: '  Persona@Example.com  ',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'persona@example.com');
  assert.equal(users[0].status, UserStatus.active);
  assert.equal(users[0].firstName, 'Ada');
  assert.equal(users[0].lastName, 'Lovelace');
  assert.equal(response.user.email, 'persona@example.com');
  assert.equal(response.user.did, null);
});

test('B: the persisted password hash never equals the submitted plaintext password', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, authCredentials } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  assert.equal(authCredentials.length, 1);
  assert.notEqual(authCredentials[0].passwordHash, 'CorrectHorse123');
  assert.match(authCredentials[0].passwordHash, /^scrypt:v1:/);
  assert.equal(
    await verifyPasswordHash('CorrectHorse123', authCredentials[0].passwordHash),
    true
  );
});

test('C: the register response never contains password or passwordHash', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('CorrectHorse123'), false);
  assert.equal(serialized.toLowerCase().includes('passwordhash'), false);
  assert.equal('password' in response.user, false);
});

test('D: register returns exactly the same response shape as login (accessToken + user)', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  assert.deepEqual(Object.keys(response).sort(), ['accessToken', 'user']);
  assert.deepEqual(Object.keys(response.user).sort(), ['did', 'displayLabel', 'email', 'id', 'status']);
  assert.equal(typeof response.accessToken, 'string');
});

test('E: register signs the JWT with the exact same secret/expiration/claims mechanism as login', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  process.env.JWT_EXPIRES_IN = '3h';
  const { prisma, users } = createRegisterPrismaDouble();
  const jwtService = createJwtServiceStub();
  const service = new AuthService(prisma as never, jwtService as never);

  await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  assert.deepEqual(jwtService.signAsyncCalls, [
    {
      payload: { sub: users[0].id },
      options: { secret: 'demo-secret', expiresIn: '3h' }
    }
  ]);
});

test('F: register rejects an already-registered email without creating a second User (pre-check path)', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({ email: 'persona@example.com', password: 'CorrectHorse123', firstName: 'Ada', lastName: 'Lovelace' });

  await assert.rejects(
    service.register({ email: 'PERSONA@example.com', password: 'AnotherPass123', firstName: 'Grace', lastName: 'Hopper' }),
    ConflictException
  );
  assert.equal(users.length, 1);
});

test('G: a concurrent unique-constraint race (P2002) maps to the same safe product error, never leaks Prisma details', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const prisma = {
    user: {
      async findUnique() {
        // Pre-check pasa (todavia no existe) pero otra request gana la
        // carrera y crea el User antes de que este llegue al create().
        return null;
      }
    },
    async $transaction() {
      throw prismaUniqueConstraintError();
    }
  };
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await assert.rejects(
    service.register({ email: 'persona@example.com', password: 'CorrectHorse123', firstName: 'Ada', lastName: 'Lovelace' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = (error as ConflictException).getResponse() as { message: string };
      assert.equal(response.message, 'Ya existe una cuenta con ese correo.');
      assert.equal(JSON.stringify(response).includes('P2002'), false);
      assert.equal(JSON.stringify(response).toLowerCase().includes('prisma'), false);
      return true;
    }
  );
});

test('H: register rejects an invalid email format', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await assert.rejects(
    service.register({ email: 'not-an-email', password: 'CorrectHorse123', firstName: 'Ada', lastName: 'Lovelace' }),
    BadRequestException
  );
  assert.equal(users.length, 0);
});

test('I: register rejects a password shorter than the minimum or longer than the maximum', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const short = createRegisterPrismaDouble();
  const serviceShort = new AuthService(short.prisma as never, createJwtServiceStub() as never);
  await assert.rejects(
    serviceShort.register({ email: 'persona@example.com', password: 'short1', firstName: 'Ada', lastName: 'Lovelace' }),
    BadRequestException
  );

  const long = createRegisterPrismaDouble();
  const serviceLong = new AuthService(long.prisma as never, createJwtServiceStub() as never);
  await assert.rejects(
    serviceLong.register({ email: 'persona@example.com', password: 'a'.repeat(129), firstName: 'Ada', lastName: 'Lovelace' }),
    BadRequestException
  );

  assert.equal(short.users.length, 0);
  assert.equal(long.users.length, 0);
});

test('J: extra fields like issuerId/role/did/status sent by the client are ignored and never control the created User', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace',
    // Campos que un cliente podria intentar mandar -- RegisterDto no los
    // declara, pero un body crudo igual podria incluirlos.
    issuerId: 'issuer-1',
    role: 'admin',
    did: 'did:example:spoofed',
    isAdmin: true,
    displayName: 'Spoofed Display Name'
  } as never);

  assert.equal(users[0].did, null);
  assert.equal(response.user.did, null);
  assert.equal('role' in response.user, false);
});

test('M/R: a User created via register never receives an IssuerMembership (issuerMembership.create is never invoked)', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, issuerMembershipCreateCalls } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({ email: 'persona@example.com', password: 'CorrectHorse123', firstName: 'Ada', lastName: 'Lovelace' });

  assert.deepEqual(issuerMembershipCreateCalls, []);
});

// ---------------------------------------------------------------------------
// A1.1: identidad humana del titular (firstName/lastName YA existian en
// User -- ver schema.prisma; no hizo falta migration). buildHolderDisplayLabel
// reutilizado de issuers/holder-display-label.ts, la misma funcion que ya
// usan issuer-holder-resolution.service.ts e issuer-credential-read.mapper.ts.
// ---------------------------------------------------------------------------

test('A1.1/A: register persists trimmed firstName/lastName and exposes a combined displayLabel', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: '  Ada  ',
    lastName: '  Lovelace  '
  });

  assert.equal(users[0].firstName, 'Ada');
  assert.equal(users[0].lastName, 'Lovelace');
  assert.equal(response.user.displayLabel, 'Ada Lovelace');
});

test('A1.1/C: register rejects an empty or whitespace-only firstName/lastName', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const missingFirst = createRegisterPrismaDouble();
  await assert.rejects(
    new AuthService(missingFirst.prisma as never, createJwtServiceStub() as never).register({
      email: 'persona@example.com', password: 'CorrectHorse123', firstName: '   ', lastName: 'Lovelace'
    }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message: string };
      assert.equal(response.message, 'Ingresá tu nombre.');
      return true;
    }
  );
  assert.equal(missingFirst.users.length, 0);

  const missingLast = createRegisterPrismaDouble();
  await assert.rejects(
    new AuthService(missingLast.prisma as never, createJwtServiceStub() as never).register({
      email: 'persona@example.com', password: 'CorrectHorse123', firstName: 'Ada', lastName: ''
    }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message: string };
      assert.equal(response.message, 'Ingresá tu apellido.');
      return true;
    }
  );
  assert.equal(missingLast.users.length, 0);
});

test('A1.1/C2: register rejects a firstName/lastName longer than the maximum', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await assert.rejects(
    service.register({
      email: 'persona@example.com', password: 'CorrectHorse123',
      firstName: 'a'.repeat(101), lastName: 'Lovelace'
    }),
    BadRequestException
  );
  assert.equal(users.length, 0);
});

test('A1.1/D: register accepts unicode names with accents, apostrophes and hyphens without extra restrictions', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'José María',
    lastName: "O'Connor-Jean-Pierre"
  });

  assert.equal(users[0].firstName, 'José María');
  assert.equal(users[0].lastName, "O'Connor-Jean-Pierre");
  assert.equal(response.user.displayLabel, "José María O'Connor-Jean-Pierre");
});

test('A1.1/E: extra privilege fields never control identity/name fields either', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({
    email: 'persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace',
    displayName: 'Spoofed Admin Name'
  } as never);

  assert.equal(users[0].displayName, null);
});

test('A1.1/H: /auth/me exposes displayLabel derived from firstName/lastName for the authenticated user', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'persona@example.com',
            did: null,
            status: UserStatus.active,
            displayName: null,
            firstName: 'Ada',
            lastName: 'Lovelace',
            issuerMemberships: []
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.equal(response.displayLabel, 'Ada Lovelace');
});

test('A1.1/I: a legacy User with null firstName/lastName/displayName still authenticates, falling back to email', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-legacy-1',
            email: 'holder.demo@example.com',
            did: 'did:example:holder-demo',
            status: UserStatus.active,
            displayName: null,
            firstName: null,
            lastName: null,
            authCredential: {
              passwordHash: await hashPassword('DemoHolder123!')
            }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.login({
    email: 'holder.demo@example.com',
    password: 'DemoHolder123!'
  });

  assert.equal(response.user.displayLabel, 'holder.demo@example.com');
});

test('K: a User created via register can immediately log in with the same email/password', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { users, authCredentials } = createRegisterPrismaDouble();
  const registerService = new AuthService(
    {
      user: {
        async findUnique(args: { where: { email: string } }) {
          return users.find((user) => user.email === args.where.email) ?? null;
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<unknown>) {
        return callback({
          user: {
            async create(args: { data: { email: string; status: UserStatus; firstName: string; lastName: string } }) {
              const created = {
                id: 'holder-registered-1',
                email: args.data.email,
                did: null,
                status: args.data.status,
                displayName: null,
                firstName: args.data.firstName,
                lastName: args.data.lastName
              };
              users.push(created);
              return created;
            },
            async findUnique(args: { where: { id: string } }) {
              return users.find((user) => user.id === args.where.id) ?? null;
            },
            async updateMany(args: {
              where: { id: string; did: null };
              data: { did: string };
            }) {
              const target = users.find(
                (user) => user.id === args.where.id && user.did === null
              );
              if (!target) return { count: 0 };
              target.did = args.data.did;
              return { count: 1 };
            }
          },
          authCredential: {
            async create(args: { data: { userId: string; passwordHash: string } }) {
              authCredentials.push(args.data);
              return args.data;
            }
          }
        });
      }
    } as never,
    createJwtServiceStub() as never
  );

  await registerService.register({
    email: 'nueva.persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  const loginService = new AuthService(
    {
      user: {
        async findUnique(args: { where: { email: string } }) {
          const user = users.find((candidate) => candidate.email === args.where.email);
          if (!user) return null;
          const credential = authCredentials.find((entry) => entry.userId === user.id);
          return { ...user, authCredential: credential ?? null };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const loginResponse = await loginService.login({
    email: 'nueva.persona@example.com',
    password: 'CorrectHorse123'
  });

  assert.equal(loginResponse.user.email, 'nueva.persona@example.com');
  assert.equal(loginResponse.user.displayLabel, 'Ada Lovelace');
  assert.equal(typeof loginResponse.accessToken, 'string');
});

test('L: a User created via register fails to log in with an incorrect password', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { users, authCredentials } = createRegisterPrismaDouble();
  const registerService = new AuthService(
    {
      user: {
        async findUnique() {
          return null;
        }
      },
      async $transaction(callback: (tx: unknown) => Promise<unknown>) {
        return callback({
          user: {
            async create(args: { data: { email: string; status: UserStatus; firstName: string; lastName: string } }) {
              const created = {
                id: 'holder-registered-2',
                email: args.data.email,
                did: null,
                status: args.data.status,
                displayName: null,
                firstName: args.data.firstName,
                lastName: args.data.lastName
              };
              users.push(created);
              return created;
            },
            async findUnique(args: { where: { id: string } }) {
              return users.find((user) => user.id === args.where.id) ?? null;
            },
            async updateMany(args: {
              where: { id: string; did: null };
              data: { did: string };
            }) {
              const target = users.find(
                (user) => user.id === args.where.id && user.did === null
              );
              if (!target) return { count: 0 };
              target.did = args.data.did;
              return { count: 1 };
            }
          },
          authCredential: {
            async create(args: { data: { userId: string; passwordHash: string } }) {
              authCredentials.push(args.data);
              return args.data;
            }
          }
        });
      }
    } as never,
    createJwtServiceStub() as never
  );

  await registerService.register({
    email: 'nueva.persona@example.com',
    password: 'CorrectHorse123',
    firstName: 'Ada',
    lastName: 'Lovelace'
  });

  const loginService = new AuthService(
    {
      user: {
        async findUnique(args: { where: { email: string } }) {
          const user = users.find((candidate) => candidate.email === args.where.email);
          if (!user) return null;
          const credential = authCredentials.find((entry) => entry.userId === user.id);
          return { ...user, authCredential: credential ?? null };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    loginService.login({
      email: 'nueva.persona@example.com',
      password: 'WrongPassword123'
    }),
    UnauthorizedException
  );
});

test('AuthService.resolveAuthenticatedUser accepts a valid JWT and loads current user from DB', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'holder.demo@example.com',
            did: 'did:example:holder-demo',
            status: UserStatus.active
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const user = await service.resolveAuthenticatedUser('valid-token');

  assert.deepEqual(user, {
    id: 'user-123',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo',
    status: UserStatus.active
  });
});

test('AuthService.resolveAuthenticatedUser rejects a valid token when the user no longer exists', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return null;
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.resolveAuthenticatedUser('valid-token'),
    UnauthorizedException
  );
});

test('AuthService.resolveAuthenticatedUser rejects an inactive authenticated user', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.suspended
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  await assert.rejects(
    service.resolveAuthenticatedUser('valid-token'),
    UnauthorizedException
  );
});

test('AuthService.getCurrentUserProfile returns only active issuer memberships', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const findUniqueCalls: Array<Record<string, unknown>> = [];
  const service = new AuthService(
    {
      user: {
        async findUnique(args: Record<string, unknown>) {
          findUniqueCalls.push(args);
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            displayName: null,
            firstName: 'Ada',
            lastName: 'Lovelace',
            onboardingIntent: null,
            issuerMemberships: [
              {
                issuerId: 'issuer-1',
                role: IssuerMembershipRole.admin,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Universidad Argentina de la Empresa (UADE)',
                  did: 'did:example:issuer-demo',
                  authorizationStatus: IssuerAuthorizationStatus.authorized
                }
              }
            ]
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response, {
    id: 'user-123',
    email: 'issuer.admin@example.com',
    did: 'did:example:issuer-admin-demo',
    status: UserStatus.active,
    displayLabel: 'Ada Lovelace',
    // O1: el contrato de /auth/me ahora incluye la intencion de onboarding.
    // null = cuenta creada antes de que Scope lo preguntara.
    onboardingIntent: null,
    // S3: el contrato de /auth/me ahora incluye la capacidad de plataforma.
    // `false` porque este double no declara la relacion `platformAdmin` --
    // justamente el caso fail-closed que cubre el test S3/3b.
    platformAdmin: false,
    issuerMemberships: [
      {
        issuerId: 'issuer-1',
        issuerName: 'Universidad Argentina de la Empresa (UADE)',
        issuerDid: 'did:example:issuer-demo',
        issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
        role: IssuerMembershipRole.admin,
        status: IssuerMembershipStatus.active
      }
    ]
  });
  assert.equal('passwordHash' in response, false);
  assert.deepEqual(Object.keys(response.issuerMemberships[0]).sort(), [
    'issuerAuthorizationStatus',
    'issuerDid',
    'issuerId',
    'issuerName',
    'role',
    'status'
  ]);
  assert.deepEqual(findUniqueCalls, [
    {
      where: {
        id: 'user-123'
      },
      select: {
        id: true,
        email: true,
        did: true,
        status: true,
        displayName: true,
        firstName: true,
        lastName: true,
        // O1: la intencion de onboarding, tal cual esta en la fila.
        onboardingIntent: true,
        // S3: solo el `id` de la relacion. Nunca `grantedAt` ni el objeto: la
        // respuesta expone un booleano y la proyeccion no pide mas que eso.
        platformAdmin: {
          select: {
            id: true
          }
        },
        issuerMemberships: {
          where: {
            status: IssuerMembershipStatus.active
          },
          select: {
            issuerId: true,
            role: true,
            status: true,
            issuer: {
              select: {
                name: true,
                did: true,
                authorizationStatus: true
              }
            }
          }
        }
      }
    }
  ]);
});

test('AuthService.getCurrentUserProfile preserves issuer status and orders active memberships deterministically', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            issuerMemberships: [
              {
                issuerId: 'issuer-z',
                role: IssuerMembershipRole.operator,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Same Institution',
                  did: null,
                  authorizationStatus: IssuerAuthorizationStatus.pending
                }
              },
              {
                issuerId: 'issuer-a',
                role: IssuerMembershipRole.operator,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Same Institution',
                  did: 'did:example:revoked',
                  authorizationStatus: IssuerAuthorizationStatus.revoked
                }
              },
              {
                issuerId: 'issuer-authorized',
                role: IssuerMembershipRole.admin,
                status: IssuerMembershipStatus.active,
                issuer: {
                  name: 'Alpha University',
                  did: 'did:example:alpha',
                  authorizationStatus: IssuerAuthorizationStatus.authorized
                }
              }
            ]
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response.issuerMemberships, [
    {
      issuerId: 'issuer-authorized',
      issuerName: 'Alpha University',
      issuerDid: 'did:example:alpha',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    },
    {
      issuerId: 'issuer-a',
      issuerName: 'Same Institution',
      issuerDid: 'did:example:revoked',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.revoked,
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.active
    },
    {
      issuerId: 'issuer-z',
      issuerName: 'Same Institution',
      issuerDid: null,
      issuerAuthorizationStatus: IssuerAuthorizationStatus.pending,
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.active
    }
  ]);
});

test('AuthService.getCurrentUserProfile returns an empty membership list when none are active', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const service = new AuthService(
    {
      user: {
        async findUnique(args: {
          select: {
            issuerMemberships: {
              where: {
                status: IssuerMembershipStatus;
              };
            };
          };
        }) {
          assert.equal(
            args.select.issuerMemberships.where.status,
            IssuerMembershipStatus.active
          );

          return {
            id: 'holder-123',
            email: 'holder.demo@example.com',
            did: 'did:example:holder-demo',
            status: UserStatus.active,
            issuerMemberships: []
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('holder-123');

  assert.deepEqual(response.issuerMemberships, []);
});

test('AuthService.getCurrentUserProfile excludes pending and revoked memberships', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const memberships = [
    {
      issuerId: 'issuer-active',
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active,
      issuer: {
        name: 'Active Institution',
        did: 'did:example:active',
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    },
    {
      issuerId: 'issuer-pending-membership',
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.pending,
      issuer: {
        name: 'Pending Membership Institution',
        did: null,
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    },
    {
      issuerId: 'issuer-revoked-membership',
      role: IssuerMembershipRole.operator,
      status: IssuerMembershipStatus.revoked,
      issuer: {
        name: 'Revoked Membership Institution',
        did: null,
        authorizationStatus: IssuerAuthorizationStatus.authorized
      }
    }
  ];

  const service = new AuthService(
    {
      user: {
        async findUnique(args: {
          select: {
            issuerMemberships: {
              where: {
                status: IssuerMembershipStatus;
              };
            };
          };
        }) {
          const requiredStatus = args.select.issuerMemberships.where.status;

          return {
            id: 'user-123',
            email: 'issuer.admin@example.com',
            did: 'did:example:issuer-admin-demo',
            status: UserStatus.active,
            issuerMemberships: memberships.filter(
              (membership) => membership.status === requiredStatus
            )
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.getCurrentUserProfile('user-123');

  assert.deepEqual(response.issuerMemberships, [
    {
      issuerId: 'issuer-active',
      issuerName: 'Active Institution',
      issuerDid: 'did:example:active',
      issuerAuthorizationStatus: IssuerAuthorizationStatus.authorized,
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active
    }
  ]);
});

// ---------------------------------------------------------------------------
// A2.1: provisioning automatico de did:web dentro de la misma transaccion de
// register (ver ensure-did-for-user.ts). Reutiliza createRegisterPrismaDouble,
// ya extendido con user.findUnique(by id)/updateMany para soportar
// ensureDidForUser.
// ---------------------------------------------------------------------------

function withDidBaseUrl<T>(value: string | undefined, run: () => Promise<T>) {
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

test('A2.1/A: register provisions a did:web and returns it in the auth response when PUBLIC_DID_BASE_URL is configured', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const response = await service.register({
      email: 'persona@example.com',
      password: 'CorrectHorse123',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });

    assert.equal(users.length, 1);
    assert.equal(users[0].did, `did:web:api.traza.example:did:users:${users[0].id}`);
    assert.equal(response.user.did, users[0].did);
  });
});

test('A2.1/B: register keeps did=null when PUBLIC_DID_BASE_URL is not configured, exactly as before A2.1', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await withDidBaseUrl(undefined, async () => {
    const response = await service.register({
      email: 'persona@example.com',
      password: 'CorrectHorse123',
      firstName: 'Ada',
      lastName: 'Lovelace'
    });

    assert.equal(users[0].did, null);
    assert.equal(response.user.did, null);
  });
});

test('A2.1/D: a client-supplied did is still ignored even when provisioning is active -- the server always derives it from the new userId', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await withDidBaseUrl('https://api.traza.example', async () => {
    const response = await service.register({
      email: 'persona@example.com',
      password: 'CorrectHorse123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      did: 'did:example:spoofed-by-client'
    } as never);

    assert.notEqual(response.user.did, 'did:example:spoofed-by-client');
    assert.equal(response.user.did, `did:web:api.traza.example:did:users:${users[0].id}`);
  });
});

test('A2.1/E: an invalid PUBLIC_DID_BASE_URL fails the whole registration -- no User/AuthCredential left behind', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, users, authCredentials } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await withDidBaseUrl('http://not-https.example', async () => {
    await assert.rejects(
      service.register({
        email: 'persona@example.com',
        password: 'CorrectHorse123',
        firstName: 'Ada',
        lastName: 'Lovelace'
      })
    );
  });

  assert.equal(users.length, 0);
  assert.equal(authCredentials.length, 0);
});

// ---------------------------------------------------------------------------
// S3: /auth/me expone la capacidad de plataforma como un booleano, y nada mas.
// ---------------------------------------------------------------------------

function createMePrismaDouble(user: Record<string, unknown>) {
  const selects: unknown[] = [];

  return {
    selects,
    prisma: {
      user: {
        async findUnique(args: { select?: unknown }) {
          selects.push(args.select);
          return user;
        }
      }
    }
  };
}

const ME_USER_BASE = {
  id: 'user-123',
  email: 'persona@example.com',
  did: null,
  status: UserStatus.active,
  displayName: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
  issuerMemberships: []
};

test('S3/1: a User without a PlatformAdmin row gets platformAdmin: false', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createMePrismaDouble({ ...ME_USER_BASE, platformAdmin: null });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  assert.equal(response.platformAdmin, false);
});

test('S3/2: a User with a PlatformAdmin row gets platformAdmin: true', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createMePrismaDouble({
    ...ME_USER_BASE,
    platformAdmin: { id: 'platform-admin-1' }
  });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  assert.equal(response.platformAdmin, true);
});

test('S3/3: /auth/me never exposes PlatformAdmin.id nor grantedAt', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, selects } = createMePrismaDouble({
    ...ME_USER_BASE,
    platformAdmin: { id: 'platform-admin-1' }
  });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  // Solo el booleano en la respuesta.
  assert.equal(typeof response.platformAdmin, 'boolean');
  assert.equal(JSON.stringify(response).includes('platform-admin-1'), false);
  assert.equal(JSON.stringify(response).includes('grantedAt'), false);
  // Y `grantedAt` ni se le pide a la base: el select solo trae el id.
  assert.equal(JSON.stringify(selects[0]).includes('grantedAt'), false);
});

test('S3/3b: platformAdmin is FAIL-CLOSED when the relation is missing from the payload', async () => {
  // Un double (o una proyeccion futura) que no declare la relacion deja
  // `undefined`. `undefined !== null` seria `true` y anunciaria una capacidad
  // inexistente; `Boolean(...)` lo resuelve en `false`.
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createMePrismaDouble({ ...ME_USER_BASE });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  assert.equal(response.platformAdmin, false);
});

test('S3/3c: the platform capability is independent from issuerMemberships', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createMePrismaDouble({
    ...ME_USER_BASE,
    platformAdmin: { id: 'platform-admin-1' },
    issuerMemberships: []
  });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  // Platform admin SIN ninguna membership: dos planos distintos.
  assert.equal(response.platformAdmin, true);
  assert.deepEqual(response.issuerMemberships, []);
});

test('S3/4: login does not expose platformAdmin -- the flag lives only in /auth/me', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const passwordHash = await hashPassword('CorrectHorse123');
  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'persona@example.com',
            did: null,
            status: UserStatus.active,
            displayName: null,
            firstName: 'Ada',
            lastName: 'Lovelace',
            authCredential: { passwordHash }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.login({
    email: 'persona@example.com',
    password: 'CorrectHorse123'
  });

  assert.equal('platformAdmin' in response.user, false);
  assert.equal(JSON.stringify(response).includes('platformAdmin'), false);
});

// ---------------------------------------------------------------------------
// O1: onboardingIntent -- INTENCION de uso, nunca autorizacion.
// ---------------------------------------------------------------------------

const O1_BASE = {
  email: 'persona@example.com',
  password: 'CorrectHorse123',
  firstName: 'Ada',
  lastName: 'Lovelace'
};

test('O1/6: register personal persiste onboardingIntent = personal', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, userCreateData } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({ ...O1_BASE, onboardingIntent: 'personal' } as never);

  assert.equal(userCreateData[0].onboardingIntent, UserOnboardingIntent.personal);
});

test('O1/7: register institutional persiste onboardingIntent = institutional', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, userCreateData } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({ ...O1_BASE, onboardingIntent: 'institutional' } as never);

  assert.equal(
    userCreateData[0].onboardingIntent,
    UserOnboardingIntent.institutional
  );
});

test('O1/8: register SIN el campo omite la columna -- queda NULL, nunca personal por default', async () => {
  // Compatibilidad de deploy: un frontend anterior a O1 no manda el campo y el
  // signup tiene que seguir funcionando. `undefined` hace que Prisma omita la
  // columna; el schema la deja en NULL.
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, userCreateData, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.register(O1_BASE);

  assert.equal(userCreateData[0].onboardingIntent, undefined);
  assert.notEqual(
    userCreateData[0].onboardingIntent,
    UserOnboardingIntent.personal
  );
  assert.equal(users.length, 1);
  assert.equal(response.user.email, 'persona@example.com');
});

test('O1/8b: null explicito se trata igual que la ausencia', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, userCreateData, users } = createRegisterPrismaDouble();
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  await service.register({ ...O1_BASE, onboardingIntent: null } as never);

  assert.equal(userCreateData[0].onboardingIntent, undefined);
  assert.equal(users.length, 1);
});

test('O1/9: un valor invalido -> 400, y NADA se crea', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  // Sin casing alternativo y sin trim: un enum no es texto libre.
  const invalidos: unknown[] = [
    'PERSONAL',
    'Institutional',
    ' personal ',
    'personal ',
    'holder',
    'admin',
    'issuer',
    '',
    42,
    true,
    {},
    [],
    ['personal']
  ];

  for (const onboardingIntent of invalidos) {
    const { prisma, users, authCredentials } = createRegisterPrismaDouble();
    const service = new AuthService(prisma as never, createJwtServiceStub() as never);

    await assert.rejects(
      service.register({ ...O1_BASE, onboardingIntent } as never),
      BadRequestException,
      `deberia rechazar ${JSON.stringify(onboardingIntent)}`
    );

    assert.equal(users.length, 0, 'no crea el User');
    assert.equal(authCredentials.length, 0, 'no crea la AuthCredential');
  }
});

test('O1/10-13: NINGUNA rama de intent crea IssuerMembership, PlatformAdmin ni Issuer', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  for (const onboardingIntent of ['personal', 'institutional', undefined]) {
    const {
      prisma,
      users,
      issuerMembershipCreateCalls,
      platformAdminCreateCalls,
      issuerCreateCalls
    } = createRegisterPrismaDouble();
    const service = new AuthService(prisma as never, createJwtServiceStub() as never);

    await service.register({ ...O1_BASE, onboardingIntent } as never);

    assert.equal(users.length, 1);
    assert.deepEqual(
      issuerMembershipCreateCalls,
      [],
      `intent=${String(onboardingIntent)} no debe crear IssuerMembership`
    );
    assert.deepEqual(platformAdminCreateCalls, []);
    assert.deepEqual(issuerCreateCalls, []);
  }
});

test('O1: institutional NO otorga ninguna capacidad -- el User sale igual que personal', async () => {
  // La respuesta de register no lleva rol, ni membership, ni flag de
  // plataforma, ni nada que difiera entre las dos ramas.
  process.env.JWT_SECRET = 'demo-secret';

  const personal = createRegisterPrismaDouble();
  const institutional = createRegisterPrismaDouble();

  const personalResponse = await new AuthService(
    personal.prisma as never,
    createJwtServiceStub() as never
  ).register({ ...O1_BASE, onboardingIntent: 'personal' } as never);

  const institutionalResponse = await new AuthService(
    institutional.prisma as never,
    createJwtServiceStub() as never
  ).register({ ...O1_BASE, onboardingIntent: 'institutional' } as never);

  assert.deepEqual(
    Object.keys(personalResponse.user).sort(),
    Object.keys(institutionalResponse.user).sort()
  );
  assert.equal('onboardingIntent' in institutionalResponse.user, false);
  assert.equal('role' in institutionalResponse.user, false);
  assert.equal('platformAdmin' in institutionalResponse.user, false);
  assert.equal('issuerMemberships' in institutionalResponse.user, false);
});

test('O1/14-16: /auth/me proyecta onboardingIntent tal cual, incluido null legacy', async () => {
  process.env.JWT_SECRET = 'demo-secret';

  const casos = [
    [UserOnboardingIntent.personal, UserOnboardingIntent.personal],
    [UserOnboardingIntent.institutional, UserOnboardingIntent.institutional],
    [null, null]
  ] as const;

  for (const [stored, esperado] of casos) {
    const { prisma } = createMePrismaDouble({
      ...ME_USER_BASE,
      onboardingIntent: stored,
      platformAdmin: null
    });
    const service = new AuthService(prisma as never, createJwtServiceStub() as never);

    const response = await service.getCurrentUserProfile('user-123');

    assert.equal(response.onboardingIntent, esperado);
  }
});

test('O1: /auth/me pide onboardingIntent en el select, y no inventa un default', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma, selects } = createMePrismaDouble({
    ...ME_USER_BASE,
    onboardingIntent: null,
    platformAdmin: null
  });
  const service = new AuthService(prisma as never, createJwtServiceStub() as never);

  const response = await service.getCurrentUserProfile('user-123');

  assert.equal(JSON.stringify(selects[0]).includes('onboardingIntent'), true);
  // null se proyecta como null: el router lo trata como el espacio personal,
  // pero el DATO conserva la distincion con una eleccion explicita.
  assert.equal(response.onboardingIntent, null);
  assert.notEqual(response.onboardingIntent, UserOnboardingIntent.personal);
});

test('O1: login NO expone onboardingIntent -- vive solo en /auth/me', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const passwordHash = await hashPassword('CorrectHorse123');
  const service = new AuthService(
    {
      user: {
        async findUnique() {
          return {
            id: 'user-123',
            email: 'persona@example.com',
            did: null,
            status: UserStatus.active,
            displayName: null,
            firstName: 'Ada',
            lastName: 'Lovelace',
            onboardingIntent: UserOnboardingIntent.institutional,
            authCredential: { passwordHash }
          };
        }
      }
    } as never,
    createJwtServiceStub() as never
  );

  const response = await service.login({
    email: 'persona@example.com',
    password: 'CorrectHorse123'
  });

  assert.equal('onboardingIntent' in response.user, false);
  assert.equal(JSON.stringify(response).includes('institutional'), false);
});

test('O1: el intent NUNCA entra al JWT', async () => {
  process.env.JWT_SECRET = 'demo-secret';
  const { prisma } = createRegisterPrismaDouble();
  const jwt = createJwtServiceStub();
  const service = new AuthService(prisma as never, jwt as never);

  await service.register({ ...O1_BASE, onboardingIntent: 'institutional' } as never);

  const payload = jwt.signAsyncCalls[0].payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload), ['sub']);
  assert.equal('onboardingIntent' in payload, false);
});
