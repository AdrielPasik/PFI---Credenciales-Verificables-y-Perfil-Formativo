/**
 * CIRCUITO INSTITUCIONAL DE SCOPE -- E2E integrado. Slice S7a.
 *
 * GIVEN una persona que se registro para uso institucional y no posee
 * autoridad,
 *
 * WHEN un PlatformAdmin crea una institucion y la designa explicitamente como
 * administradora,
 *
 * THEN la persona abandona el estado pending tras revalidar su sesion y
 * obtiene acceso institucional;
 *
 * AND otro User sin membership continua sin acceso;
 *
 * AND el PlatformAdmin tampoco obtiene acceso institucional solo por su
 * capacidad global;
 *
 * AND la institucion sigue sin poder emitir hasta completar su identidad
 * tecnica.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE DE LA EVIDENCIA -- leer antes de citar este archivo
 * ---------------------------------------------------------------------------
 *
 * CODIGO PRODUCTIVO REALMENTE EJECUTADO: el servidor HTTP de Nest con su
 * routing y su mapeo de excepciones a status, `AuthController`/`AuthService`
 * (registro, login, `/auth/me`), firma y verificacion de JWT reales, hashing y
 * verificacion de password, `AuthGuard`, `PlatformAdminGuard`, los cuatro
 * controllers de `/admin` con sus validadores y DTOs, los services de S3/S4/
 * S5a/S5b, `IssuersService.assertUserCanOperateAuthorizedIssuer`,
 * `assertIssuerCanIssue`, `IssuerCourseTemplatesController` y el bootstrap
 * real de S2.
 *
 * SUSTITUIDO POR UN DOBLE: la persistencia, y nada mas (ver
 * `in-memory-prisma.ts`). No hay PostgreSQL en este entorno y conectarse a una
 * base remota esta prohibido.
 *
 * NO EJERCITADO, DELIBERADAMENTE: browser real, deployment real, base de datos
 * productiva, AWS, Vercel y blockchain. Esto NO es un "E2E de produccion": es
 * una prueba integrada de superficies, contratos y reglas de autorizacion
 * productivas con las dependencias externas aisladas.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { IssuerAuthorizationStatus } from '@prisma/client';

import { grantPlatformAdminByEmail } from '../../prisma/bootstrap-platform-admin';
import { IssuersService } from '../../src/issuers/issuers.service';
import {
  ACTORS,
  loginActor,
  registerActor,
  startE2eApi,
  type E2eClient,
  type RegisteredActor
} from './harness';

const ISSUER_NAME = 'Scope E2E Institute';
const ISSUER_LEGAL_NAME = 'Scope E2E Institute Test Entity';

let client: E2eClient;

before(async () => {
  client = await startE2eApi();
});

after(async () => {
  await client.close();
});

/** Aislamiento: cada test arranca con la persistencia vacia. */
beforeEach(() => {
  client.prisma.reset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * P: User real + fila `PlatformAdmin` creada por el WRITER REAL de S2
 * (`grantPlatformAdminByEmail`), no por un atajo del test. No hay ningun
 * endpoint HTTP que otorgue la capacidad de plataforma, y S7a no inventa uno.
 */
async function createPlatformAdmin(): Promise<RegisteredActor> {
  const actor = await registerActor(client, ACTORS.platformAdmin, {
    onboardingIntent: 'personal',
    firstName: 'Adriel',
    lastName: 'Plataforma'
  });

  const summary = await grantPlatformAdminByEmail(
    client.prisma as never,
    actor.email
  );
  assert.equal(summary.status, 'created');
  assert.equal(summary.userId, actor.userId);

  return actor;
}

/** A: la persona que se registro con intencion institucional. */
async function createInstitutionalUser(): Promise<RegisteredActor> {
  return registerActor(client, ACTORS.institutionalUser, {
    onboardingIntent: 'institutional',
    firstName: 'Ana',
    lastName: 'Institucional'
  });
}

async function provisionIssuer(
  platformAdminToken: string,
  initialAdminEmail: string
) {
  return client.request<{
    issuer: {
      id: string;
      name: string;
      legalName: string | null;
      authorizationStatus: string;
      technicalIdentity: {
        didConfigured: boolean;
        walletConfigured: boolean;
        readyToIssue: boolean;
      };
    };
    initialAdminMembership: {
      userId: string;
      email: string | null;
      displayLabel: string;
      role: string;
      status: string;
    };
  }>('POST', '/admin/issuers', {
    token: platformAdminToken,
    body: {
      name: ISSUER_NAME,
      legalName: ISSUER_LEGAL_NAME,
      initialAdminUserEmail: initialAdminEmail
    }
  });
}

/**
 * La lectura institucional protegida que se usa como prueba de autoridad:
 * `GET /issuers/:issuerId/course-templates` pasa por `AuthGuard` y por
 * `IssuersService.assertUserCanOperateAuthorizedIssuer`, y para una
 * institucion recien creada devuelve una lista vacia -- 200 limpio sin tocar
 * el catalogo academico.
 */
function readInstitutionalSurface(issuerId: string, token: string) {
  return client.request<unknown[]>(
    'GET',
    `/issuers/${issuerId}/course-templates`,
    { token }
  );
}

// ---------------------------------------------------------------------------
// ESCENARIO NARRATIVO COMPLETO (capa C)
// ---------------------------------------------------------------------------

describe('S7a -- circuito institucional de punta a punta', () => {
  it('recorre signup institucional -> pending -> alta por PlatformAdmin -> acceso institucional', async () => {
    // ---- GIVEN: una persona se registra para uso institucional -----------
    const a = await createInstitutionalUser();

    const meBeforeGrant = await client.request<{
      platformAdmin: boolean;
      onboardingIntent: string | null;
      issuerMemberships: unknown[];
    }>('GET', '/auth/me', { token: a.token });

    assert.equal(meBeforeGrant.status, 200);
    // La intencion quedo registrada...
    assert.equal(meBeforeGrant.body.onboardingIntent, 'institutional');
    // ...y NO otorgo ninguna autoridad.
    assert.equal(meBeforeGrant.body.platformAdmin, false);
    assert.deepEqual(meBeforeGrant.body.issuerMemberships, []);
    // Ninguna institucion existe todavia: la intencion no crea nada.
    assert.equal(client.prisma.state.issuers.length, 0);
    assert.equal(client.prisma.state.issuerMemberships.length, 0);
    assert.equal(client.prisma.state.platformAdmins.length, 0);

    // ---- AND: un tercero sin autoridad -----------------------------------
    const b = await registerActor(client, ACTORS.outsider, {
      onboardingIntent: 'personal'
    });

    // ---- WHEN: un PlatformAdmin da de alta la institucion ----------------
    const p = await createPlatformAdmin();

    const mePlatformAdmin = await client.request<{ platformAdmin: boolean }>(
      'GET',
      '/auth/me',
      { token: p.token }
    );
    assert.equal(mePlatformAdmin.body.platformAdmin, true);

    // Primero resuelve a la persona por email -- confirmacion visual.
    const resolved = await client.request<{
      email: string;
      displayLabel: string;
    }>('POST', '/admin/users/resolve', {
      token: p.token,
      body: { email: a.email }
    });

    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.email, a.email);
    assert.equal(resolved.body.displayLabel, 'Ana Institucional');
    // El contrato de S4 no filtra el identificador de la persona.
    assert.deepEqual(Object.keys(resolved.body).sort(), [
      'displayLabel',
      'email'
    ]);

    // Y despues crea la institucion designandola primera administradora.
    const provisioned = await provisionIssuer(p.token, a.email);

    assert.equal(provisioned.status, 201);
    const issuerId = provisioned.body.issuer.id;
    assert.equal(provisioned.body.issuer.authorizationStatus, 'authorized');
    assert.deepEqual(provisioned.body.issuer.technicalIdentity, {
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false
    });
    assert.equal(provisioned.body.initialAdminMembership.role, 'admin');
    assert.equal(provisioned.body.initialAdminMembership.status, 'active');
    assert.equal(provisioned.body.initialAdminMembership.email, a.email);

    // ---- THEN: A sale de pending DESPUES de revalidar --------------------
    // El token viejo de A sigue siendo valido, pero su contexto se relee en
    // cada `/auth/me`: no hay nada cacheado en el servidor.
    const meAfterGrant = await client.request<{
      platformAdmin: boolean;
      onboardingIntent: string | null;
      issuerMemberships: Array<{
        issuerId: string;
        role: string;
        status: string;
      }>;
    }>('GET', '/auth/me', { token: a.token });

    assert.equal(meAfterGrant.status, 200);
    assert.equal(meAfterGrant.body.issuerMemberships.length, 1);
    assert.equal(meAfterGrant.body.issuerMemberships[0].issuerId, issuerId);
    assert.equal(meAfterGrant.body.issuerMemberships[0].role, 'admin');
    assert.equal(meAfterGrant.body.issuerMemberships[0].status, 'active');
    // La intencion de onboarding NO cambio: la membership la deja irrelevante.
    assert.equal(meAfterGrant.body.onboardingIntent, 'institutional');
    // Y seguir teniendo intencion institucional no la volvio PlatformAdmin.
    assert.equal(meAfterGrant.body.platformAdmin, false);

    // ---- AND: A ya puede operar la institucion ---------------------------
    const aReads = await readInstitutionalSurface(issuerId, a.token);
    assert.equal(aReads.status, 200);
    assert.deepEqual(aReads.body, []);

    // ---- AND: el outsider sigue sin acceso -------------------------------
    const bReads = await readInstitutionalSurface(issuerId, b.token);
    assert.equal(bReads.status, 403);

    // ---- AND: el PlatformAdmin TAMPOCO tiene acceso institucional -------
    // Creo la institucion, pero no se asigno a si mismo.
    const pReads = await readInstitutionalSurface(issuerId, p.token);
    assert.equal(
      pReads.status,
      403,
      'la capacidad de plataforma no es autoridad institucional'
    );

    // Y sin embargo SI puede observarla desde el plano de plataforma.
    const adminList = await client.request<{ items: Array<{ id: string }> }>(
      'GET',
      '/admin/issuers',
      { token: p.token }
    );
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.items.length, 1);
    assert.equal(adminList.body.items[0].id, issuerId);

    // ---- AND: la institucion todavia no puede emitir ---------------------
    const issuerRow = client.prisma.state.issuers.find(
      (row) => row.id === issuerId
    );
    assert.ok(issuerRow);
    assert.equal(issuerRow.authorizationStatus, 'authorized');
    assert.equal(issuerRow.did, null);
    assert.equal(issuerRow.walletAddress, null);

    // La regla real de emision, sobre la fila real que quedo persistida.
    const issuersService = new IssuersService(client.prisma as never);
    assert.throws(
      () => issuersService.assertIssuerCanIssue(issuerRow as never),
      /no tiene walletAddress configurado/,
      'authorized operacionalmente NO es listo tecnicamente para emitir'
    );
  });
});

