/**
 * Doble de Prisma con estado, compartido por las suites de recuperacion.
 *
 * QUE MODELA. Usuarios, credenciales y tokens de recuperacion en memoria, con las
 * formas de `where` / `select` / `data` que usan `AuthService` y
 * `PasswordResetService`. Transacciones con ROLLBACK (log de deshacer). Un advisory
 * lock transaccional modelado como un mutex.
 *
 * COMO EXPRESA CARRERAS. Cada sentencia cede el turno al event loop ANTES de
 * ejecutarse, asi dos transacciones lanzadas a la vez se intercalan sentencia por
 * sentencia (T1.a, T2.a, T1.b, T2.b...) en vez de correr una detras de otra. Cada
 * sentencia, en si misma, es atomica.
 *
 * QUE NO ES. No es PostgreSQL. Lo que el doble hace es lo que el CODIGO le pide, no
 * lo que una base garantizaria:
 *
 *   * el mutex "es" el lock porque asi se escribio, no porque se haya demostrado
 *     la semantica de `pg_advisory_xact_lock`;
 *   * que un `UPDATE ... WHERE consumedAt IS NULL` concurrente afecte 0 filas en el
 *     segundo es aca una consecuencia de que cada sentencia sea atomica, no una
 *     prueba del bloqueo de fila ni de la re-evaluacion del WHERE bajo READ
 *     COMMITTED;
 *   * no hay aislamiento entre transacciones (una escritura es visible de inmediato).
 *
 * Lo que estos tests SI demuestran: que el codigo toma el lock ANTES de leer, que
 * lee DESPUES de tenerlo, que condiciona los UPDATE como debe y que revierte ante un
 * fallo. La semantica real de PostgreSQL la cubre `password-reset.pg.test.ts`, que
 * requiere una base de pruebas.
 */

import { UserStatus } from '@prisma/client';

import { hashPassword } from '../../password-hashing';

export interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
}

export interface CredentialRow {
  id: string;
  userId: string;
  passwordHash: string;
  sessionVersion: number;
}

export interface UserRow {
  id: string;
  email: string;
  did: string | null;
  status: UserStatus;
  firstName: string;
  lastName: string;
  displayName: string | null;
}

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export interface AuthWorldOptions {
  /** `false` apaga el mutex: sirve de control negativo para las carreras. */
  honorAdvisoryLock?: boolean;
}

export const START = new Date('2026-10-24T12:00:00.000Z');

const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Evalua los `where` que usan los servicios. Falla en voz alta ante lo desconocido. */
function matches(row: Row, where: Where, world: AuthWorldState): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === 'user') {
      const relation = (condition as { is: Where }).is;
      const user = world.users.find((candidate) => candidate.id === row.userId);
      return user !== undefined && matches(user as unknown as Row, relation, world);
    }

    const value = row[field];

    if (condition === null) {
      return value === null;
    }

    if (condition instanceof Date || typeof condition !== 'object') {
      return value instanceof Date && condition instanceof Date
        ? value.getTime() === condition.getTime()
        : value === condition;
    }

    const operators = condition as { gt?: Date; lt?: Date };
    if (operators.gt !== undefined) {
      return (value as Date).getTime() > operators.gt.getTime();
    }
    if (operators.lt !== undefined) {
      return (value as Date).getTime() < operators.lt.getTime();
    }

    throw new Error(`auth-world: operador de where no soportado en "${field}"`);
  });
}

interface AuthWorldState {
  users: UserRow[];
  credentials: CredentialRow[];
  tokens: TokenRow[];
}

export interface AuthWorld {
  prisma: Record<string, unknown>;
  state: AuthWorldState;
  clock: { now: Date; advance(ms: number): void };
  /** Cada sentencia ejecutada, en orden: "passwordResetToken.count", etc. */
  statements: string[];
  /** Cada sentencia con los argumentos con los que se la invoco. */
  calls: Array<{ statement: string; args: unknown }>;
  /** Cada `$executeRaw` (SQL con `?` por parametro) y sus valores. */
  rawQueries: Array<{ sql: string; values: unknown[] }>;
  /** Cuantas transacciones terminaron en rollback. */
  rollbacks: number;
  /** Hace que la proxima sentencia con ese nombre lance este error (una vez). */
  failNext(statement: string, error: Error): void;
  /**
   * Ejecuta `hook` una sola vez, justo ANTES de la proxima sentencia con ese nombre.
   * Sirve para simular que otra transaccion confirmo en el medio ("el token lo
   * consumio otro entre mi lectura y mi UPDATE").
   */
  before(statement: string, hook: () => void | Promise<void>): void;
  /** Transacciones abiertas en este momento. */
  readonly openTransactions: number;
  seedUser(input: {
    email: string;
    password?: string;
    status?: UserStatus;
    withCredential?: boolean;
    sessionVersion?: number;
  }): Promise<{ id: string; email: string }>;
  /** Tokens vigentes (sin consumir, sin invalidar y sin vencer) de una cuenta. */
  liveTokens(userId: string): TokenRow[];
  now(): Date;
}

