/**
 * Ejecucion publica de F3 sobre un VerificationRun.
 *
 *     POST /share/profile/:shareToken/verification-execute
 *
 * Un tercero anonimo dispara trabajo de proveedor que el holder paga. Por eso,
 * antes de gastar nada, valen CUATRO fronteras, en este orden:
 *
 *   1. AUTORIDAD     enlace valido + solicitud de ese enlace (+ politica
 *                    habilitada para trabajo NUEVO)
 *   2. EXCLUSION     lease por enlace: a lo sumo UNA ejecucion activa por
 *                    SharingGrant (fila unica + UPDATE condicional, sin SSI)
 *   3. CUOTA         3 runs congelados por enlace en 24 h moviles. Se cuenta
 *                    BAJO el lease: dos llamantes del mismo enlace no pueden
 *                    contar a la vez, asi que la cuenta no tiene carrera.
 *   4. PRESUPUESTO   3 intentos por run (2 reintentos por fallos transitorios),
 *                    con un CAS sobre `executionAttempts` ANTES de reclamar.
 *
 * EL MOTOR NO SE COPIA: es `ReasoningRunExecutionService` del holder sobre la
 * tabla `VerificationRun` (ver `verification-run-engine.ts`). Claim, etapas
 * fill-once, policy determinista y finalizacion son identicas. Un reintento NO
 * recompra etapas ya persistidas (Objective Analysis y Evidence Units son
 * fill-once); el razonamiento contextual es transitorio en el motor y se rehace
 * entero en cada intento, igual que en el holder.
 *
 * CONSENTIMIENTO A MITAD DE EJECUCION. Antes de CADA etapa con proveedor se
 * relee el enlace y la politica (`beforeProviderStage`). Si el enlace se revoco,
 * vencio o la politica se deshabilito, el run termina `failed` con
 * `execution_authorization_withdrawn` SIN iniciar esa etapa. No se reconstruye
 * inventario ni snapshot: la pregunta es "puede seguir este run", no "que
 * evidencia vale ahora". Una llamada YA en vuelo no se cancela: no hay forma
 * honesta de garantizarlo.
 *
 * SINCRONICO, como el endpoint del holder. Si el cliente corta la conexion, la
 * ejecucion sigue en el servidor; `verification-result` con el mismo token la
 * resuelve.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ReasoningRunStatus, VerificationRequestStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  SHARE_AUTHORITY_SELECT,
  assertComputeAllowed,
  assertContextualShareAuthority
} from './contextual-share-authority';
import { PublicVerificationError } from './public-verification.errors';
import {
  MAX_EXECUTION_ATTEMPTS_PER_RUN,
  RUN_QUOTA_WINDOW_MS,
  RUN_STARTS_PER_SHARE_WINDOW,
  executionLeaseMs
} from './public-verification.limits';
import {
  type ExecutionLease,
  acquireExecutionLease,
  attachRunToLease,
  releaseExecutionLease
} from './verification-execution-lease';
import { loadSessionForShare } from './verification-request.service';
import { type PublicVerificationResultDto } from './verification-result.projection';
import { PUBLIC_RETRY_BUDGET_EXHAUSTED, VerificationResultService } from './verification-result.service';
import { VERIFICATION_RUN_ENGINE, type VerificationRunEngine } from './verification-run-engine';
import { VerificationRunFreezeService } from './verification-run-freeze.service';

/** Solo para tests: sin proveedor registrado se usa el reloj real y el TTL derivado. */
export const EXECUTION_CLOCK = Symbol('PUBLIC_VERIFICATION_EXECUTION_CLOCK');
export const EXECUTION_LEASE_TTL_MS = Symbol('PUBLIC_VERIFICATION_EXECUTION_LEASE_TTL_MS');

/**
 * Error que el control de etapa lanza para detener el run. El `code` es el que el
 * orquestador mapea a `execution_authorization_withdrawn` (terminal).
 */
export class ExecutionAuthorizationWithdrawnError extends Error {
  readonly code = 'EXECUTION_AUTHORIZATION_WITHDRAWN';
  constructor() {
    super('execution_authorization_withdrawn');
    this.name = 'ExecutionAuthorizationWithdrawnError';
  }
}