// ---------------------------------------------------------------------------
// ESCENARIOS 1-3: onboarding sin autoridad
// ---------------------------------------------------------------------------

describe('S7a/1 -- signup institucional no otorga autoridad', () => {
  it('persiste la intencion y no crea Issuer, membership ni PlatformAdmin', async () => {
    const a = await createInstitutionalUser();

    const stored = client.prisma.state.users.find((u) => u.id === a.userId);
    assert.ok(stored);
    assert.equal(stored.onboardingIntent, 'institutional');
    assert.equal(stored.status, 'active');

    assert.deepEqual(client.prisma.state.issuers, []);
    assert.deepEqual(client.prisma.state.issuerMemberships, []);
    assert.deepEqual(client.prisma.state.platformAdmins, []);
    // Tampoco se audita nada: no hubo ningun hecho administrativo.
    assert.deepEqual(client.prisma.state.auditLogs, []);
  });

  it('no provisiona identidad tecnica de EMISOR (distinta de la identidad personal)', async () => {
    // La identidad PERSONAL del User es otro plano: si algun dia el signup
    // persistiera un `did:web` propio por configuracion, eso no seria un
    // fallo. Lo que se congela es que la intencion institucional no crea
    // NADA de identidad tecnica de un emisor, porque no hay emisor.
    await createInstitutionalUser();

    assert.deepEqual(
      client.prisma.state.issuers,
      [],
      'sin Issuer no hay DID ni wallet de emisor que provisionar'
    );
  });

  it('un User con intencion institucional NO puede crear una institucion', async () => {
    // No hay autoservicio: el endpoint de alta exige capacidad de plataforma.
    const a = await createInstitutionalUser();

    const attempt = await provisionIssuer(a.token, a.email);

    assert.equal(attempt.status, 403);
    assert.deepEqual(client.prisma.state.issuers, []);
  });
});

