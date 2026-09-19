/**
 * Doble de Prisma para la fundacion de verificacion contextual publica.
 *
 * Reusa del fixture de F3.2 lo que tiene que ser IDENTICO — `analysisRunSource`
 * con su filtro `NOT { los tres null }` y su orden `createdAt DESC, id DESC`, y
 * los artifacts de extraccion reales del corpus congelado — y agrega lo propio:
 * enlace, politica, solicitud y run.
 *
 * El estado es MUTABLE a proposito: los tests de carrera cambian la politica o
 * revocan el enlace ENTRE `prepare()` y `commit()`, que es exactamente la ventana
 * que la estrategia de dos fases tiene que cubrir.
 *
 * No se aplica ninguna migracion y no se escribe en ninguna base.
 */

import { hashOpaqueToken } from '../opaque-token';
import {
  type FakeAnalysisRunSource,
  type FakeCredential,
  fakePrisma as fakeFreezePrisma,
  objectiveDefinition
} from '../../reasoning-run/__fixtures__/reasoning-run-freeze.fixture';

export const HOLDER_ID = 'user-holder';
export const SHARE_TOKEN = 's'.repeat(43);
export const REQUEST_TOKEN = 'r'.repeat(43);

export interface FakeGrant {
  id: string;
  userId: string;
  scope: 'profile' | 'credential' | 'credential_and_profile';
  tokenHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  verificationPolicy: {
    enabled: boolean;
    policyVersion: number;
    authorizedCredentials: Array<{ credentialId: string }>;
  } | null;
}

export interface FakeRequest {
  id: string;
  sharingGrantId: string;
  requestTokenHash: string;
  status: 'draft' | 'requirements_proposed' | 'requirements_confirmed' | 'consumed';
  rawObjectiveText: string;
  objectiveType: 'EMPLOYMENT' | 'SCHOLARSHIP' | 'ADMISSION' | 'EQUIVALENCE' | 'OTHER';
  objectiveTitle: string | null;
  proposedRequirements: unknown;
  confirmedObjectiveDefinition: unknown;
  expiresAt: Date;
  confirmedAt: Date | null;
  consumedAt: Date | null;
  createdAt?: Date;
}

export interface FakeRun {
  id: string;
  verificationRequestId: string;
  sharingGrantId: string;
  policyVersionSnapshot: number;
  objectiveDefinitionSnapshot: unknown;
  objectiveTitleSnapshot: string | null;
  status: string;
  failureCode: string | null;
  failedAt: Date | null;
  executionAttempts: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  objectiveAnalysisArtifact: unknown;
  evidenceUnitsArtifact: unknown;
  resultArtifact: unknown;
  executionMetadata: unknown;
  inventory: Array<Record<string, any>>;
}

export const NOW = new Date('2026-09-16T12:00:00Z');

export function grant(overrides: Partial<FakeGrant> = {}): FakeGrant {
  return {
    id: 'grant-1',
    userId: HOLDER_ID,
    scope: 'profile',
    tokenHash: hashOpaqueToken(SHARE_TOKEN),
    expiresAt: null,
    revokedAt: null,
    verificationPolicy: {
      enabled: true,
      policyVersion: 7,
      authorizedCredentials: [{ credentialId: 'cred-1' }]
    },
    ...overrides
  };
}

export function confirmedRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    id: 'req-row-1',
    sharingGrantId: 'grant-1',
    requestTokenHash: hashOpaqueToken(REQUEST_TOKEN),
    status: 'requirements_confirmed',
    rawObjectiveText: 'Buscamos una persona para desarrollo backend.',
    objectiveType: 'EMPLOYMENT',
    objectiveTitle: 'Backend Developer Junior',
    proposedRequirements: null,
    confirmedObjectiveDefinition: objectiveDefinition(),
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    confirmedAt: new Date(NOW.getTime() - 60 * 1000),
    consumedAt: null,
    createdAt: NOW,
    ...overrides
  };
}

export interface FakeLease {
  sharingGrantId: string;
  ownerToken: string | null;
  verificationRunId: string | null;
  acquiredAt: Date | null;
  expiresAt: Date | null;
}

/**
 * Filtro de las tablas de ejecucion: igualdad, `null`, `{ in, not, gt, gte, lt,
 * lte, equals }` y `OR`. Mismo criterio que arriba: un doble laxo haria pasar
 * justo los tests de lease, presupuesto y cuota.
 */
export function matchesRow(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Record<string, any>[]).some((branch) => matchesRow(row, branch));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition === 'object') {
      const num = (x: any) => (x instanceof Date ? x.getTime() : x);
      return Object.entries(condition).every(([op, target]: [string, any]) => {
        switch (op) {
          case 'in': return (target as unknown[]).includes(value);
          case 'not': return value !== target;
          case 'gt': return value !== null && value !== undefined && num(value) > num(target);
          case 'gte': return value !== null && value !== undefined && num(value) >= num(target);
          case 'lt': return value !== null && value !== undefined && num(value) < num(target);
          case 'lte': return value !== null && value !== undefined && num(value) <= num(target);
          // `Prisma.DbNull` es un objeto: cualquier `equals` no primitivo aca es "null en base".
          case 'equals': return typeof target === 'object' ? value === null || value === undefined : value === target;
          default: return false;
        }
      });
    }
    return value === condition;
  });
}

