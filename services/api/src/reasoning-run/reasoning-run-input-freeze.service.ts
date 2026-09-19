/**
 * Congelamiento de inputs del ReasoningRun — slice F3.2.
 *
 * Responde una sola pregunta, de forma determinista y sin ninguna llamada a
 * modelo:
 *
 *     "Para este holder y este Objective, ¿cuál era exactamente el universo de
 *      credenciales/evidencia, y qué extracción exacta quedó preparada como
 *      input del futuro reasoner?"
 *
 * NO ejecuta Objective Analysis, no construye EvidenceUnits, no razona, no aplica
 * policy, no llama al proveedor ni a FastAPI, y NO CREA EXTRACCIONES. Observa y
 * congela el estado que ya existe. Si a una fuente le falta la extracción, eso se
 * registra como un hecho — no se arregla llamando a F1.4.
 *
 * LA AUTORIDAD SE DERIVA, NUNCA LLEGA DEL LLAMANTE. La firma acepta
 * `(ownerUserId, objectiveId)` y nada más: no hay forma de pasar el snapshot del
 * Objective, ids de credenciales, ids de evidencia, ids de `AnalysisRunSource` ni
 * SHAs. La misma disciplina causal de F0.5/F1.4.
 *
 * TODO OCURRE DENTRO DE UNA SOLA TRANSACCIÓN SERIALIZABLE. El snapshot del
 * Objective, la clasificación de credenciales y fuentes, la selección de
 * candidatos de extracción y la persistencia final leen el MISMO estado del
 * dominio. Sin llamadas de red, sin descargas de storage: F3.2 no las necesita,
 * así que no hay ninguna razón para mantener la transacción abierta esperando a
 * nadie.
 *
 * WRAPPER DE PRODUCTO DEL HOLDER. Lo unico propio de este archivo es la
 * autoridad del holder: el Objective que le pertenece y el universo de SUS
 * credenciales. La clasificacion de evidencia vive en
 * `credential-inventory.classifier.ts` y la comparte, sin ninguna diferencia, el
 * VerificationRun publico.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, ReasoningRunInventoryDisposition, ReasoningRunStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import {
  classifyCredentialInventory,
  isBlockedDisposition,
  loadCredentialsForInventory
} from './credential-inventory.classifier';
import {
  REASONING_INPUT_FREEZE_BLOCKED,
  failFreeze
} from './reasoning-run-input-freeze.errors';

const D = ReasoningRunInventoryDisposition;

export interface FrozenReasoningRun {
  readonly reasoningRunId: string;
  readonly status: ReasoningRunStatus;
  readonly failureCode: string | null;
  readonly inventorySize: number;
  readonly includedSourceCount: number;
  readonly blockedSourceCount: number;
}

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class ReasoningRunInputFreezeService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly slots: SourceExtractionSlotService
  ) {}

  /**
   * Crea un `ReasoningRun` con su inventario COMPLETO congelado.
   *
   * `ownerUserId` lo aporta el llamante interno —el futuro `/me` de F3.7—, y es
   * la única autoridad de identidad que entra. Todo lo demás se deriva.
   */
  public async createFrozenReasoningRunForUser(
    ownerUserId: string,
    objectiveId: string
  ): Promise<FrozenReasoningRun> {
    return this.prisma.$transaction(
      async (tx) => this.freeze(tx, ownerUserId, objectiveId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async freeze(
    tx: TransactionClient,
    ownerUserId: string,
    objectiveId: string
  ): Promise<FrozenReasoningRun> {
    const objective = await this.loadOwnedObjective(tx, ownerUserId, objectiveId);

    // El universo del holder: `subjectUserId` es el titular. NO se infiere
    // pertenencia por email, por DID, por issuer ni por quién subió la evidencia.
    const credentials = await loadCredentialsForInventory(tx, { subjectUserId: ownerUserId });
    const numbered = await classifyCredentialInventory(tx, this.slots, credentials);

    const blocked = numbered.filter((row) => isBlockedDisposition(row.disposition));
    const included = numbered.filter((row) => row.disposition === D.INCLUDED);
    const failed = blocked.length > 0;
    const now = new Date();

    const run = await tx.reasoningRun.create({
      data: {
        ownerUserId,
        objectiveId,
        objectiveDefinitionSnapshot: objective.definition as Prisma.InputJsonValue,
        objectiveTitleSnapshot: objective.title,
        status: failed ? ReasoningRunStatus.failed : ReasoningRunStatus.pending,
        failureCode: failed ? REASONING_INPUT_FREEZE_BLOCKED : null,
        failedAt: failed ? now : null,
        inventory: { create: numbered.map((row) => ({ ...row })) }
      },
      select: { id: true, status: true, failureCode: true }
    });

    return {
      reasoningRunId: run.id,
      status: run.status,
      failureCode: run.failureCode,
      inventorySize: numbered.length,
      includedSourceCount: included.length,
      blockedSourceCount: blocked.length
    };
  }

  // -------------------------------------------------------------------------
  // Objective
  // -------------------------------------------------------------------------

  /**
   * Un Objective ajeno y uno inexistente dan el MISMO resultado.
   *
   * El filtro combinado hace que la pregunta "¿existe este id?" no sea
   * respondible por un holder que no lo posee, igual que en `/me/objectives`.
   */
  private async loadOwnedObjective(
    tx: TransactionClient,
    ownerUserId: string,
    objectiveId: string
  ): Promise<{ definition: unknown; title: string }> {
    const objective = await tx.objective.findFirst({
      where: { id: objectiveId, ownerUserId },
      select: { definition: true, title: true }
    });

    if (!objective) {
      failFreeze('OBJECTIVE_NOT_FOUND', {
        invariant: 'objective_does_not_exist_or_is_not_owned_by_this_user',
        objectiveId
      });
    }

    // Se re-verifica con el verificador productivo de F2 en vez de copiar la
    // columna a ciegas: un run congelado contra una definición ilegible no
    // podría validarse después contra nada.
    try {
      verifyObjectiveDefinitionArtifact(objective.definition);
    } catch {
      failFreeze('OBJECTIVE_DEFINITION_CORRUPT', {
        invariant: 'persisted_objective_definition_must_verify',
        objectiveId
      });
    }

    return { definition: objective.definition, title: objective.title };
  }
}