describe('S7a/2 -- A esta pending antes del grant', () => {
  it('/auth/me no reporta capacidad ni memberships operacionales', async () => {
    const a = await createInstitutionalUser();

    const me = await client.request<{
      platformAdmin: boolean;
      issuerMemberships: unknown[];
    }>('GET', '/auth/me', { token: a.token });

    assert.equal(me.status, 200);
    assert.equal(me.body.platformAdmin, false);
    assert.deepEqual(me.body.issuerMemberships, []);
  });

  it('no puede entrar a /admin', async () => {
    const a = await createInstitutionalUser();

    for (const path of ['/admin/issuers']) {
      const response = await client.request('GET', path, { token: a.token });
      assert.equal(response.status, 403);
    }
  });
});

describe('S7a/3 -- outsider sin autoridad', () => {
  it('no tiene capacidad de plataforma ni acceso institucional', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();
    const b = await registerActor(client, ACTORS.outsider, {
      onboardingIntent: 'personal'
    });

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    const me = await client.request<{
      platformAdmin: boolean;
      issuerMemberships: unknown[];
    }>('GET', '/auth/me', { token: b.token });
    assert.equal(me.body.platformAdmin, false);
    assert.deepEqual(me.body.issuerMemberships, []);

    assert.equal(
      (await client.request('GET', '/admin/issuers', { token: b.token })).status,
      403
    );
    assert.equal(
      (await readInstitutionalSurface(issuerId, b.token)).status,
      403
    );
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 4: acceso de plataforma
// ---------------------------------------------------------------------------

describe('S7a/4 -- PlatformAdmin sin membership accede a /admin', () => {
  it('platformAdmin=true y las dos lecturas administrativas responden 200', async () => {
    const p = await createPlatformAdmin();

    const me = await client.request<{
      platformAdmin: boolean;
      issuerMemberships: unknown[];
    }>('GET', '/auth/me', { token: p.token });

    assert.equal(me.body.platformAdmin, true);
    // El punto del escenario: NINGUNA membership, y aun asi entra.
    assert.deepEqual(me.body.issuerMemberships, []);

    const issuers = await client.request<{ items: unknown[] }>(
      'GET',
      '/admin/issuers',
      { token: p.token }
    );
    assert.equal(issuers.status, 200);
    assert.deepEqual(issuers.body.items, []);
  });

  it('sin token, /admin responde 401 y no 403', async () => {
    const unauthenticated = await client.request('GET', '/admin/issuers');
    assert.equal(unauthenticated.status, 401);
  });

  it('el bootstrap de S2 es idempotente', async () => {
    const actor = await registerActor(client, ACTORS.platformAdmin, {
      onboardingIntent: 'personal'
    });

    const first = await grantPlatformAdminByEmail(
      client.prisma as never,
      actor.email
    );
    const second = await grantPlatformAdminByEmail(
      client.prisma as never,
      actor.email
    );

    assert.equal(first.status, 'created');
    assert.equal(second.status, 'already_exists');
    assert.equal(second.platformAdminId, first.platformAdminId);
    // Una sola fila y UNA sola auditoria: la segunda corrida no es un hecho.
    assert.equal(client.prisma.state.platformAdmins.length, 1);
    assert.equal(
      client.prisma.state.auditLogs.filter(
        (row) => row.action === 'platform_admin_granted'
      ).length,
      1
    );
  });
});

// ---------------------------------------------------------------------------
// ESCENARIOS 5 y 12: resolucion de usuario
// ---------------------------------------------------------------------------

describe('S7a/5+12 -- resolucion de usuario por email', () => {
  it('devuelve email y displayLabel, y NUNCA userId', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const resolved = await client.request<Record<string, unknown>>(
      'POST',
      '/admin/users/resolve',
      { token: p.token, body: { email: a.email } }
    );

    assert.equal(resolved.status, 200);
    assert.deepEqual(Object.keys(resolved.body).sort(), [
      'displayLabel',
      'email'
    ]);
    const serialized = JSON.stringify(resolved.body);
    assert.equal(serialized.includes(a.userId), false);
    assert.equal(serialized.includes('userId'), false);
  });

  it('un email inexistente da 404 uniforme', async () => {
    const p = await createPlatformAdmin();

    const resolved = await client.request<{ message: string }>(
      'POST',
      '/admin/users/resolve',
      { token: p.token, body: { email: 'nadie.e2e@example.test' } }
    );

    assert.equal(resolved.status, 404);
    assert.match(resolved.body.message, /No se encontro un usuario elegible/);
  });

  it('un User NO elegible por status da el MISMO 404, sin filtrar el estado', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    // Fixture de persistencia: la cuenta deja de ser elegible.
    const stored = client.prisma.state.users.find((u) => u.id === a.userId);
    assert.ok(stored);
    stored.status = 'suspended' as never;

    const resolved = await client.request<{ message: string }>(
      'POST',
      '/admin/users/resolve',
      { token: p.token, body: { email: a.email } }
    );

    assert.equal(resolved.status, 404);
    assert.match(resolved.body.message, /No se encontro un usuario elegible/);
    // No se revela NADA del estado interno de la cuenta.
    const serialized = JSON.stringify(resolved.body).toLowerCase();
    for (const leak of ['suspend', 'archiv', 'pending', 'inactiv']) {
      assert.equal(
        serialized.includes(leak),
        false,
        `la respuesta no debe mencionar "${leak}"`
      );
    }
  });

  it('el cliente no puede mandar userId en el body', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const attempt = await client.request('POST', '/admin/users/resolve', {
      token: p.token,
      body: { email: a.email, userId: a.userId }
    });

    assert.equal(attempt.status, 400);
  });
});

