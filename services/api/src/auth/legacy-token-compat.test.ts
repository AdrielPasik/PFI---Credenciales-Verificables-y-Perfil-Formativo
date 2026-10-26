/**
 * Compatibilidad de access tokens entre la API DESPLEGADA (8a567f54...) y la API con
 * `sessionVersion` -- T1 y T3 del informe 11b.
 *
 * Solo claves y datos de prueba. Sin base de datos: la verificacion contra PostgreSQL
 * real vive en `legacy-token-compat.pg.test.ts`.
 *
 * T1  Un token con el formato EXACTO que emite la API actualmente desplegada (sin `sv`)
 *     sigue siendo aceptado por el codigo nuevo mientras la cuenta este en la version 0.
 * T3  Un token que emite el codigo nuevo (con `sv`) es aceptado por la logica de
 *     verificacion ANTERIOR, copiada literalmente del codigo desplegado. Es lo que
 *     permite volver a la imagen anterior antes de la primera activacion.
 *
 * Este test NO cambia ni relaja el comportamiento de autenticacion: solo lo fija.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { hashPassword } from './password-hashing';

const SECRET = 'legacy-token-compat-test-secret';
const OTHER_SECRET = 'a-different-test-secret';
const PASSWORD = 'CorrectHorse123';
const INVALID_TOKEN_MESSAGE = 'Token invalido o expirado.';

process.env.JWT_SECRET = SECRET;
delete process.env.JWT_EXPIRES_IN;
delete process.env.PUBLIC_DID_BASE_URL;

const jwt = new JwtService({});

// ---------------------------------------------------------------------------
// El formato de la API desplegada, congelado
// ---------------------------------------------------------------------------

/**
 * Firma EXACTAMENTE como la API desplegada (`services/api/src/auth/auth.service.ts`
 * de 8a567f5): `jwtService.signAsync({ sub }, { secret, expiresIn })`, sin ningun
 * otro claim y con el vencimiento por defecto de 1 h. No usa ningun helper de la API
 * nueva a proposito: si el formato de la API nueva divergiera, esto seguiria firmando
 * lo que hoy esta en produccion.
 */
async function signLikeDeployedApi(
  sub: string,
  options: { secret?: string; expiresIn?: string | number } = {}
): Promise<string> {
  return new JwtService({}).signAsync(
    { sub },
    { secret: options.secret ?? SECRET, expiresIn: (options.expiresIn ?? '1h') as never }
  );
}

/**
 * Copia LITERAL de `resolveAuthenticatedUser` de la API desplegada (8a567f5), salvo la
 * inyeccion de dependencias. Es la logica contra la que debe seguir funcionando un
 * token emitido por la API nueva si hay que volver a la imagen anterior.
 */
async function deployedResolveAuthenticatedUser(
  jwtService: JwtService,
  prisma: { user: { findUnique(args: never): Promise<unknown> } },
  token: string
) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new UnauthorizedException('Bearer token requerido.');
  }

  let payload: { sub?: unknown };

  try {
    payload = await jwtService.verifyAsync<{ sub?: unknown }>(token, { secret: SECRET });
  } catch {
    throw new UnauthorizedException('Token invalido o expirado.');
  }

  if (!payload?.sub || typeof payload.sub !== 'string') {
    throw new UnauthorizedException('Token invalido o expirado.');
  }

  const user = (await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, did: true, status: true }
  } as never)) as { id: string; email: string | null; did: string | null; status: UserStatus } | null;

  if (!user || !user.email) {
    throw new UnauthorizedException('Usuario autenticado no valido.');
  }

  if (user.status !== UserStatus.active) {
    throw new UnauthorizedException('El usuario no esta activo.');
  }

  return { id: user.id, email: user.email, did: user.did, status: user.status };
}

// ---------------------------------------------------------------------------
// Doble minimo de Prisma: proyecta ESTRICTAMENTE lo que el codigo pide en `select`
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  email: string;
  status: UserStatus;
  passwordHash: string;
  sessionVersion: number | null;
}

