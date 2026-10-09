/**
 * Lecturas administrativas de plataforma -- slice S3.
 *
 * Lo que se defiende: los contadores salen bien (incluidos los transitivos), el
 * orden es deterministico, `technicalIdentity` se deriva de la misma
 * precondicion que `assertIssuerCanIssue`, y la respuesta NUNCA lleva el valor
 * del DID ni de la walletAddress.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';
import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { materialFromScalar } from '../identity/operator/signer-material-generator';
import { PlatformAdminReadService } from './platform-admin-read.service';

const FORBIDDEN_WRITE = (name: string) => () => {
  throw new Error(`lectura administrativa no debe invocar ${name}`);
};

/**
 * Doble de Prisma para `listIssuers`.
 *
 * Cada delegate expone SOLO los metodos de lectura que el servicio puede usar;
 * `create`/`update`/`upsert`/`delete` lanzan. Si una lectura administrativa
 * escribiera, el test explota en vez de pasar por casualidad.
 */
function createListDouble(options: {
  issuers: Array<{
    id: string;
    name: string;
    legalName: string | null;
    authorizationStatus: IssuerAuthorizationStatus;
    did: string | null;
    walletAddress: string | null;
    createdAt: Date;
    academicCourses: number;
    programs: number;
    /** S8c9: politica y modelo tecnico NUEVO (los unicos que cuentan). */
    allowedCredentialTypes?: string[];
    technical?: TechnicalFixture | null;
  }>;
  memberships?: Array<{
    issuerId: string;
    status: IssuerMembershipStatus;
    count: number;
  }>;
  programs?: Array<{ issuerId: string; curriculumVersions: number }>;
  curriculumVersions?: Array<{ issuerId: string; programCourses: number }>;
}) {
  const orderBys: unknown[] = [];
  const readinessQueries: unknown[] = [];

  const prisma = {
    issuer: {
      async findMany(args: {
        orderBy?: unknown;
        where?: unknown;
        select?: Record<string, unknown>;
      }) {
        // S8c9: la readiness del lote es UNA consulta aparte, por ids.
        if (args.select && 'assertionKeyBindings' in args.select) {
          readinessQueries.push(args.where);
          return options.issuers.map((issuer) => ({
            id: issuer.id,
            authorizationStatus: issuer.authorizationStatus,
            allowedCredentialTypes: issuer.allowedCredentialTypes ?? [],
            technicalIdentity: issuer.technical?.technicalIdentity ?? null,
            assertionKeyBindings: issuer.technical?.assertionKeyBindings ?? []
          }));
        }
        orderBys.push(args.orderBy);
        // El doble NO ordena: devuelve en el orden en que se declararon los
        // issuers, para que un test pueda comprobar que el `orderBy` se le pide
        // a la base (unica autoridad de orden) y no se simula en memoria.
        return options.issuers.map((issuer) => ({
          id: issuer.id,
          name: issuer.name,
          legalName: issuer.legalName,
          authorizationStatus: issuer.authorizationStatus,
          did: issuer.did,
          walletAddress: issuer.walletAddress,
          createdAt: issuer.createdAt,
          _count: {
            academicCourses: issuer.academicCourses,
            programs: issuer.programs
          }
        }));
      },
      findUnique: FORBIDDEN_WRITE('issuer.findUnique en listIssuers'),
      create: FORBIDDEN_WRITE('issuer.create'),
      update: FORBIDDEN_WRITE('issuer.update'),
      upsert: FORBIDDEN_WRITE('issuer.upsert'),
      delete: FORBIDDEN_WRITE('issuer.delete')
    },
    issuerMembership: {
      async groupBy() {
        return (options.memberships ?? []).map((group) => ({
          issuerId: group.issuerId,
          status: group.status,
          _count: { _all: group.count }
        }));
      },
      create: FORBIDDEN_WRITE('issuerMembership.create'),
      update: FORBIDDEN_WRITE('issuerMembership.update'),
      delete: FORBIDDEN_WRITE('issuerMembership.delete')
    },
    program: {
      async findMany() {
        return (options.programs ?? []).map((program) => ({
          issuerId: program.issuerId,
          _count: { curriculumVersions: program.curriculumVersions }
        }));
      }
    },
    curriculumVersion: {
      async findMany() {
        return (options.curriculumVersions ?? []).map((curriculum) => ({
          program: { issuerId: curriculum.issuerId },
          _count: { programCourses: curriculum.programCourses }
        }));
      }
    },
    user: {
      create: FORBIDDEN_WRITE('user.create'),
      update: FORBIDDEN_WRITE('user.update')
    },
    platformAdmin: {
      create: FORBIDDEN_WRITE('platformAdmin.create'),
      delete: FORBIDDEN_WRITE('platformAdmin.delete')
    },
    auditLog: {
      create: FORBIDDEN_WRITE('auditLog.create')
    },
    $transaction: FORBIDDEN_WRITE('$transaction')
  };

  return { prisma, orderBys, readinessQueries };
}