// ---------------------------------------------------------------------------
// ESCENARIOS 6 y 22: provisioning y auditoria
// ---------------------------------------------------------------------------

describe('S7a/6+22 -- alta de institucion y auditoria', () => {
  it('crea Issuer authorized sin identidad tecnica, con su primer admin', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);

    assert.equal(provisioned.status, 201);
    assert.equal(provisioned.body.issuer.name, ISSUER_NAME);
    assert.equal(provisioned.body.issuer.legalName, ISSUER_LEGAL_NAME);
    assert.equal(provisioned.body.issuer.authorizationStatus, 'authorized');
    assert.deepEqual(provisioned.body.issuer.technicalIdentity, {
      didConfigured: false,
      walletConfigured: false,
      readyToIssue: false
    });

    // La fila real: `authorized` + `authorizedAt`, y DID/wallet en null.
    const issuer = client.prisma.state.issuers[0];
    assert.equal(
      issuer.authorizationStatus,
      IssuerAuthorizationStatus.authorized
    );
    assert.ok(issuer.authorizedAt instanceof Date);
    assert.equal(issuer.did, null);
    assert.equal(issuer.walletAddress, null);

    // Exactamente UNA membership, admin + active.
    assert.equal(client.prisma.state.issuerMemberships.length, 1);
    const membership = client.prisma.state.issuerMemberships[0];
    assert.equal(membership.userId, a.userId);
    assert.equal(membership.role, 'admin');
    assert.equal(membership.status, 'active');
  });

  it('escribe exactamente 2 AuditLogs: issuer_provisioned + issuer_membership_granted', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    // El bootstrap de P ya dejo su propio AuditLog; se cuentan solo los del alta.
    const before = client.prisma.state.auditLogs.length;
    await provisionIssuer(p.token, a.email);
    const written = client.prisma.state.auditLogs.slice(before);

    assert.equal(written.length, 2);
    assert.deepEqual(
      written.map((row) => row.action),
      ['issuer_provisioned', 'issuer_membership_granted']
    );
    assert.deepEqual(
      written.map((row) => row.resourceType),
      ['Issuer', 'IssuerMembership']
    );
    // El actor sale del token, en las dos filas.
    for (const row of written) {
      assert.equal(row.actorId, p.userId);
      assert.equal(row.actorType, 'system_admin');
    }

    const provisionMetadata = written[0].metadata as Record<string, unknown>;
    assert.deepEqual(provisionMetadata, {
      name: ISSUER_NAME,
      authorizationStatus: 'authorized',
      didConfigured: false,
      walletConfigured: false,
      initialAdminUserId: a.userId
    });
  });

  it('el cliente no puede imponer authorizationStatus, did ni wallet', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    for (const extra of [
      { authorizationStatus: 'authorized' },
      { authorizedAt: new Date().toISOString() },
      { did: 'did:example:inyectado' },
      { walletAddress: '0xdeadbeef' },
      { role: 'admin' },
      { status: 'active' },
      { metadata: { x: 1 } },
      { privateKey: 'NUNCA' }
    ]) {
      const attempt = await client.request('POST', '/admin/issuers', {
        token: p.token,
        body: {
          name: ISSUER_NAME,
          legalName: ISSUER_LEGAL_NAME,
          initialAdminUserEmail: a.email,
          ...extra
        }
      });

      assert.equal(
        attempt.status,
        400,
        `deberia rechazar ${JSON.stringify(extra)}`
      );
    }

    assert.deepEqual(client.prisma.state.issuers, []);
  });

  it('un email no resoluble no crea la institucion', async () => {
    const p = await createPlatformAdmin();

    const attempt = await client.request('POST', '/admin/issuers', {
      token: p.token,
      body: {
        name: ISSUER_NAME,
        legalName: ISSUER_LEGAL_NAME,
        initialAdminUserEmail: 'nadie.e2e@example.test'
      }
    });

    assert.equal(attempt.status, 404);
    // Atomicidad real: no quedo un Issuer huerfano.
    assert.deepEqual(client.prisma.state.issuers, []);
    assert.deepEqual(client.prisma.state.issuerMemberships, []);
  });
});

