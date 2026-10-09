/**
 * Persistencia EN MEMORIA para el E2E institucional -- slice S7a.
 *
 * QUE ES Y QUE NO ES. Esto sustituye UNICAMENTE la capa de persistencia. Todo
 * lo demas que ejecuta el E2E es codigo productivo real: controllers, guards,
 * services, validadores, DTOs, firma/verificacion de JWT, hashing de password
 * y el routing HTTP de Nest. La unica razon por la que existe este archivo es
 * que en este entorno NO hay PostgreSQL disponible (nada escucha en
 * 127.0.0.1:5432, no hay servicio instalado, y el daemon de Docker esta
 * apagado), y conectarse a una base remota esta prohibido.
 *
 * LIMITACION QUE NO SE OCULTA. No es un emulador de Prisma: implementa
 * exactamente las operaciones que los caminos productivos del circuito
 * institucional ejecutan, con las formas de `where`/`select` que esos caminos
 * usan. Si Prisma real difiere en un borde que el E2E no ejercita, este doble
 * no lo va a delatar. Lo que el E2E aporta no es cobertura de la capa de datos
 * -- eso ya lo cubren las 61 suites de `services/api` con sus propios dobles --
 * sino la COMPOSICION: rutas, guards, codigos HTTP, el token real viajando
 * entre superficies, y el orden temporal del circuito completo.
 *
 * POR QUE VIVE FUERA DE `src/`. El guard estructural de S1
 * (`platform-admin/__guards__/platform-admin-write-surface.test.ts`) afirma
 * que NINGUN archivo de `src/` escribe `PlatformAdmin`. Este modulo define un
 * delegate `platformAdmin.create`, y el fixture del E2E lo invoca, asi que
 * ponerlo bajo `src/` debilitaria esa invariante. Mismo criterio que el
 * bootstrap de S2, que por la misma razon vive en `prisma/`.
 *
 * AISLAMIENTO. No importa `@prisma/client` como cliente: no se instancia
 * `PrismaClient`, con lo cual es estructuralmente imposible que el E2E abra una
 * conexion a ninguna base. Solo se importan los ENUMS generados, que son
 * constantes.
 */

import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  Prisma,
  UserStatus,
  type UserOnboardingIntent
} from '@prisma/client';

type Row = Record<string, unknown>;
type Select = Record<string, unknown>;

export interface UserRow {
  id: string;
  email: string | null;
  did: string | null;
  status: UserStatus;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  onboardingIntent: UserOnboardingIntent | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthCredentialRow {
  id: string;
  userId: string;
  passwordHash: string;
}

export interface PlatformAdminRow {
  id: string;
  userId: string;
  grantedAt: Date;
}

export interface IssuerRow {
  id: string;
  name: string;
  legalName: string | null;
  did: string | null;
  walletAddress: string | null;
  /** S8c9: default del schema = []. */
  allowedCredentialTypes: string[];
  authorizationStatus: IssuerAuthorizationStatus;
  authorizedAt: Date | null;
  revokedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssuerMembershipRow {
  id: string;
  userId: string;
  issuerId: string;
  role: IssuerMembershipRole;
  status: IssuerMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: Date;
  metadata: unknown;
}

interface Store {
  users: UserRow[];
  authCredentials: AuthCredentialRow[];
  platformAdmins: PlatformAdminRow[];
  issuers: IssuerRow[];
  issuerMemberships: IssuerMembershipRow[];
  auditLogs: AuditLogRow[];
}

function emptyStore(): Store {
  return {
    users: [],
    authCredentials: [],
    platformAdmins: [],
    issuerMemberships: [],
    issuers: [],
    auditLogs: []
  };
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}

/** Espejo del P2002 de Prisma, con `meta.target`, que S5a inspecciona. */
function uniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'e2e', meta: { target } }
  );
}

/** Proyeccion generica de campos escalares segun un `select`. */
function projectScalars(row: Row, select: Select | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === true) out[key] = row[key];
  }
  return out;
}

export class InMemoryPrisma {
  private store: Store = emptyStore();

  /** Lectura directa para aserciones del test. Nunca la usa codigo productivo. */
  get state(): Store {
    return this.store;
  }

  reset(): void {
    this.store = emptyStore();
  }

  // -------------------------------------------------------------------------
  // Delegates
  // -------------------------------------------------------------------------