const UADE = {
  id: 'issuer-uade',
  name: 'Universidad Argentina de la Empresa (UADE)',
  legalName: 'Universidad Argentina de la Empresa (UADE)',
  authorizationStatus: IssuerAuthorizationStatus.authorized,
  did: 'did:example:issuer-demo',
  walletAddress: '0x00000000000000000000000000000000000000aa',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  academicCourses: 617,
  programs: 22
};

const NUEVA = {
  id: 'issuer-nueva',
  name: 'Institucion Nueva',
  legalName: null,
  authorizationStatus: IssuerAuthorizationStatus.authorized,
  did: null,
  walletAddress: null,
  createdAt: new Date('2026-10-03T00:00:00.000Z'),
  academicCourses: 0,
  programs: 0
};

// ---------------------------------------------------------------------------
// listIssuers
// ---------------------------------------------------------------------------

test('listIssuers: lista todos los issuers, no solo los del consultante', async () => {
  const { prisma } = createListDouble({ issuers: [UADE, NUEVA] });
  const service = new PlatformAdminReadService(prisma as never);

  const response = await service.listIssuers();

  assert.equal(response.items.length, 2);
  assert.deepEqual(
    response.items.map((item) => item.id),
    ['issuer-uade', 'issuer-nueva']
  );
});

test('listIssuers: el orden se le pide a la base, name asc y luego id asc', async () => {
  const { prisma, orderBys } = createListDouble({ issuers: [UADE, NUEVA] });
  const service = new PlatformAdminReadService(prisma as never);

  await service.listIssuers();

  assert.deepEqual(orderBys, [[{ name: 'asc' }, { id: 'asc' }]]);
});