function worldWith(row: Row) {
  const prisma = {
    user: {
      async findUnique(args: {
        where: { id?: string; email?: string };
        select?: Record<string, unknown>;
        include?: { authCredential?: boolean };
      }) {
        const matches =
          args.where.id !== undefined ? row.id === args.where.id : row.email === args.where.email;
        if (!matches) return null;

        const credential =
          row.sessionVersion === null
            ? null
            : { passwordHash: row.passwordHash, sessionVersion: row.sessionVersion };
        const scalars: Record<string, unknown> = {
          id: row.id,
          email: row.email,
          did: null,
          status: row.status,
          displayName: null,
          firstName: 'Ada',
          lastName: 'Lovelace'
        };

        if (args.include?.authCredential) return { ...scalars, authCredential: credential };

        const projected: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args.select ?? {})) {
          if (key === 'authCredential') {
            const nested = (value as { select?: Record<string, boolean> }).select ?? {};
            projected.authCredential = credential
              ? Object.fromEntries(
                  Object.entries(nested)
                    .filter(([, wanted]) => wanted === true)
                    .map(([field]) => [field, (credential as Record<string, unknown>)[field]])
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
  return { prisma, row };
}

async function holder(sessionVersion: number | null = 0, id = 'holder-legacy'): Promise<Row> {
  return {
    id,
    email: `${id}@example.com`,
    status: UserStatus.active,
    passwordHash: await hashPassword(PASSWORD),
    sessionVersion
  };
}

const serviceFor = (prisma: unknown) => new AuthService(prisma as never, jwt);
const guardFor = (service: AuthService) => new AuthGuard(service);

function requestWith(token: string) {
  return { headers: { authorization: `Bearer ${token}` }, user: undefined as unknown };
}
function contextFor(request: unknown) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

const decodeSegment = (segment: string) =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
const headerOf = (token: string) => decodeSegment(token.split('.')[0]);
const payloadOf = (token: string) => decodeSegment(token.split('.')[1]);

// ---------------------------------------------------------------------------
// T1 -- token de la API desplegada -> codigo nuevo
// ---------------------------------------------------------------------------

test('T1: el fixture tiene el formato de la API desplegada -- HS256 y solo { sub, iat, exp }, sin sv', async () => {
  const token = await signLikeDeployedApi('holder-legacy');

  assert.equal(headerOf(token).alg, 'HS256');
  assert.equal(headerOf(token).typ, 'JWT');
  assert.deepEqual(Object.keys(payloadOf(token)).sort(), ['exp', 'iat', 'sub']);
  assert.equal(Object.prototype.hasOwnProperty.call(payloadOf(token), 'sv'), false);

  const { exp, iat } = payloadOf(token) as { exp: number; iat: number };
  assert.equal(exp - iat, 3600, 'vencimiento por defecto de 1 h, igual que la API desplegada');
});

test('T1: AuthService nuevo acepta el token legado con la cuenta en version 0 (el default tras migrar)', async () => {
  const { prisma } = worldWith(await holder(0));
  const token = await signLikeDeployedApi('holder-legacy');

  const user = await serviceFor(prisma).resolveAuthenticatedUser(token);

  assert.equal(user.id, 'holder-legacy');
  assert.equal(user.email, 'holder-legacy@example.com');
  assert.deepEqual(Object.keys(user).sort(), ['did', 'email', 'id', 'status']);
});

test('T1: AuthGuard nuevo deja pasar al token legado y publica al usuario', async () => {
  const { prisma } = worldWith(await holder(0));
  const token = await signLikeDeployedApi('holder-legacy');

  const request = requestWith(token);
  assert.equal(await guardFor(serviceFor(prisma)).canActivate(contextFor(request)), true);
  assert.equal((request.user as { id: string }).id, 'holder-legacy');
});

test('T1: el token legado deja de valer cuando la cuenta se invalida (version 1) -- por diseno', async () => {
  const world = worldWith(await holder(0));
  const guard = guardFor(serviceFor(world.prisma));
  const token = await signLikeDeployedApi('holder-legacy');

  assert.equal(await guard.canActivate(contextFor(requestWith(token))), true);

  world.row.sessionVersion = 1;

  await assert.rejects(
    guard.canActivate(contextFor(requestWith(token))),
    (error: unknown) =>
      error instanceof UnauthorizedException && error.message === INVALID_TOKEN_MESSAGE
  );
});

test('T1: la compatibilidad no ablanda nada -- vencido, firma ajena y usuario inactivo siguen rechazados', async () => {
  const active = worldWith(await holder(0));
  const service = serviceFor(active.prisma);

  const expired = await signLikeDeployedApi('holder-legacy', { expiresIn: -10 });
  await assert.rejects(service.resolveAuthenticatedUser(expired), UnauthorizedException);

  const foreign = await signLikeDeployedApi('holder-legacy', { secret: OTHER_SECRET });
  await assert.rejects(service.resolveAuthenticatedUser(foreign), UnauthorizedException);

  const inactive = worldWith({ ...(await holder(0)), status: UserStatus.suspended });
  await assert.rejects(
    serviceFor(inactive.prisma).resolveAuthenticatedUser(await signLikeDeployedApi('holder-legacy')),
    UnauthorizedException
  );
});

test('T1: sv AUSENTE vale 0, pero un sv invalido nunca se lee como 0 (sigue rechazado)', async () => {
  const { prisma } = worldWith(await holder(0));
  const service = serviceFor(prisma);

  for (const claim of ['0', null, 0.5, -1, true]) {
    const token = await jwt.signAsync({ sub: 'holder-legacy', sv: claim }, { secret: SECRET, expiresIn: '1h' });
    await assert.rejects(service.resolveAuthenticatedUser(token), UnauthorizedException, `sv=${JSON.stringify(claim)}`);
  }
});

// ---------------------------------------------------------------------------
// T3 -- token del codigo nuevo -> logica de verificacion anterior
// ---------------------------------------------------------------------------

test('T3: el login nuevo emite exactamente { sub, sv, iat, exp }, HS256, 1 h', async () => {
  const { prisma } = worldWith(await holder(0));

  const { accessToken } = await serviceFor(prisma).login({
    email: 'holder-legacy@example.com',
    password: PASSWORD
  });

  assert.equal(headerOf(accessToken).alg, 'HS256');
  assert.deepEqual(Object.keys(payloadOf(accessToken)).sort(), ['exp', 'iat', 'sub', 'sv']);
  assert.equal(payloadOf(accessToken).sv, 0);
  const { exp, iat } = payloadOf(accessToken) as { exp: number; iat: number };
  assert.equal(exp - iat, 3600);
});

test('T3: la verificacion ANTERIOR (copia literal de 8a567f5) acepta el token nuevo e ignora sv', async () => {
  const { prisma } = worldWith(await holder(0));
  const { accessToken } = await serviceFor(prisma).login({
    email: 'holder-legacy@example.com',
    password: PASSWORD
  });

  const user = await deployedResolveAuthenticatedUser(jwt, prisma, accessToken);

  assert.equal(user.id, 'holder-legacy');
});

test('T3: la logica anterior acepta CUALQUIER valor de sv (no lo lee): un rollback no rompe sesiones emitidas', async () => {
  const { prisma } = worldWith(await holder(0));

  for (const sv of [0, 1, 7]) {
    const token = await jwt.signAsync({ sub: 'holder-legacy', sv }, { secret: SECRET, expiresIn: '1h' });
    const user = await deployedResolveAuthenticatedUser(jwt, prisma, token);
    assert.equal(user.id, 'holder-legacy', `sv=${sv}`);
  }
});

test('T3: la logica anterior sigue rechazando lo que siempre rechazo (control del propio fixture)', async () => {
  const { prisma } = worldWith(await holder(0));

  await assert.rejects(
    deployedResolveAuthenticatedUser(jwt, prisma, await signLikeDeployedApi('holder-legacy', { expiresIn: -10 })),
    UnauthorizedException
  );
  await assert.rejects(
    deployedResolveAuthenticatedUser(jwt, prisma, await signLikeDeployedApi('holder-legacy', { secret: OTHER_SECRET })),
    UnauthorizedException
  );
});