export function createAuthWorld(options: AuthWorldOptions = {}): AuthWorld {
  const honorLock = options.honorAdvisoryLock ?? true;
  const state: AuthWorldState = { users: [], credentials: [], tokens: [] };
  const statements: string[] = [];
  const calls: AuthWorld['calls'] = [];
  const rawQueries: AuthWorld['rawQueries'] = [];
  const failures = new Map<string, Error>();
  const hooks = new Map<string, () => void | Promise<void>>();
  const clock = {
    now: new Date(START),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    }
  };
  const counters = { user: 0, token: 0, credential: 0, rollbacks: 0, open: 0 };

  // Mutex que modela pg_advisory_xact_lock: una transaccion a la vez.
  let lockQueue: Promise<void> = Promise.resolve();
  function acquireLock(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = lockQueue;
    lockQueue = previous.then(() => held);
    return previous.then(() => release);
  }

  async function statement(name: string, args?: unknown): Promise<void> {
    await yieldTurn();

    const hook = hooks.get(name);
    if (hook) {
      hooks.delete(name);
      await hook();
    }

    statements.push(name);
    calls.push({ statement: name, args });
    const failure = failures.get(name);
    if (failure) {
      failures.delete(name);
      throw failure;
    }
  }

  function projectUser(user: UserRow, args: { select?: Row; include?: Row }): Row {
    const credential =
      state.credentials.find((candidate) => candidate.userId === user.id) ?? null;

    if (args.include?.authCredential) {
      return { ...user, authCredential: credential ? { ...credential } : null };
    }

    const out: Row = {};
    for (const [key, wanted] of Object.entries(args.select ?? {})) {
      if (key === 'authCredential') {
        const nested = (wanted as { select?: Row }).select ?? {};
        out.authCredential = credential
          ? Object.fromEntries(
              Object.entries(nested)
                .filter(([, flag]) => flag === true)
                .map(([field]) => [field, (credential as unknown as Row)[field]])
            )
          : null;
      } else if (wanted === true) {
        out[key] = (user as unknown as Row)[key];
      }
    }
    return out;
  }

  function buildClient(undo: Array<() => void> | null, lockHandle?: { release?: () => void }) {
    const remember = (inverse: () => void) => undo?.push(inverse);

    return {
      user: {
        async create(args: {
          data: { email: string; status: UserStatus; firstName: string; lastName: string };
          select?: Row;
        }) {
          await statement('user.create', args);
          const row: UserRow = {
            id: `00000000-0000-4000-8000-${String(++counters.user).padStart(12, '0')}`,
            email: args.data.email,
            did: null,
            status: args.data.status,
            firstName: args.data.firstName,
            lastName: args.data.lastName,
            displayName: null
          };
          state.users.push(row);
          remember(() => state.users.splice(state.users.indexOf(row), 1));
          return projectUser(row, { select: args.select });
        },

        async findUnique(args: { where: { id?: string; email?: string }; select?: Row; include?: Row }) {
          await statement('user.findUnique', args);
          const user = state.users.find((candidate) =>
            args.where.id !== undefined
              ? candidate.id === args.where.id
              : candidate.email === args.where.email
          );
          return user ? projectUser(user, args) : null;
        }
      },

      authCredential: {
        async create(args: { data: { userId: string; passwordHash: string }; select?: Row }) {
          await statement('authCredential.create', args);
          const row: CredentialRow = {
            id: `cred-${++counters.credential}`,
            userId: args.data.userId,
            passwordHash: args.data.passwordHash,
            // Int NOT NULL DEFAULT 0: lo completa la base, no el llamador.
            sessionVersion: 0
          };
          state.credentials.push(row);
          remember(() => state.credentials.splice(state.credentials.indexOf(row), 1));
          return Object.fromEntries(
            Object.entries(args.select ?? {})
              .filter(([, flag]) => flag === true)
              .map(([field]) => [field, (row as unknown as Row)[field]])
          );
        },

        async updateMany(args: {
          where: Where;
          data: { passwordHash?: string; sessionVersion?: { increment: number } };
        }) {
          await statement('authCredential.updateMany', args);
          const targets = state.credentials.filter((row) =>
            matches(row as unknown as Row, args.where, state)
          );
          for (const row of targets) {
            const before = { ...row };
            if (args.data.passwordHash !== undefined) {
              row.passwordHash = args.data.passwordHash;
            }
            if (args.data.sessionVersion) {
              row.sessionVersion += args.data.sessionVersion.increment;
            }
            remember(() => Object.assign(row, before));
          }
          return { count: targets.length };
        }
      },

      passwordResetToken: {
        async findUnique(args: { where: { tokenHash: string }; select?: Row }) {
          await statement('passwordResetToken.findUnique', args);
          const row = state.tokens.find((token) => token.tokenHash === args.where.tokenHash);
          if (!row) return null;

          const out: Row = {};
          for (const [key, wanted] of Object.entries(args.select ?? {})) {
            if (key === 'user') {
              const user = state.users.find((candidate) => candidate.id === row.userId)!;
              out.user = projectUser(user, wanted as { select: Row });
            } else if (wanted === true) {
              out[key] = (row as unknown as Row)[key];
            }
          }
          return out;
        },

        async findFirst(args: { where: Where; orderBy?: { createdAt: 'desc' | 'asc' }; select?: Row }) {
          await statement('passwordResetToken.findFirst', args);
          const rows = state.tokens
            .filter((row) => matches(row as unknown as Row, args.where, state))
            .sort((a, b) =>
              args.orderBy?.createdAt === 'asc'
                ? a.createdAt.getTime() - b.createdAt.getTime()
                : b.createdAt.getTime() - a.createdAt.getTime()
            );
          const row = rows[0];
          if (!row) return null;
          return Object.fromEntries(
            Object.entries(args.select ?? {})
              .filter(([, flag]) => flag === true)
              .map(([field]) => [field, (row as unknown as Row)[field]])
          );
        },

        async count(args: { where?: Where }) {
          await statement('passwordResetToken.count', args);
          return state.tokens.filter((row) =>
            matches(row as unknown as Row, args.where ?? {}, state)
          ).length;
        },

        async updateMany(args: { where: Where; data: { consumedAt?: Date; invalidatedAt?: Date } }) {
          await statement('passwordResetToken.updateMany', args);
          const targets = state.tokens.filter((row) =>
            matches(row as unknown as Row, args.where, state)
          );
          for (const row of targets) {
            const before = { ...row };
            Object.assign(row, args.data);
            remember(() => Object.assign(row, before));
          }
          return { count: targets.length };
        },

        async deleteMany(args: { where: Where }) {
          await statement('passwordResetToken.deleteMany', args);
          const doomed = state.tokens.filter((row) =>
            matches(row as unknown as Row, args.where, state)
          );
          for (const row of doomed) {
            state.tokens.splice(state.tokens.indexOf(row), 1);
            remember(() => state.tokens.push(row));
          }
          return { count: doomed.length };
        },

        async create(args: {
          data: { userId: string; tokenHash: string; createdAt?: Date; expiresAt: Date };
          select?: Row;
        }) {
          await statement('passwordResetToken.create', args);
          if (state.tokens.some((row) => row.tokenHash === args.data.tokenHash)) {
            throw new Error('unique constraint: tokenHash');
          }
          const row: TokenRow = {
            id: `token-${++counters.token}`,
            userId: args.data.userId,
            tokenHash: args.data.tokenHash,
            createdAt: args.data.createdAt ?? new Date(clock.now),
            expiresAt: args.data.expiresAt,
            consumedAt: null,
            invalidatedAt: null
          };
          state.tokens.push(row);
          remember(() => state.tokens.splice(state.tokens.indexOf(row), 1));
          return Object.fromEntries(
            Object.entries(args.select ?? {})
              .filter(([, flag]) => flag === true)
              .map(([field]) => [field, (row as unknown as Row)[field]])
          );
        }
      },

      async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        await statement('$executeRaw');
        const sql = strings.join('?');
        rawQueries.push({ sql, values });

        if (sql.includes('pg_advisory_xact_lock') && honorLock && lockHandle) {
          lockHandle.release = await acquireLock();
        }
        return 1;
      }
    };
  }

  const prisma = {
    ...buildClient(null),
    async $transaction<T>(callback: (tx: ReturnType<typeof buildClient>) => Promise<T>) {
      const undo: Array<() => void> = [];
      const lockHandle: { release?: () => void } = {};
      const tx = buildClient(undo, lockHandle);
      counters.open += 1;

      try {
        const result = await callback(tx);
        return result;
      } catch (error) {
        for (const inverse of undo.reverse()) inverse();
        counters.rollbacks += 1;
        throw error;
      } finally {
        // Como pg_advisory_xact_lock: se libera al terminar la transaccion, por
        // commit o por rollback, sin que el codigo tenga que acordarse.
        lockHandle.release?.();
        counters.open -= 1;
      }
    }
  };

  return {
    prisma,
    state,
    clock,
    statements,
    calls,
    rawQueries,
    get rollbacks() {
      return counters.rollbacks;
    },
    failNext(name, error) {
      failures.set(name, error);
    },
    before(name, hook) {
      hooks.set(name, hook);
    },
    get openTransactions() {
      return counters.open;
    },
    async seedUser(input) {
      const id = `00000000-0000-4000-8000-${String(++counters.user).padStart(12, '0')}`;
      state.users.push({
        id,
        email: input.email,
        did: null,
        status: input.status ?? UserStatus.active,
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: null
      });
      if (input.withCredential ?? true) {
        state.credentials.push({
          id: `cred-${++counters.credential}`,
          userId: id,
          passwordHash: await hashPassword(input.password ?? 'OldPassword123'),
          sessionVersion: input.sessionVersion ?? 0
        });
      }
      return { id, email: input.email };
    },
    liveTokens(userId) {
      return state.tokens.filter(
        (row) =>
          row.userId === userId &&
          row.consumedAt === null &&
          row.invalidatedAt === null &&
          row.expiresAt.getTime() > clock.now.getTime()
      );
    },
    now: () => new Date(clock.now)
  } as AuthWorld;
}