  readonly user = {
    findUnique: async (args: {
      where: { id?: string; email?: string };
      select?: Select;
      include?: { authCredential?: boolean };
    }) => {
      const found = this.store.users.find((user) =>
        args.where.id !== undefined
          ? user.id === args.where.id
          : user.email === args.where.email
      );

      if (!found) return null;
      return this.projectUser(found, args.select, args.include);
    },

    findMany: async (args: {
      where?: { email?: { equals?: string; mode?: string } };
      select?: Select;
      take?: number;
    }) => {
      let rows = [...this.store.users];
      const emailFilter = args.where?.email;

      if (emailFilter?.equals !== undefined) {
        const target =
          emailFilter.mode === 'insensitive'
            ? emailFilter.equals.toLowerCase()
            : emailFilter.equals;
        rows = rows.filter((user) => {
          const value = user.email ?? '';
          return emailFilter.mode === 'insensitive'
            ? value.toLowerCase() === target
            : value === target;
        });
      }

      const limited =
        typeof args.take === 'number' ? rows.slice(0, args.take) : rows;
      return limited.map((user) => this.projectUser(user, args.select));
    },

    create: async (args: { data: Row; select?: Select }) => {
      const email = (args.data.email as string | null | undefined) ?? null;

      if (email !== null && this.store.users.some((u) => u.email === email)) {
        throw uniqueViolation(['email']);
      }

      const now = new Date();
      const row: UserRow = {
        id: nextId('user'),
        email,
        did: (args.data.did as string | null | undefined) ?? null,
        status: (args.data.status as UserStatus | undefined) ?? UserStatus.active,
        displayName: (args.data.displayName as string | null | undefined) ?? null,
        firstName: (args.data.firstName as string | null | undefined) ?? null,
        lastName: (args.data.lastName as string | null | undefined) ?? null,
        // `undefined` -> la columna queda NULL, igual que Prisma al omitirla.
        onboardingIntent:
          (args.data.onboardingIntent as UserOnboardingIntent | undefined) ??
          null,
        createdAt: now,
        updatedAt: now
      };
      this.store.users.push(row);
      return this.projectUser(row, args.select);
    },

    /**
     * Solo la forma condicional que usa `ensureDidForUser`:
     * `where: { id, did: null }`. Devuelve P2025 si no matchea, como Prisma.
     */
    update: async (args: {
      where: { id: string; did?: null };
      data: Row;
      select?: Select;
    }) => {
      const found = this.store.users.find(
        (user) =>
          user.id === args.where.id &&
          (args.where.did === undefined || user.did === null)
      );

      if (!found) {
        throw new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'e2e'
        });
      }