// ---------------------------------------------------------------------------
// ESCENARIOS 7, 8, 9, 10: autoridad institucional
// ---------------------------------------------------------------------------

describe('S7a/7 -- A sale de pending tras revalidar', () => {
  it('login nuevo y /auth/me con el token viejo reflejan la membership', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const before = await client.request<{ issuerMemberships: unknown[] }>(
      'GET',
      '/auth/me',
      { token: a.token }
    );
    assert.deepEqual(before.body.issuerMemberships, []);

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    // (a) El token que A ya tenia: el contexto se relee server-side.
    const revalidated = await client.request<{
      issuerMemberships: Array<{ issuerId: string }>;
    }>('GET', '/auth/me', { token: a.token });
    assert.equal(revalidated.body.issuerMemberships.length, 1);
    assert.equal(revalidated.body.issuerMemberships[0].issuerId, issuerId);

    // (b) Y un login nuevo, que es el otro camino canonico.
    const freshToken = await loginActor(client, a.email);
    const afterLogin = await client.request<{
      issuerMemberships: Array<{ issuerId: string }>;
    }>('GET', '/auth/me', { token: freshToken });
    assert.equal(afterLogin.body.issuerMemberships.length, 1);
    assert.equal(afterLogin.body.issuerMemberships[0].issuerId, issuerId);
  });
});

