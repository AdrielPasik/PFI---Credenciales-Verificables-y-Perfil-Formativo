/**
 * Puerto de almacenamiento del motor F3.
 *
 * EL MOTOR NO SE COPIA. Claim, slots fill-once, etapas, grounding, policy y
 * finalizacion son UN solo codigo. Lo unico que cambia entre productos es en que
 * TABLA viven el run y su inventario congelado:
 *
 *     ReasoningRun        ReasoningRunInventoryItem        holder (default)
 *     VerificationRun     VerificationRunInventoryItem     verificacion publica
 *
 * POR QUE ES SEGURO. Auditado sobre las 21 llamadas del motor: todas usan
 * exactamente tres operaciones -- `findUnique` y `updateMany` del run y
 * `findMany` del inventario -- y SOLO columnas que existen con el mismo nombre y
 * tipo en las dos tablas (status, failureCode, startedAt, completedAt, failedAt,
 * objectiveDefinitionSnapshot y los cuatro slots). Ninguna etapa lee
 * `ownerUserId` ni `objectiveId`. Una guarda estructural lo congela.
 *
 * LA UNICA TRADUCCION es la clave del inventario: `reasoningRunId` ->
 * `verificationRunId`. Vive en UNA funcion y falla cerrado si la clave falta: un
 * `findMany` sin filtro de run leeria el inventario de TODOS los runs.
 */

import { type Prisma } from '@prisma/client';

type Client = Pick<Prisma.TransactionClient, 'reasoningRun' | 'reasoningRunInventoryItem'>;

export interface ReasoningRunTable {
  readonly runs: Pick<Client['reasoningRun'], 'findUnique' | 'updateMany'>;
  readonly inventory: Pick<Client['reasoningRunInventoryItem'], 'findMany'>;
}

/** Token de inyeccion. Sin proveedor registrado, el motor usa la tabla del holder. */
export const REASONING_RUN_TABLE = Symbol('REASONING_RUN_TABLE');

/** La tabla del holder: exactamente lo que el motor usaba antes del puerto. */
export function holderReasoningRunTable(prisma: Client): ReasoningRunTable {
  return {
    runs: prisma.reasoningRun,
    inventory: prisma.reasoningRunInventoryItem
  };
}

type VerificationClient = Pick<
  Prisma.TransactionClient,
  'verificationRun' | 'verificationRunInventoryItem'
>;

/**
 * La misma forma, sobre `VerificationRun`.
 *
 * Los argumentos del run pasan sin cambios: las columnas usadas son identicas.
 * Los del inventario reemplazan `reasoningRunId` por `verificationRunId`.
 */
export function verificationRunTable(prisma: VerificationClient): ReasoningRunTable {
  const runs = {
    findUnique: ((args: unknown) =>
      prisma.verificationRun.findUnique(args as never)) as unknown as ReasoningRunTable['runs']['findUnique'],
    updateMany: ((args: unknown) =>
      prisma.verificationRun.updateMany(args as never)) as unknown as ReasoningRunTable['runs']['updateMany']
  };

  const inventory = {
    findMany: ((args: { where?: Record<string, unknown> } & Record<string, unknown>) => {
      const where = { ...(args?.where ?? {}) };
      const runId = where.reasoningRunId;
      if (typeof runId !== 'string' || runId.length === 0) {
        // Fail closed: sin clave de run, esto seria un barrido de todos los
        // inventarios publicos.
        throw new Error('verification_run_inventory_query_requires_run_id');
      }
      delete where.reasoningRunId;
      return prisma.verificationRunInventoryItem.findMany({
        ...args,
        where: { ...where, verificationRunId: runId }
      } as never);
    }) as unknown as ReasoningRunTable['inventory']['findMany']
  };

  return { runs, inventory };
}
