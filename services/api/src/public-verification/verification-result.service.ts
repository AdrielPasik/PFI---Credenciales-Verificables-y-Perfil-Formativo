/**
 * Lectura publica del estado y resultado de una sesion de verificador.
 *
 * AUTORIDAD (la misma que `resolveSessionRun` del freeze):
 *
 *   enlace revocado / vencido / alcance no soportado  -> SHARE_NOT_AVAILABLE,
 *                                                        aunque exista resultado
 *   solicitud inexistente o de otro enlace            -> REQUEST_NOT_AVAILABLE
 *   sin run y solicitud vencida                       -> REQUEST_NOT_AVAILABLE
 *   run existente                                     -> se resuelve aunque la
 *                                                        solicitud haya vencido
 *
 * La politica de computo NO se mira: deshabilitarla despues de completar no
 * oculta un resultado ya producido. Revocar el enlace si corta el acceso; la
 * fila se conserva.
 *
 * RESOLUCION
 *
 *   draft / requirements_proposed          AWAITING_REQUIREMENTS
 *   requirements_confirmed, sin run        READY_TO_EXECUTE
 *   pending con lease vivo del run         PROCESSING (entre freeze y claim)
 *   pending sin lease, 0..2 intentos       FAILED retryable TEMPORARILY_UNAVAILABLE
 *   pending sin lease, 3 intentos          FAILED RETRY_BUDGET_EXHAUSTED
 *   running con lease vivo del run         PROCESSING
 *   running sin lease vivo                 FAILED EXECUTION_INTERRUPTED
 *   failed                                 FAILED con categoria segura
 *   completed                              COMPLETED + proyeccion allowlist
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  ReasoningRunInventoryDisposition,
  ReasoningRunStatus,
  VerificationRequestStatus
} from '@prisma/client';

import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { PrismaService } from '../prisma/prisma.service';
import { verifyEvidenceUnitsArtifact } from '../reasoning-run/evidence-units-artifact.validator';
import { verifyReasoningRunResultArtifact } from '../reasoning-run/reasoning-run-result-artifact.validator';
import { PublicVerificationError } from './public-verification.errors';
import { MAX_EXECUTION_ATTEMPTS_PER_RUN } from './public-verification.limits';
import { hasLiveLeaseForRun } from './verification-execution-lease';
import { loadSessionForShare } from './verification-request.service';
import {
  type PublicFailureCategory,
  type PublicVerificationResultDto,
  projectCompletedVerification,
  projectPublicObjective
} from './verification-result.projection';

/** Codigos internos que produce este slice. Nunca salen: se traducen a categoria. */
export const EXECUTION_AUTHORIZATION_WITHDRAWN = 'execution_authorization_withdrawn';
export const PUBLIC_RETRY_BUDGET_EXHAUSTED = 'public_verification_retry_budget_exhausted';

export const VERIFICATION_RUN_READ_SELECT = {
  id: true,
  sharingGrantId: true,
  status: true,
  failureCode: true,
  executionAttempts: true,
  objectiveDefinitionSnapshot: true,
  objectiveTitleSnapshot: true,
  evidenceUnitsArtifact: true,
  resultArtifact: true,
  createdAt: true,
  startedAt: true,
  completedAt: true
} as const;

const INVENTORY_SELECT = {
  runLocalSourceId: true,
  documentEvidenceId: true,
  textEvidenceId: true,
  credential: {
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      issuer: { select: { name: true } }
    }
  }
} as const;

export function failureCategoryFor(failureCode: string | null): PublicFailureCategory {
  switch (failureCode) {
    case EXECUTION_AUTHORIZATION_WITHDRAWN:
      return 'AUTHORIZATION_WITHDRAWN';
    case PUBLIC_RETRY_BUDGET_EXHAUSTED:
      return 'RETRY_BUDGET_EXHAUSTED';
    default:
      return 'EXECUTION_FAILED';
  }
}