      Object.assign(found, args.data, { updatedAt: new Date() });
      return this.projectUser(found, args.select);
    }
  };

  readonly authCredential = {
    create: async (args: { data: { userId: string; passwordHash: string } }) => {
      if (this.store.authCredentials.some((c) => c.userId === args.data.userId)) {
        throw uniqueViolation(['userId']);
      }
      const row: AuthCredentialRow = { id: nextId('cred'), ...args.data };
      this.store.authCredentials.push(row);
      return { ...row };
    }
  };

  readonly platformAdmin = {
    findUnique: async (args: { where: { userId: string }; select?: Select }) => {
      const found = this.store.platformAdmins.find(
        (row) => row.userId === args.where.userId
      );
      return found ? projectScalars(found, args.select) : null;
    },

    create: async (args: { data: { userId: string }; select?: Select }) => {
      if (
        this.store.platformAdmins.some((row) => row.userId === args.data.userId)
      ) {
        throw uniqueViolation(['userId']);
      }
      const row: PlatformAdminRow = {
        id: nextId('padmin'),
        userId: args.data.userId,
        grantedAt: new Date()
      };
      this.store.platformAdmins.push(row);
      return projectScalars(row, args.select);
    }
  };

  readonly issuer = {
    findUnique: async (args: { where: { id: string }; select?: Select }) => {
      const found = this.store.issuers.find((row) => row.id === args.where.id);
      if (!found) return null;
      return this.projectIssuer(found, args.select);
    },

    findMany: async (args: {
      select?: Select;
      orderBy?: unknown;
      where?: { id?: { in?: string[] } };
    }) => {
      const ids = args.where?.id?.in;
      const rows = [...this.store.issuers]
        .filter((row) => !ids || ids.includes(row.id))
        .sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      );
      return rows.map((row) => this.projectIssuer(row, args.select));
    },

    create: async (args: { data: Row; select?: Select }) => {
      const now = new Date();
      const row: IssuerRow = {
        id: nextId('issuer'),
        name: args.data.name as string,
        legalName: (args.data.legalName as string | null | undefined) ?? null,
        // Omitidos por S5b a proposito: quedan en el default del schema.
        did: (args.data.did as string | null | undefined) ?? null,
        walletAddress:
          (args.data.walletAddress as string | null | undefined) ?? null,
        allowedCredentialTypes:
          (args.data.allowedCredentialTypes as string[] | undefined) ?? [],
        authorizationStatus:
          (args.data.authorizationStatus as
            | IssuerAuthorizationStatus
            | undefined) ?? IssuerAuthorizationStatus.pending,
        authorizedAt: (args.data.authorizedAt as Date | null | undefined) ?? null,
        revokedAt: null,
        metadata: args.data.metadata ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.store.issuers.push(row);
      return this.projectIssuer(row, args.select);
    }
  };

  readonly issuerMembership = {
    findUnique: async (args: {
      where: { userId_issuerId?: { userId: string; issuerId: string } };
      select?: Select;
    }) => {
      const key = args.where.userId_issuerId;
      if (!key) return null;
      const found = this.store.issuerMemberships.find(
        (row) => row.userId === key.userId && row.issuerId === key.issuerId
      );
      return found ? this.projectMembership(found, args.select) : null;
    },

    create: async (args: { data: Row; select?: Select }) => {
      const userId = args.data.userId as string;
      const issuerId = args.data.issuerId as string;

      // Espejo del `@@unique([userId, issuerId])` real.
      if (
        this.store.issuerMemberships.some(
          (row) => row.userId === userId && row.issuerId === issuerId
        )
      ) {
        throw uniqueViolation(['userId', 'issuerId']);
      }

      const now = new Date();
      const row: IssuerMembershipRow = {
        id: nextId('membership'),
        userId,
        issuerId,
        role:
          (args.data.role as IssuerMembershipRole | undefined) ??
          IssuerMembershipRole.operator,
        status:
          (args.data.status as IssuerMembershipStatus | undefined) ??
          IssuerMembershipStatus.pending,
        createdAt: now,
        updatedAt: now
      };
      this.store.issuerMemberships.push(row);
      return projectScalars(row, args.select);
    },

    /** Solo la forma de S3: `by: ['issuerId','status']` + `_count._all`. */
    groupBy: async (_args: unknown) => {
      const buckets = new Map<string, number>();
      for (const row of this.store.issuerMemberships) {
        const key = `${row.issuerId}::${row.status}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([key, count]) => {
        const [issuerId, status] = key.split('::');
        return { issuerId, status, _count: { _all: count } };
      });
    }
  };

  readonly auditLog = {
    create: async (args: { data: Row }) => {
      const row: AuditLogRow = {
        id: nextId('audit'),
        actorId: (args.data.actorId as string | null | undefined) ?? null,
        actorType: String(args.data.actorType),
        action: String(args.data.action),
        resourceType: String(args.data.resourceType),
        resourceId: String(args.data.resourceId),
        occurredAt: new Date(),
        metadata: args.data.metadata ?? null
      };
      this.store.auditLogs.push(row);
      return { ...row };
    }
  };

  /**
   * Catalogo academico: SIEMPRE vacio. Un Issuer de test nace sin catalogo, y
   * el brief de S7a lo dice explicitamente -- contadores en 0 es correcto.
   */
  readonly program = { findMany: async () => [] as Row[] };
  readonly curriculumVersion = { findMany: async () => [] as Row[] };
  readonly academicCourse = { findMany: async () => [] as Row[] };
  readonly issuerCourseTemplate = { findMany: async () => [] as Row[] };

  // -------------------------------------------------------------------------
  // Transacciones
  // -------------------------------------------------------------------------

  /**
   * Transaccion interactiva con ROLLBACK REAL: se fotografian las tablas, se
   * corre el callback y, si lanza, se restauran. Es lo que da sentido a las
   * aserciones de atomicidad del circuito (un 409 no puede dejar a medias un
   * AuditLog, por ejemplo).
   */
  async $transaction<T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> {
    const snapshot: Store = {
      users: [...this.store.users.map((r) => ({ ...r }))],
      authCredentials: [...this.store.authCredentials.map((r) => ({ ...r }))],
      platformAdmins: [...this.store.platformAdmins.map((r) => ({ ...r }))],
      issuers: [...this.store.issuers.map((r) => ({ ...r }))],
      issuerMemberships: [
        ...this.store.issuerMemberships.map((r) => ({ ...r }))
      ],
      auditLogs: [...this.store.auditLogs.map((r) => ({ ...r }))]
    };

    try {
      return await fn(this);
    } catch (error) {
      this.store = snapshot;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Proyecciones con relaciones
  // -------------------------------------------------------------------------

  /**
   * Membership con sus relaciones anidadas.
   *
   * `IssuersService.assertUserCanOperateAuthorizedIssuer` pide
   * `issuer: { select: { authorizationStatus: true } }` en el mismo
   * `findUnique`, porque la regla de autoridad institucional necesita
   * comprobar a la vez la membership Y que el issuer siga habilitado. Sin
   * proyectar esa relacion, la regla real no puede evaluarse.
   */
  private projectMembership(
    membership: IssuerMembershipRow,
    select?: Select
  ): Row {
    if (!select) return { ...membership };

    const out = projectScalars(membership, select);

    const issuerSelect = select.issuer as { select?: Select } | undefined;
    if (issuerSelect) {
      const issuer = this.store.issuers.find(
        (row) => row.id === membership.issuerId
      );
      out.issuer = issuer ? projectScalars(issuer, issuerSelect.select) : null;
    }

    const userSelect = select.user as { select?: Select } | undefined;
    if (userSelect) {
      const user = this.store.users.find((row) => row.id === membership.userId);
      out.user = user ? projectScalars(user, userSelect.select) : null;
    }

    return out;
  }

  private projectUser(
    user: UserRow,
    select?: Select,
    include?: { authCredential?: boolean }
  ): Row {
    if (!select && !include) return { ...user };

    const out: Row = select ? projectScalars(user, select) : { ...user };

    if (include?.authCredential) {
      const credential = this.store.authCredentials.find(
        (row) => row.userId === user.id
      );
      out.authCredential = credential ? { ...credential } : null;
    }

    // `/auth/me`: presencia/ausencia de la capacidad de plataforma.
    const platformAdminSelect = select?.platformAdmin as
      | { select?: Select }
      | undefined;
    if (platformAdminSelect) {
      const grant = this.store.platformAdmins.find(
        (row) => row.userId === user.id
      );
      out.platformAdmin = grant
        ? projectScalars(grant, platformAdminSelect.select)
        : null;
    }

    // `/auth/me`: memberships filtradas por status, con su issuer anidado.
    const membershipsSelect = select?.issuerMemberships as
      | { where?: { status?: IssuerMembershipStatus }; select?: Select }
      | undefined;
    if (membershipsSelect) {
      const wanted = membershipsSelect.where?.status;
      const rows = this.store.issuerMemberships.filter(
        (row) =>
          row.userId === user.id && (wanted === undefined || row.status === wanted)
      );

      out.issuerMemberships = rows.map((row) => {
        const projected = projectScalars(row, membershipsSelect.select);
        const issuerSelect = membershipsSelect.select?.issuer as
          | { select?: Select }
          | undefined;
        if (issuerSelect) {
          const issuer = this.store.issuers.find((i) => i.id === row.issuerId);
          projected.issuer = issuer
            ? projectScalars(issuer, issuerSelect.select)
            : null;
        }
        return projected;
      });
    }

    return out;
  }

  private projectIssuer(issuer: IssuerRow, select?: Select): Row {
    if (!select) return { ...issuer };

    const out = projectScalars(issuer, select);

    // S8c9: el E2E nunca provisiona identidad tecnica de emisor: la
    // readiness ve "sin identidad" y "sin historia".
    if (select.technicalIdentity) {
      out.technicalIdentity = null;
    }
    if (select.assertionKeyBindings) {
      out.assertionKeyBindings = [];
    }

    // S3: `_count` de las relaciones DIRECTAS del Issuer. Siempre 0 en el
    // E2E porque no se toca el catalogo academico.
    const countSelect = select._count as { select?: Select } | undefined;
    if (countSelect?.select) {
      const counts: Row = {};
      for (const key of Object.keys(countSelect.select)) {
        counts[key] = 0;
      }
      out._count = counts;
    }

    // S3: lista de memberships del issuer, ordenada por email del user y
    // desempatada por userId -- mismo criterio que el service real.
    const membershipsSelect = select.memberships as
      | { select?: Select; orderBy?: unknown }
      | undefined;
    if (membershipsSelect) {
      const rows = this.store.issuerMemberships
        .filter((row) => row.issuerId === issuer.id)
        .sort((a, b) => {
          const emailA =
            this.store.users.find((u) => u.id === a.userId)?.email ?? '';
          const emailB =
            this.store.users.find((u) => u.id === b.userId)?.email ?? '';
          return emailA.localeCompare(emailB) || a.userId.localeCompare(b.userId);
        });

      out.memberships = rows.map((row) => {
        const projected = projectScalars(row, membershipsSelect.select);
        const userSelect = membershipsSelect.select?.user as
          | { select?: Select }
          | undefined;
        if (userSelect) {
          const user = this.store.users.find((u) => u.id === row.userId);
          projected.user = user
            ? projectScalars(user, userSelect.select)
            : null;
        }
        return projected;
      });
    }

    return out;
  }
}