describe('S7a/8+9 -- la autoridad institucional viene de la membership', () => {
  it('A 200, outsider 403, PlatformAdmin sin membership 403', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();
    const b = await registerActor(client, ACTORS.outsider, {
      onboardingIntent: 'personal'
    });

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    assert.equal((await readInstitutionalSurface(issuerId, a.token)).status, 200);
    assert.equal((await readInstitutionalSurface(issuerId, b.token)).status, 403);
    assert.equal((await readInstitutionalSurface(issuerId, p.token)).status, 403);
  });

  it('el PlatformAdmin observa por /admin lo que no puede operar por /issuers', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    // Plano de plataforma: SI.
    const list = await client.request('GET', '/admin/issuers', {
      token: p.token
    });
    const memberships = await client.request<{ items: unknown[] }>(
      'GET',
      `/admin/issuers/${issuerId}/memberships`,
      { token: p.token }
    );
    assert.equal(list.status, 200);
    assert.equal(memberships.status, 200);
    assert.equal(memberships.body.items.length, 1);

    // Plano institucional: NO.
    assert.equal((await readInstitutionalSurface(issuerId, p.token)).status, 403);
  });
});

describe('S7a/10 -- self-assignment explicito', () => {
  it('P gana acceso institucional solo despues de crearse su propia membership', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    // Antes: 403, pese a ser quien creo la institucion.
    assert.equal((await readInstitutionalSurface(issuerId, p.token)).status, 403);

    // Se asigna explicitamente con S5a.
    const grant = await client.request<{
      membership: { role: string; status: string };
    }>('POST', `/admin/issuers/${issuerId}/memberships`, {
      token: p.token,
      body: { userEmail: p.email }
    });

    assert.equal(grant.status, 201);
    assert.equal(grant.body.membership.role, 'admin');
    assert.equal(grant.body.membership.status, 'active');

    // Despues: 200. Y la razon es la MEMBERSHIP, no la capacidad de plataforma.
    assert.equal((await readInstitutionalSurface(issuerId, p.token)).status, 200);

    const membership = client.prisma.state.issuerMemberships.find(
      (row) => row.userId === p.userId && row.issuerId === issuerId
    );
    assert.ok(membership, 'el acceso quedo respaldado por una fila real');
    assert.equal(membership.role, 'admin');
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 11: duplicado
// ---------------------------------------------------------------------------

describe('S7a/11 -- grant duplicado', () => {
  it('responde 409, no cambia la membership y no audita de nuevo', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    const membershipsBefore = [...client.prisma.state.issuerMemberships];
    const auditsBefore = client.prisma.state.auditLogs.length;

    const duplicate = await client.request<{ message: string }>(
      'POST',
      `/admin/issuers/${issuerId}/memberships`,
      { token: p.token, body: { userEmail: a.email } }
    );

    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.message, /ya tiene una membresia/i);

    // Nada cambio: ni filas, ni rol, ni status, ni auditoria.
    assert.equal(
      client.prisma.state.issuerMemberships.length,
      membershipsBefore.length
    );
    assert.equal(client.prisma.state.issuerMemberships[0].role, 'admin');
    assert.equal(client.prisma.state.issuerMemberships[0].status, 'active');
    assert.equal(client.prisma.state.auditLogs.length, auditsBefore);
  });

  it('una membership revocada tambien da 409: no hay reactivacion', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    // Fixture: la membership queda revocada.
    client.prisma.state.issuerMemberships[0].status = 'revoked' as never;
    const auditsBefore = client.prisma.state.auditLogs.length;

    const retry = await client.request(
      'POST',
      `/admin/issuers/${issuerId}/memberships`,
      { token: p.token, body: { userEmail: a.email } }
    );

    assert.equal(retry.status, 409);
    // Sigue revocada: no se reactivo ni se actualizo nada.
    assert.equal(client.prisma.state.issuerMemberships[0].status, 'revoked');
    assert.equal(client.prisma.state.auditLogs.length, auditsBefore);
    // Y por lo tanto A sigue sin poder operar.
    assert.equal((await readInstitutionalSurface(issuerId, a.token)).status, 403);
  });
});