@Injectable()
export class VerificationExecutionService {
  private readonly clock: () => Date;
  private readonly leaseTtlMs: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VerificationRunFreezeService) private readonly freezer: VerificationRunFreezeService,
    @Inject(VerificationResultService) private readonly results: VerificationResultService,
    @Inject(VERIFICATION_RUN_ENGINE) private readonly engine: VerificationRunEngine,
    @Optional() @Inject(EXECUTION_CLOCK) clock?: () => Date,
    @Optional() @Inject(EXECUTION_LEASE_TTL_MS) leaseTtlMs?: number
  ) {
    this.clock = clock ?? (() => new Date());
    this.leaseTtlMs = leaseTtlMs ?? executionLeaseMs();
  }

  async execute(rawShareToken: unknown, rawRequestToken: unknown): Promise<PublicVerificationResultDto> {
    const now = this.clock();
    const { grant, row } = await loadSessionForShare(this.prisma, rawShareToken, rawRequestToken, now);

    if (row.status === VerificationRequestStatus.consumed) {
      const run = await this.findRunForRequest(row.id);
      // Idempotencia: completed / failed / running se devuelven, NUNCA se
      // reejecutan. Solo un run `pending` (entre intentos) se reanuda.
      if (run.status === ReasoningRunStatus.pending) {
        await this.withLease(grant.id, now, async (lease) => {
          await attachRunToLease(this.prisma, lease, run.id);
          await this.attempt(run.id, grant.id);
        });
      }
      return this.results.readResult(rawShareToken, rawRequestToken, this.clock());
    }

    // Trabajo NUEVO: la politica tiene que estar habilitada ahora.
    await assertComputeAllowed(this.prisma, grant, now);

    await this.withLease(grant.id, now, async (lease) => {
      const started = await this.prisma.verificationRun.count({
        where: {
          sharingGrantId: grant.id,
          createdAt: { gt: new Date(now.getTime() - RUN_QUOTA_WINDOW_MS) }
        }
      });
      if (started >= RUN_STARTS_PER_SHARE_WINDOW) {
        throw new PublicVerificationError('RUN_QUOTA_EXCEEDED');
      }

      // Cualquier BLOCKED_*, cero INCLUDED o cambio de consentimiento lanza aca,
      // sin run y sin consumir la solicitud.
      await this.freezer.createFrozenRun(rawShareToken, rawRequestToken, now);

      const run = await this.findRunForRequest(row.id);
      await attachRunToLease(this.prisma, lease, run.id);
      if (run.status === ReasoningRunStatus.pending) {
        await this.attempt(run.id, grant.id);
      }
    });

    return this.results.readResult(rawShareToken, rawRequestToken, this.clock());
  }

  // -------------------------------------------------------------------------

  private async withLease(
    sharingGrantId: string,
    now: Date,
    work: (lease: ExecutionLease) => Promise<void>
  ): Promise<void> {
    const lease = await acquireExecutionLease(this.prisma, sharingGrantId, now, this.leaseTtlMs);
    if (lease === null) throw new PublicVerificationError('EXECUTION_IN_PROGRESS');
    try {
      await work(lease);
    } finally {
      await releaseExecutionLease(this.prisma, lease);
    }
  }

  private async findRunForRequest(verificationRequestId: string) {
    const run = await this.prisma.verificationRun.findUnique({
      where: { verificationRequestId },
      select: { id: true, status: true }
    });
    if (!run) throw new Error('verification_request_consumed_without_run');
    return run;
  }

  /**
   * UN intento sobre un run `pending`. El desenlace queda en la fila; la
   * respuesta publica se arma despues leyendola, nunca desde la excepcion.
   */
  private async attempt(verificationRunId: string, sharingGrantId: string): Promise<void> {
    const budget = await this.prisma.verificationRun.updateMany({
      where: {
        id: verificationRunId,
        status: ReasoningRunStatus.pending,
        failureCode: null,
        executionAttempts: { lt: MAX_EXECUTION_ATTEMPTS_PER_RUN }
      },
      data: { executionAttempts: { increment: 1 } }
    });
    if (budget.count !== 1) {
      await this.failIfBudgetExhausted(verificationRunId);
      return;
    }

    try {
      await this.engine.execution.executeReasoningRun(verificationRunId, {
        beforeProviderStage: async () => this.assertStillAuthorized(sharingGrantId)
      });
    } catch {
      // Clasificado y persistido por el orquestador: `pending` si fue
      // transitorio, `failed` si fue terminal. Nada del error sale al tercero.
    }

    await this.failIfBudgetExhausted(verificationRunId);
  }

  /** Relectura del consentimiento en el borde de etapa. Sin inventario. */
  private async assertStillAuthorized(sharingGrantId: string): Promise<void> {
    const grant = await this.prisma.sharingGrant.findUnique({
      where: { id: sharingGrantId },
      select: SHARE_AUTHORITY_SELECT
    });
    try {
      assertContextualShareAuthority(grant, this.clock());
    } catch {
      throw new ExecutionAuthorizationWithdrawnError();
    }
  }

  /** Tras el ultimo intento transitorio, el run no queda `pending` para siempre. */
  private async failIfBudgetExhausted(verificationRunId: string): Promise<void> {
    await this.prisma.verificationRun.updateMany({
      where: {
        id: verificationRunId,
        status: ReasoningRunStatus.pending,
        failureCode: null,
        executionAttempts: { gte: MAX_EXECUTION_ATTEMPTS_PER_RUN }
      },
      data: {
        status: ReasoningRunStatus.failed,
        failureCode: PUBLIC_RETRY_BUDGET_EXHAUSTED,
        failedAt: this.clock()
      }
    });
  }
}