@Injectable()
export class VerificationResultService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async readResult(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date = new Date()
  ): Promise<PublicVerificationResultDto> {
    const { row } = await loadSessionForShare(this.prisma, rawShareToken, rawRequestToken, now);

    if (row.status !== VerificationRequestStatus.consumed) {
      // Sin run, el vencimiento de la solicitud manda.
      if (row.expiresAt <= now) throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
      return {
        state:
          row.status === VerificationRequestStatus.requirements_confirmed
            ? 'READY_TO_EXECUTE'
            : 'AWAITING_REQUIREMENTS',
        objective:
          row.status === VerificationRequestStatus.requirements_confirmed &&
          row.confirmedObjectiveDefinition !== null
            ? projectPublicObjective(
                verifyObjectiveDefinitionArtifact(row.confirmedObjectiveDefinition),
                row.objectiveTitle
              )
            : null,
        completedAt: null,
        failure: null,
        result: null
      };
    }

    const run = await this.prisma.verificationRun.findUnique({
      where: { verificationRequestId: row.id },
      select: VERIFICATION_RUN_READ_SELECT
    });
    if (!run) throw new Error('verification_request_consumed_without_run');
    return this.resolveRun(run, now);
  }

  async resolveRun(
    run: {
      id: string;
      sharingGrantId: string;
      status: ReasoningRunStatus;
      failureCode: string | null;
      executionAttempts: number;
      objectiveDefinitionSnapshot: unknown;
      objectiveTitleSnapshot: string | null;
      evidenceUnitsArtifact: unknown;
      resultArtifact: unknown;
      createdAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
    },
    now: Date
  ): Promise<PublicVerificationResultDto> {
    const definition = verifyObjectiveDefinitionArtifact(run.objectiveDefinitionSnapshot);
    const objective = projectPublicObjective(definition, run.objectiveTitleSnapshot);
    const failed = (category: PublicFailureCategory, retryable = false): PublicVerificationResultDto => ({
      state: 'FAILED',
      objective,
      completedAt: null,
      failure: { category, retryable },
      result: null
    });
    const processing: PublicVerificationResultDto = {
      state: 'PROCESSING',
      objective,
      completedAt: null,
      failure: null,
      result: null
    };

    switch (run.status) {
      case ReasoningRunStatus.pending:
        // Congelado y entre intentos. Si un dueno vivo lo tiene, esta por
        // reclamarlo; si no, el mismo token lo reanuda con `verification-execute`.
        if (await hasLiveLeaseForRun(this.prisma, run.sharingGrantId, run.id, now)) return processing;
        return run.executionAttempts < MAX_EXECUTION_ATTEMPTS_PER_RUN
          ? failed('TEMPORARILY_UNAVAILABLE', true)
          : failed('RETRY_BUDGET_EXHAUSTED');

      case ReasoningRunStatus.running:
        // NON_RECOVERABLE_RUNNING_CLAIM heredado del motor: sin dueno vivo, nadie
        // va a terminar este run y el motor no permite robar la claim.
        return (await hasLiveLeaseForRun(this.prisma, run.sharingGrantId, run.id, now))
          ? processing
          : failed('EXECUTION_INTERRUPTED');

      case ReasoningRunStatus.failed:
        return failed(failureCategoryFor(run.failureCode));

      case ReasoningRunStatus.completed: {
        const inventory = await this.prisma.verificationRunInventoryItem.findMany({
          where: { verificationRunId: run.id, disposition: ReasoningRunInventoryDisposition.INCLUDED },
          select: INVENTORY_SELECT
        });
        return projectCompletedVerification({
          definition,
          title: run.objectiveTitleSnapshot,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt ?? now,
          result: verifyReasoningRunResultArtifact(run.resultArtifact),
          evidenceUnits: verifyEvidenceUnitsArtifact(run.evidenceUnitsArtifact),
          inventory: inventory.flatMap((item) =>
            item.runLocalSourceId === null
              ? []
              : [
                  {
                    runLocalSourceId: item.runLocalSourceId,
                    documentEvidenceId: item.documentEvidenceId,
                    textEvidenceId: item.textEvidenceId,
                    credential: {
                      id: item.credential.id,
                      title: item.credential.title,
                      credentialType: item.credential.type,
                      issuerName: item.credential.issuer.name,
                      currentStatus: item.credential.status
                    }
                  }
                ]
          )
        });
      }
    }
    return failed('EXECUTION_FAILED');
  }
}