// ---------------------------------------------------------------------------
// ESCENARIOS 14 y 15: la intencion no autoriza ni desautoriza
// ---------------------------------------------------------------------------

describe('S7a/14+15 -- onboardingIntent no decide autoridad', () => {
  it('intencion personal + membership explicita = acceso institucional', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();
    const c = await registerActor(client, ACTORS.personalUser, {
      onboardingIntent: 'personal'
    });

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    const grant = await client.request(
      'POST',
      `/admin/issuers/${issuerId}/memberships`,
      { token: p.token, body: { userEmail: c.email } }
    );
    assert.equal(grant.status, 201);

    assert.equal((await readInstitutionalSurface(issuerId, c.token)).status, 200);

    // Y su intencion NO se modifico.
    const stored = client.prisma.state.users.find((u) => u.id === c.userId);
    assert.equal(stored?.onboardingIntent, 'personal');
  });

  it('intencion null (cuenta legacy) + membership explicita = acceso institucional', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();
    // Sin `onboardingIntent`: reproduce una cuenta anterior a O1.
    const legacy = await registerActor(client, ACTORS.legacyUser);

    const stored = client.prisma.state.users.find((u) => u.id === legacy.userId);
    assert.equal(stored?.onboardingIntent, null, 'la cuenta es legacy');

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    const grant = await client.request(
      'POST',
      `/admin/issuers/${issuerId}/memberships`,
      { token: p.token, body: { userEmail: legacy.email } }
    );
    assert.equal(grant.status, 201);

    assert.equal(
      (await readInstitutionalSurface(issuerId, legacy.token)).status,
      200
    );
    // Sigue siendo legacy: nadie le invento una intencion.
    assert.equal(
      client.prisma.state.users.find((u) => u.id === legacy.userId)
        ?.onboardingIntent,
      null
    );
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 13: authorized != readyToIssue
// ---------------------------------------------------------------------------

describe('S7a/13 -- autoridad administrativa completa != capacidad de emitir', () => {
  it('el Issuer recien provisionado falla closed en la regla de emision', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    const provisioned = await provisionIssuer(p.token, a.email);
    const issuerId = provisioned.body.issuer.id;

    // La autoridad administrativa esta COMPLETA: A puede operar.
    assert.equal((await readInstitutionalSurface(issuerId, a.token)).status, 200);

    // Y sin embargo la institucion no puede emitir.
    const issuer = client.prisma.state.issuers.find((row) => row.id === issuerId);
    assert.ok(issuer);
    const issuersService = new IssuersService(client.prisma as never);

    assert.throws(
      () => issuersService.assertIssuerCanIssue(issuer as never),
      /no tiene walletAddress configurado/
    );

    // Tampoco alcanza con la wallet: falta el DID.
    assert.throws(
      () =>
        issuersService.assertIssuerCanIssue({
          ...issuer,
          walletAddress: '0x0000000000000000000000000000000000000000'
        } as never),
      /no tiene DID configurado/
    );

    // Control negativo: la regla no esta simplemente siempre rota.
    assert.doesNotThrow(() =>
      issuersService.assertIssuerCanIssue({
        ...issuer,
        did: 'did:example:completo',
        walletAddress: '0x00000000000000000000000000000000000000aa'
      } as never)
    );
  });

  it('la superficie /admin lo anuncia: readyToIssue false', async () => {
    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();

    await provisionIssuer(p.token, a.email);

    const list = await client.request<{
      items: Array<{
        authorizationStatus: string;
        technicalIdentity: { readyToIssue: boolean };
      }>;
    }>('GET', '/admin/issuers', { token: p.token });

    assert.equal(list.body.items[0].authorizationStatus, 'authorized');
    assert.equal(list.body.items[0].technicalIdentity.readyToIssue, false);
  });
});

// ---------------------------------------------------------------------------
// AISLAMIENTO
// ---------------------------------------------------------------------------

describe('S7a -- aislamiento del harness', () => {
  it('no se construye ningun PrismaClient: la persistencia es un doble', () => {
    // Evidencia estructural: el harness inyecta `InMemoryPrisma` en el token
    // `PrismaService`, asi que no existe ninguna conexion a base de datos que
    // pudiera apuntar a RDS, Neon o localhost.
    assert.equal(
      client.prisma.constructor.name,
      'InMemoryPrisma',
      'el provider de persistencia es el doble en memoria'
    );
    assert.equal(
      typeof (client.prisma as unknown as { $connect?: unknown }).$connect,
      'undefined',
      'el doble no tiene $connect: no puede abrir una conexion'
    );
  });

  it('el servidor escucha solo en loopback', () => {
    assert.match(client.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('blockchain en modo mock y sin identidad tecnica en ninguna fixture', async () => {
    assert.equal(process.env.BLOCKCHAIN_EVIDENCE_MODE, 'mock');

    const p = await createPlatformAdmin();
    const a = await createInstitutionalUser();
    await provisionIssuer(p.token, a.email);

    // Ninguna fixture introduce claves ni endpoints externos.
    const dump = JSON.stringify(client.prisma.state);
    for (const forbidden of [
      'did:',
      '0x',
      'privateKey',
      'mnemonic',
      'rpc',
      'sepolia',
      'amazonaws',
      'rds.',
      'neon.tech',
      'vercel'
    ]) {
      assert.equal(
        dump.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `la persistencia del E2E no debe contener "${forbidden}"`
      );
    }
  });

  it('los emails de los actores son test-only', () => {
    for (const email of Object.values(ACTORS)) {
      assert.match(email, /\.e2e@example\.test$/);
    }
  });
});