function applyData(row: Record<string, any>, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
}

export interface FakeAttempt {
  id: string;
  verificationRequestId: string;
  sharingGrantId: string;
  startedAt: Date;
  leaseExpiresAt: Date;
  outcome: 'SUCCEEDED' | 'FAILED' | 'DISCARDED' | null;
  finishedAt: Date | null;
}

/**
 * Filtro minimo con la MISMA semantica que usan los servicios: igualdad,
 * `{ in }`, `{ not }`, `{ gt }` y `null`. Un doble que ignorara el filtro haria
 * pasar justo los tests de cuota y de claim.
 */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition === 'object') {
      if ('in' in condition) return (condition.in as unknown[]).includes(value);
      if ('not' in condition) return value !== condition.not;
      if ('gt' in condition) return value instanceof Date && value.getTime() > condition.gt.getTime();
      return false;
    }
    return value === condition;
  });
}

export function fakePublicPrisma(options: {
  grants?: FakeGrant[];
  requests?: FakeRequest[];
  attempts?: FakeAttempt[];
  credentials?: FakeCredential[];
  analysisRunSources?: FakeAnalysisRunSource[];
  /** Se ejecuta al ABRIR la transaccion: simula lo que ocurre entre fases. */
  onTransactionStart?: () => void;
  runs?: FakeRun[];
  leases?: FakeLease[];
} = {}) {
  const grants = options.grants ?? [];
  const requests = options.requests ?? [];
  const attempts = options.attempts ?? [];
  const credentials = options.credentials ?? [];
  const runs: FakeRun[] = options.runs ?? [];
  const leases: FakeLease[] = options.leases ?? [];
  const createdRequests: Array<Record<string, any>> = [];
  const isolationLevels: unknown[] = [];

  // `analysisRunSource` es el del fixture de F3.2, sin copiar su semantica.
  const { prisma: freezePrisma } = fakeFreezePrisma({
    credentials,
    analysisRunSources: options.analysisRunSources ?? []
  });

  function requestView(request: FakeRequest) {
    const run = runs.find((candidate) => candidate.verificationRequestId === request.id);
    return { ...structuredClone(request), run: run ? { status: run.status } : null };
  }

  function findRequest(where: Record<string, any>) {
    return requests.find((candidate) =>
      where.requestTokenHash !== undefined
        ? candidate.requestTokenHash === where.requestTokenHash
        : candidate.id === where.id
    );
  }

  const prisma: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>, txOptions?: { isolationLevel?: unknown }) => {
      isolationLevels.push(txOptions?.isolationLevel);
      options.onTransactionStart?.();
      // Rollback real: si la transaccion falla, nada de lo escrito sobrevive.
      const requestsBefore = requests.map((request) => structuredClone(request));
      const attemptsBefore = attempts.map((attempt) => structuredClone(attempt));
      const runsBefore = runs.length;
      try {
        return await fn(prisma);
      } catch (error) {
        requests.splice(0, requests.length, ...requestsBefore);
        attempts.splice(0, attempts.length, ...attemptsBefore);
        runs.splice(runsBefore);
        throw error;
      }
    },

    sharingGrant: {
      findUnique: async ({ where }: any) => {
        const found = grants.find((candidate) =>
          where.tokenHash !== undefined
            ? candidate.tokenHash === where.tokenHash
            : candidate.id === where.id
        );
        return found ? structuredClone(found) : null;
      }
    },

    verificationRequest: {
      findUnique: async ({ where }: any) => {
        const found = findRequest(where);
        return found ? requestView(found) : null;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const found = findRequest(where);
        if (!found) throw new Error('not found');
        return requestView(found);
      },
      count: async ({ where }: any) => requests.filter((request) => matches(request, where)).length,
      create: async ({ data }: any) => {
        createdRequests.push(data);
        const row: FakeRequest = {
          id: `req-created-${createdRequests.length}`,
          proposedRequirements: null,
          confirmedObjectiveDefinition: null,
          confirmedAt: null,
          consumedAt: null,
          objectiveTitle: null,
          createdAt: NOW,
          ...data
        };
        requests.push(row);
        return requestView(row);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const request of requests) {
          if (matches(request, where)) {
            Object.assign(request, data);
            count += 1;
          }
        }
        return { count };
      }
    },

    verificationProposalAttempt: {
      findUnique: async ({ where }: any) => {
        const found = attempts.find((attempt) => attempt.id === where.id);
        return found ? structuredClone(found) : null;
      },
      findMany: async ({ where }: any) =>
        attempts.filter((attempt) => matches(attempt, where)).map((attempt) => structuredClone(attempt)),
      count: async ({ where }: any) => attempts.filter((attempt) => matches(attempt, where)).length,
      create: async ({ data }: any) => {
        // Espejo del indice unico PARCIAL: a lo sumo un intento abierto por solicitud.
        if (attempts.some((attempt) => attempt.verificationRequestId === data.verificationRequestId && attempt.outcome === null)) {
          const error: any = new Error('unique');
          error.code = 'P2002';
          throw error;
        }
        const attempt: FakeAttempt = {
          id: `attempt-${attempts.length + 1}`,
          outcome: null,
          finishedAt: null,
          ...data
        };
        attempts.push(attempt);
        return { id: attempt.id };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const attempt of attempts) {
          if (matches(attempt, where)) {
            Object.assign(attempt, data);
            count += 1;
          }
        }
        return { count };
      }
    },

    credential: {
      // El filtro publico: `id IN autorizados` + `subjectUserId`. Se respeta el
      // orden `(createdAt ASC, id ASC)` igual que el fixture de F3.2.
      findMany: async ({ where }: any) => {
        const allowed = new Set<string>(where.id.in);
        return (
          await freezePrisma.credential.findMany({
            where: { subjectUserId: where.subjectUserId }
          })
        ).filter((credential: { id: string }) => allowed.has(credential.id));
      },
      count: async ({ where }: any) =>
        credentials.filter(
          (credential) =>
            (where.id.in as string[]).includes(credential.id) &&
            credential.subjectUserId === where.subjectUserId &&
            credential.status === where.status
        ).length
    },

    analysisRunSource: freezePrisma.analysisRunSource,

    verificationRun: {
      create: async ({ data }: any) => {
        if (runs.some((run) => run.verificationRequestId === data.verificationRequestId)) {
          // La UNIQUE de `verificationRequestId`.
          const error: any = new Error('unique');
          error.code = 'P2002';
          throw error;
        }
        const run: FakeRun = {
          id: `vrun-${runs.length + 1}`,
          verificationRequestId: data.verificationRequestId,
          sharingGrantId: data.sharingGrantId,
          policyVersionSnapshot: data.policyVersionSnapshot,
          objectiveDefinitionSnapshot: data.objectiveDefinitionSnapshot,
          objectiveTitleSnapshot: data.objectiveTitleSnapshot,
          status: data.status,
          failureCode: data.failureCode ?? null,
          failedAt: data.failedAt ?? null,
          executionAttempts: 0,
          createdAt: data.createdAt ?? NOW,
          startedAt: null,
          completedAt: null,
          objectiveAnalysisArtifact: data.objectiveAnalysisArtifact ?? null,
          evidenceUnitsArtifact: data.evidenceUnitsArtifact ?? null,
          resultArtifact: data.resultArtifact ?? null,
          executionMetadata: data.executionMetadata ?? null,
          inventory: data.inventory.create
        };
        runs.push(run);
        return { status: run.status };
      },
      findUnique: async ({ where }: any) => {
        const found = runs.find((run) =>
          where.verificationRequestId !== undefined
            ? run.verificationRequestId === where.verificationRequestId
            : run.id === where.id
        );
        if (!found) return null;
        const { inventory: _inventory, ...row } = found;
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const run of runs) {
          if (matchesRow(run, where)) {
            applyData(run, data);
            count += 1;
          }
        }
        return { count };
      },
      count: async ({ where }: any) => runs.filter((run) => matchesRow(run, where)).length
    },

    verificationRunInventoryItem: {
      // El join de etiqueta del inventario publico: credencial ACTUAL.
      findMany: async ({ where }: any) => {
        if (typeof where?.verificationRunId !== 'string') {
          throw new Error('fixture: inventory query without run id');
        }
        const run = runs.find((candidate) => candidate.id === where.verificationRunId);
        if (!run) return [];
        const { verificationRunId: _run, ...rest } = where;
        return run.inventory
          .filter((item) => matchesRow(item, rest))
          .map((item) => {
            const current = credentials.find((credential) => credential.id === item.credentialId) as any;
            return {
              ...structuredClone(item),
              credential: current
                ? {
                    id: current.id,
                    title: current.title ?? `Titulo ${current.id}`,
                    type: current.type ?? 'course',
                    status: current.status,
                    issuer: { name: current.issuerName ?? 'Universidad Demo' }
                  }
                : null
            };
          });
      }
    },

    verificationExecutionLease: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const entry of data) {
          if (!leases.some((lease) => lease.sharingGrantId === entry.sharingGrantId)) {
            leases.push({ ownerToken: null, verificationRunId: null, acquiredAt: null, expiresAt: null, ...entry });
            count += 1;
          }
        }
        return { count };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const lease of leases) {
          if (matchesRow(lease, where)) {
            applyData(lease, data);
            count += 1;
          }
        }
        return { count };
      },
      findUnique: async ({ where }: any) => {
        const found = leases.find((lease) => lease.sharingGrantId === where.sharingGrantId);
        return found ? structuredClone(found) : null;
      }
    }
  };

  return { prisma, runs, leases, requests, attempts, grants, credentials, createdRequests, isolationLevels };
}