test('listIssuers: membershipCounts suma total por status y aisla active', async () => {
  const { prisma } = createListDouble({
    issuers: [UADE, NUEVA],
    memberships: [
      { issuerId: 'issuer-uade', status: IssuerMembershipStatus.active, count: 2 },
      { issuerId: 'issuer-uade', status: IssuerMembershipStatus.pending, count: 1 },
      { issuerId: 'issuer-uade', status: IssuerMembershipStatus.revoked, count: 3 }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const [uade, nueva] = (await service.listIssuers()).items;

  assert.deepEqual(uade.membershipCounts, { active: 2, total: 6 });
  // Un issuer sin ninguna fila en el groupBy cae a 0, nunca a undefined.
  assert.deepEqual(nueva.membershipCounts, { active: 0, total: 0 });
});

test('listIssuers: catalogCounts agrega los transitivos por issuer', async () => {
  // curriculumVersions cuelga de Program; programCourses cuelga de
  // CurriculumVersion. Los dos se agregan sumando filas de niveles distintos.
  const { prisma } = createListDouble({
    issuers: [UADE, NUEVA],
    programs: [
      { issuerId: 'issuer-uade', curriculumVersions: 20 },
      { issuerId: 'issuer-uade', curriculumVersions: 2 }
    ],
    curriculumVersions: [
      { issuerId: 'issuer-uade', programCourses: 900 },
      { issuerId: 'issuer-uade', programCourses: 77 }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const [uade, nueva] = (await service.listIssuers()).items;

  assert.deepEqual(uade.catalogCounts, {
    academicCourses: 617,
    programs: 22,
    curriculumVersions: 22,
    programCourses: 977
  });
  assert.deepEqual(nueva.catalogCounts, {
    academicCourses: 0,
    programs: 0,
    curriculumVersions: 0,
    programCourses: 0
  });
});

test('listIssuers: no mezcla contadores entre issuers', async () => {
  const { prisma } = createListDouble({
    issuers: [UADE, NUEVA],
    programs: [
      { issuerId: 'issuer-uade', curriculumVersions: 22 },
      { issuerId: 'issuer-nueva', curriculumVersions: 5 }
    ],
    curriculumVersions: [
      { issuerId: 'issuer-uade', programCourses: 977 },
      { issuerId: 'issuer-nueva', programCourses: 11 }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const [uade, nueva] = (await service.listIssuers()).items;

  assert.equal(uade.catalogCounts.curriculumVersions, 22);
  assert.equal(uade.catalogCounts.programCourses, 977);
  assert.equal(nueva.catalogCounts.curriculumVersions, 5);
  assert.equal(nueva.catalogCounts.programCourses, 11);
});

// ---------------------------------------------------------------------------
// S8c9 (decision D) -- los booleanos legacy se RE-DERIVAN del modelo nuevo.
//
// SUPERSEDE los tests S6a "didConfigured/walletConfigured = truthiness de
// Issuer.did / Issuer.walletAddress" y "readyToIssue = authorized + did +
// wallet": esos campos dejaron de ser autoridad. Claves: SOLO escalares
// publicos de test 1 y 2.
// ---------------------------------------------------------------------------

type TechnicalFixture = {
  technicalIdentity: Record<string, unknown> | null;
  assertionKeyBindings: unknown[];
};

const TEST_ASSERTION = materialFromScalar(`0x${'0'.repeat(63)}1`);
const TEST_ANCHOR = materialFromScalar(`0x${'0'.repeat(63)}2`);
const UUID_ISSUER = '11111111-1111-4111-8111-111111111111';

function completeTechnical(
  issuerId: string,
  overrides: {
    did?: string;
    anchorStatus?: string;
    anchorAddress?: string;
  } = {}
): TechnicalFixture {
  const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
  return {
    technicalIdentity: {
      status: 'active',
      did: overrides.did ?? `did:web:scope.example:did:issuers:${issuerId}`,
      assertionSignerProfileId: 'assert-1',
      assertionSignerProfile: {
        id: 'assert-1',
        purpose: 'assertion',
        status: 'active',
        keyVersion: 1,
        address: TEST_ASSERTION.address.toLowerCase(),
        addressVerifiedAt: verifiedAt
      },
      anchorSignerProfile: {
        id: 'anchor-1',
        purpose: 'anchor',
        status: overrides.anchorStatus ?? 'active',
        keyVersion: 1,
        address: overrides.anchorAddress ?? TEST_ANCHOR.address.toLowerCase(),
        addressVerifiedAt: verifiedAt
      }
    },
    assertionKeyBindings: [
      {
        signerProfile: {
          id: 'assert-1',
          purpose: 'assertion',
          status: 'active',
          keyVersion: 1,
          publicKeyX: TEST_ASSERTION.publicKeyX,
          publicKeyY: TEST_ASSERTION.publicKeyY,
          publicKeyCompressed: TEST_ASSERTION.publicKeyCompressed
        }
      }
    ]
  };
}

test('D2 listIssuers: legacy did/walletAddress SIN identidad tecnica -> todo false', async () => {
  // UADE tiene did y walletAddress legacy cargados: ya no cuentan.
  const { prisma } = createListDouble({ issuers: [UADE, NUEVA] });
  const service = new PlatformAdminReadService(prisma as never);

  const [uade, nueva] = (await service.listIssuers()).items;

  for (const item of [uade, nueva]) {
    assert.equal(item.technicalIdentity.didConfigured, false);
    assert.equal(item.technicalIdentity.walletConfigured, false);
    assert.equal(item.technicalIdentity.readyToIssue, false);
    assert.equal(item.technicalIdentity.configurationReady, false);
  }
});

test('D3 listIssuers: booleanos re-derivados del modelo tecnico', async () => {
  const casos = [
    {
      nombre: 'completo y habilitado',
      issuer: { authorizationStatus: IssuerAuthorizationStatus.authorized, allowedCredentialTypes: ['course'], technical: completeTechnical(UUID_ISSUER) },
      esperado: { didConfigured: true, walletConfigured: true, readyToIssue: true, administrativelyAuthorized: true, configurationReady: true, hasCredentialCapabilities: true }
    },
    {
      nombre: 'completo sin capacidades',
      issuer: { authorizationStatus: IssuerAuthorizationStatus.authorized, allowedCredentialTypes: [], technical: completeTechnical(UUID_ISSUER) },
      esperado: { didConfigured: true, walletConfigured: true, readyToIssue: false, administrativelyAuthorized: true, configurationReady: true, hasCredentialCapabilities: false }
    },
    {
      nombre: 'completo pero pendiente',
      issuer: { authorizationStatus: IssuerAuthorizationStatus.pending, allowedCredentialTypes: ['course'], technical: completeTechnical(UUID_ISSUER) },
      esperado: { didConfigured: true, walletConfigured: true, readyToIssue: false, administrativelyAuthorized: false, configurationReady: true, hasCredentialCapabilities: true }
    },
    {
      nombre: 'anchor retirado',
      issuer: { authorizationStatus: IssuerAuthorizationStatus.authorized, allowedCredentialTypes: ['course'], technical: completeTechnical(UUID_ISSUER, { anchorStatus: 'retired' }) },
      esperado: { didConfigured: true, walletConfigured: false, readyToIssue: false, administrativelyAuthorized: true, configurationReady: false, hasCredentialCapabilities: true }
    },
    {
      nombre: 'DID de otro issuer',
      issuer: { authorizationStatus: IssuerAuthorizationStatus.authorized, allowedCredentialTypes: ['course'], technical: completeTechnical(UUID_ISSUER, { did: 'did:example:issuer-demo' }) },
      esperado: { didConfigured: false, walletConfigured: true, readyToIssue: false, administrativelyAuthorized: true, configurationReady: false, hasCredentialCapabilities: true }
    }
  ];

  for (const caso of casos) {
    const { prisma } = createListDouble({
      issuers: [{ ...NUEVA, id: UUID_ISSUER, ...caso.issuer }]
    });
    const [item] = (await new PlatformAdminReadService(prisma as never).listIssuers()).items;
    assert.deepEqual(item.technicalIdentity, caso.esperado, caso.nombre);
  }
});

test('D4 listIssuers: la readiness del lote es UNA consulta, sin N+1', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    ...NUEVA,
    id: `issuer-${index}`
  }));
  const { prisma, readinessQueries } = createListDouble({ issuers: many });

  const response = await new PlatformAdminReadService(prisma as never).listIssuers();

  assert.equal(response.items.length, 12);
  assert.equal(readinessQueries.length, 1);
  assert.deepEqual(readinessQueries[0], {
    id: { in: many.map((issuer) => issuer.id) }
  });
});

test('listIssuers: NUNCA devuelve el valor del did ni de la walletAddress', async () => {
  const { prisma } = createListDouble({ issuers: [UADE, NUEVA] });
  const service = new PlatformAdminReadService(prisma as never);

  const response = await service.listIssuers();
  const serialized = JSON.stringify(response);

  assert.equal(serialized.includes('did:example:issuer-demo'), false);
  assert.equal(serialized.includes('0x00000000000000000000000000000000000000aa'), false);
  // Y las claves tampoco existen.
  for (const item of response.items) {
    assert.equal('did' in item, false);
    assert.equal('walletAddress' in item, false);
  }
});

test('listIssuers: la allowlist de claves es exactamente la acordada', async () => {
  const { prisma } = createListDouble({ issuers: [UADE] });
  const service = new PlatformAdminReadService(prisma as never);

  const [item] = (await service.listIssuers()).items;

  assert.deepEqual(Object.keys(item).sort(), [
    'authorizationStatus',
    'catalogCounts',
    'createdAt',
    'id',
    'legalName',
    'membershipCounts',
    'name',
    'technicalIdentity'
  ]);
  // Nunca metadata, credentials ni objetos Prisma completos.
  assert.equal('metadata' in item, false);
  assert.equal('credentials' in item, false);
  assert.equal('_count' in item, false);
  assert.equal('memberships' in item, false);
});

test('listIssuers: authorizationStatus se proyecta tal cual, sin renombrarlo a "verified"', async () => {
  const { prisma } = createListDouble({ issuers: [UADE] });
  const service = new PlatformAdminReadService(prisma as never);

  const [item] = (await service.listIssuers()).items;

  assert.equal(item.authorizationStatus, IssuerAuthorizationStatus.authorized);
  assert.equal(JSON.stringify(item).toLowerCase().includes('verified'), false);
});

// ---------------------------------------------------------------------------
// listIssuerMemberships
// ---------------------------------------------------------------------------

function createMembershipsDouble(
  issuer:
    | {
        id: string;
        name: string;
        memberships: Array<{
          userId: string;
          role: IssuerMembershipRole;
          status: IssuerMembershipStatus;
          createdAt: Date;
          user: {
            email: string | null;
            displayName: string | null;
            firstName: string | null;
            lastName: string | null;
          };
        }>;
      }
    | null
) {
  const calls: unknown[] = [];

  const prisma = {
    issuer: {
      async findUnique(args: unknown) {
        calls.push(args);
        return issuer;
      },
      create: FORBIDDEN_WRITE('issuer.create'),
      update: FORBIDDEN_WRITE('issuer.update')
    },
    issuerMembership: {
      create: FORBIDDEN_WRITE('issuerMembership.create'),
      update: FORBIDDEN_WRITE('issuerMembership.update'),
      delete: FORBIDDEN_WRITE('issuerMembership.delete')
    },
    user: { create: FORBIDDEN_WRITE('user.create') },
    auditLog: { create: FORBIDDEN_WRITE('auditLog.create') },
    $transaction: FORBIDDEN_WRITE('$transaction')
  };

  return { prisma, calls };
}

const MEMBERSHIP_BASE = {
  role: IssuerMembershipRole.admin,
  status: IssuerMembershipStatus.active,
  createdAt: new Date('2026-01-01T00:00:00.000Z')
};

test('listIssuerMemberships: devuelve el issuer y sus memberships proyectadas', async () => {
  const { prisma } = createMembershipsDouble({
    id: 'issuer-uade',
    name: 'Universidad Argentina de la Empresa (UADE)',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-1',
        user: {
          email: 'emisor.uade@uade.edu.ar',
          displayName: 'Administrador UADE',
          firstName: null,
          lastName: null
        }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const response = await service.listIssuerMemberships('issuer-uade');

  assert.deepEqual(response.issuer, {
    id: 'issuer-uade',
    name: 'Universidad Argentina de la Empresa (UADE)'
  });
  assert.deepEqual(response.items, [
    {
      userId: 'user-1',
      email: 'emisor.uade@uade.edu.ar',
      displayLabel: 'Administrador UADE',
      role: IssuerMembershipRole.admin,
      status: IssuerMembershipStatus.active,
      createdAt: MEMBERSHIP_BASE.createdAt
    }
  ]);
});

test('listIssuerMemberships: displayLabel usa buildHolderDisplayLabel, no firstName/lastName crudos', async () => {
  const { prisma } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-nombre',
        user: {
          email: 'ada@example.com',
          displayName: null,
          firstName: 'Ada',
          lastName: 'Lovelace'
        }
      },
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-sin-nombre',
        user: {
          email: 'zoe@example.com',
          displayName: null,
          firstName: null,
          lastName: null
        }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const { items } = await service.listIssuerMemberships('issuer-1');

  assert.equal(items[0].displayLabel, 'Ada Lovelace');
  // Fallback a email, exactamente como /auth/me.
  assert.equal(items[1].displayLabel, 'zoe@example.com');
  // Y los campos crudos no estan.
  assert.equal('firstName' in items[0], false);
  assert.equal('lastName' in items[0], false);
});

test('listIssuerMemberships: el orden se le pide a la base, email asc y luego userId asc', async () => {
  const { prisma, calls } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: []
  });
  const service = new PlatformAdminReadService(prisma as never);

  await service.listIssuerMemberships('issuer-1');

  const args = calls[0] as {
    where: { id: string };
    select: { memberships: { orderBy: unknown } };
  };
  assert.deepEqual(args.where, { id: 'issuer-1' });
  assert.deepEqual(args.select.memberships.orderBy, [
    { user: { email: 'asc' } },
    { userId: 'asc' }
  ]);
});

test('listIssuerMemberships: incluye memberships no operativas, no solo las activas', async () => {
  // El Platform Admin tiene que poder VER una membership pending o revoked:
  // es justamente el diagnostico que /admin existe para dar. /auth/me, en
  // cambio, filtra a solo activas porque ahi el proposito es operar.
  const { prisma } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-a',
        status: IssuerMembershipStatus.revoked,
        user: { email: 'a@example.com', displayName: null, firstName: null, lastName: null }
      },
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-b',
        role: IssuerMembershipRole.viewer,
        status: IssuerMembershipStatus.pending,
        user: { email: 'b@example.com', displayName: null, firstName: null, lastName: null }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const { items } = await service.listIssuerMemberships('issuer-1');

  assert.equal(items.length, 2);
  assert.equal(items[0].status, IssuerMembershipStatus.revoked);
  assert.equal(items[1].role, IssuerMembershipRole.viewer);
});

test('listIssuerMemberships: issuer inexistente -> 404 y ninguna escritura', async () => {
  const { prisma } = createMembershipsDouble(null);
  const service = new PlatformAdminReadService(prisma as never);

  await assert.rejects(
    service.listIssuerMemberships('issuer-que-no-existe'),
    NotFoundException
  );
});

test('listIssuerMemberships: un issuer sin memberships devuelve items vacio, no 404', async () => {
  const { prisma } = createMembershipsDouble({
    id: 'issuer-vacio',
    name: 'Issuer sin miembros',
    memberships: []
  });
  const service = new PlatformAdminReadService(prisma as never);

  const response = await service.listIssuerMemberships('issuer-vacio');

  assert.deepEqual(response.items, []);
  assert.equal(response.issuer.id, 'issuer-vacio');
});

test('listIssuerMemberships: NUNCA devuelve user.did, passwordHash ni AuthCredential', async () => {
  const { prisma, calls } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-1',
        user: { email: 'a@example.com', displayName: null, firstName: null, lastName: null }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const response = await service.listIssuerMemberships('issuer-1');

  assert.deepEqual(Object.keys(response.items[0]).sort(), [
    'createdAt',
    'displayLabel',
    'email',
    'role',
    'status',
    'userId'
  ]);

  // Ni siquiera se PIDEN a la base: el select del user no los menciona.
  const args = JSON.stringify(calls[0]);
  assert.equal(args.includes('did'), false);
  assert.equal(args.includes('passwordHash'), false);
  assert.equal(args.includes('authCredential'), false);
});

test('listIssuerMemberships: un User sin email se proyecta como null, nunca como string vacio', async () => {
  // `User.email` es nullable en el schema. "Sin email" y "email vacio" son
  // estados distintos: `''` no es un email valido y mentiria sobre el dato.
  // La membership NO se oculta -- existe y el Platform Admin debe verla.
  const { prisma } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-sin-email',
        user: { email: null, displayName: 'Alguien', firstName: null, lastName: null }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const { items } = await service.listIssuerMemberships('issuer-1');

  assert.equal(items.length, 1, 'la membership no se oculta');
  assert.equal(items[0].email, null);
  assert.notEqual(items[0].email, '');
  // El displayLabel sigue siendo util: el helper cae a displayName.
  assert.equal(items[0].displayLabel, 'Alguien');
});

test('listIssuerMemberships: sin email y sin ningun nombre, displayLabel cae al fallback fijo del helper', async () => {
  // Caso extremo: `buildHolderDisplayLabel` nunca devuelve vacio, asi que el
  // listado administrativo siempre tiene algo que mostrar aunque `email` sea
  // `null`.
  const { prisma } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-sin-nada',
        user: { email: null, displayName: null, firstName: null, lastName: null }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const { items } = await service.listIssuerMemberships('issuer-1');

  assert.equal(items[0].email, null);
  assert.ok(items[0].displayLabel.length > 0, 'displayLabel nunca es vacio');
  assert.equal(items[0].displayLabel, 'Titular sin datos de presentacion');
});

test('listIssuerMemberships: un email real se devuelve tal cual, sin normalizar', async () => {
  const { prisma } = createMembershipsDouble({
    id: 'issuer-1',
    name: 'Issuer',
    memberships: [
      {
        ...MEMBERSHIP_BASE,
        userId: 'user-con-email',
        user: {
          email: 'emisor.uade@uade.edu.ar',
          displayName: null,
          firstName: null,
          lastName: null
        }
      }
    ]
  });
  const service = new PlatformAdminReadService(prisma as never);

  const { items } = await service.listIssuerMemberships('issuer-1');

  assert.equal(items[0].email, 'emisor.uade@uade.edu.ar');
});
