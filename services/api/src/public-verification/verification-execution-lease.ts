/**
 * Lease de ejecucion por enlace: a lo sumo UNA ejecucion publica activa por
 * SharingGrant.
 *
 * NO DEPENDE DE SSI. La exclusion es un UPDATE condicional sobre UNA fila
 * (`VerificationExecutionLease`, PK = sharingGrantId):
 *
 *     UPDATE ... SET owner = yo, expiresAt = now + ttl
 *     WHERE sharingGrantId = X AND (ownerToken IS NULL OR expiresAt <= now)
 *
 * En Postgres dos UPDATE concurrentes sobre la misma fila se serializan por el
 * lock de fila: el segundo re-evalua el WHERE sobre la version ya escrita y
 * obtiene `count = 0`. Eso vale en READ COMMITTED, sin transaccion explicita.
 * La fila se crea antes con `createMany({ skipDuplicates })` (INSERT ... ON
 * CONFLICT DO NOTHING), que tambien es seguro en concurrencia.
 *
 * CICLO DE VIDA
 *
 *   dueno        `ownerToken`, opaco y aleatorio por intento de ejecucion
 *   adquisicion  `acquiredAt`
 *   vencimiento  `expiresAt` = acquiredAt + executionLeaseMs()
 *   liberacion   solo quien tiene el `ownerToken`; un dueno vencido que vuelve
 *                tarde no puede liberar el lease de otro
 *
 * Un proceso que muere deja el lease tomado hasta `expiresAt`: el enlace queda
 * bloqueado como maximo ese tiempo, nunca para siempre.
 */

import { randomBytes } from 'node:crypto';

import { type Prisma } from '@prisma/client';

type LeaseClient = Pick<Prisma.TransactionClient, 'verificationExecutionLease'>;

export interface ExecutionLease {
  readonly sharingGrantId: string;
  readonly ownerToken: string;
}

export async function acquireExecutionLease(
  prisma: LeaseClient,
  sharingGrantId: string,
  now: Date,
  ttlMs: number
): Promise<ExecutionLease | null> {
  await prisma.verificationExecutionLease.createMany({
    data: [{ sharingGrantId }],
    skipDuplicates: true
  });

  const ownerToken = randomBytes(24).toString('base64url');
  const taken = await prisma.verificationExecutionLease.updateMany({
    where: {
      sharingGrantId,
      OR: [{ ownerToken: null }, { expiresAt: { lte: now } }]
    },
    data: {
      ownerToken,
      verificationRunId: null,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttlMs)
    }
  });
  return taken.count === 1 ? { sharingGrantId, ownerToken } : null;
}

/** Registra que run ejecuta este lease. Solo el dueno puede. */
export async function attachRunToLease(
  prisma: LeaseClient,
  lease: ExecutionLease,
  verificationRunId: string
): Promise<boolean> {
  const updated = await prisma.verificationExecutionLease.updateMany({
    where: { sharingGrantId: lease.sharingGrantId, ownerToken: lease.ownerToken },
    data: { verificationRunId }
  });
  return updated.count === 1;
}

export async function releaseExecutionLease(
  prisma: LeaseClient,
  lease: ExecutionLease
): Promise<void> {
  await prisma.verificationExecutionLease.updateMany({
    where: { sharingGrantId: lease.sharingGrantId, ownerToken: lease.ownerToken },
    data: { ownerToken: null, verificationRunId: null, acquiredAt: null, expiresAt: null }
  });
}

/**
 * Hay un dueno VIVO ejecutando este run.
 *
 * Lo usa la lectura del resultado para distinguir "procesando" de "interrumpido":
 * un run `running` sin lease vivo que lo nombre no tiene quien lo termine.
 */
export async function hasLiveLeaseForRun(
  prisma: LeaseClient,
  sharingGrantId: string,
  verificationRunId: string,
  now: Date
): Promise<boolean> {
  const lease = await prisma.verificationExecutionLease.findUnique({
    where: { sharingGrantId },
    select: { ownerToken: true, verificationRunId: true, expiresAt: true }
  });
  return (
    lease !== null &&
    lease.ownerToken !== null &&
    lease.verificationRunId === verificationRunId &&
    lease.expiresAt !== null &&
    lease.expiresAt > now
  );
}
