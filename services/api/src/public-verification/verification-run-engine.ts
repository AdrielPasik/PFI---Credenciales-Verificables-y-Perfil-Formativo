/**
 * El motor F3 sobre `VerificationRun`.
 *
 * NO ES UNA COPIA. Son las MISMAS clases del holder -- claim, slots fill-once,
 * grounding, Objective Analysis, Evidence Units, razonamiento contextual, policy
 * determinista y finalizacion atomica -- instanciadas con el puerto de tabla que
 * apunta a `VerificationRun` / `VerificationRunInventoryItem`.
 *
 * Se arma con una factory y no registrando las clases en este modulo con el token
 * `REASONING_RUN_TABLE`: asi el grafo del holder no puede recibir por accidente
 * la tabla publica, ni esta la del holder.
 */

import { type AiServiceClient } from '../ai/ai-service.client';
import { type PrismaService } from '../prisma/prisma.service';
import { ReasoningRunArtifactSlotService } from '../reasoning-run/reasoning-run-artifact-slot.service';
import { ReasoningRunContextualReasoningService } from '../reasoning-run/reasoning-run-contextual-reasoning.service';
import { ReasoningRunEvidenceUnitsService } from '../reasoning-run/reasoning-run-evidence-units.service';
import { ReasoningRunExecutionClaimService } from '../reasoning-run/reasoning-run-execution-claim.service';
import { ReasoningRunExecutionService } from '../reasoning-run/reasoning-run-execution.service';
import { ReasoningRunGroundingLoader } from '../reasoning-run/reasoning-run-grounding.loader';
import { ReasoningRunObjectiveAnalysisService } from '../reasoning-run/reasoning-run-objective-analysis.service';
import { verificationRunTable } from '../reasoning-run/reasoning-run-table';
import { type SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';

export const VERIFICATION_RUN_ENGINE = Symbol('VERIFICATION_RUN_ENGINE');

export interface VerificationRunEngine {
  readonly execution: ReasoningRunExecutionService;
  /** Lectura verificada de artifacts persistidos del run publico. */
  readonly slots: ReasoningRunArtifactSlotService;
}

export function buildVerificationRunEngine(
  prisma: PrismaService,
  ai: AiServiceClient,
  extractionSlots: SourceExtractionSlotService
): VerificationRunEngine {
  const table = verificationRunTable(prisma);
  const slots = new ReasoningRunArtifactSlotService(prisma, table);
  const grounding = new ReasoningRunGroundingLoader(prisma, extractionSlots, table);
  const claims = new ReasoningRunExecutionClaimService(prisma, table);
  const objectiveAnalysis = new ReasoningRunObjectiveAnalysisService(prisma, slots, ai, table);
  const evidenceUnits = new ReasoningRunEvidenceUnitsService(prisma, slots, grounding, ai, table);
  const contextual = new ReasoningRunContextualReasoningService(prisma, slots, grounding, ai, table);
  const execution = new ReasoningRunExecutionService(
    prisma,
    claims,
    slots,
    objectiveAnalysis,
    evidenceUnits,
    contextual,
    table
  );
  return { execution, slots };
}
