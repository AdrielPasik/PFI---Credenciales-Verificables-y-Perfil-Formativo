import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  CredentialType,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma,
  TextEvidenceStatus
} from '@prisma/client';

import { buildCourseTextAnalysisContent } from '../credentials/course-text-analysis-content';
import { TextEvidenceService } from '../text-evidence/text-evidence.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';
import { AutomaticProfileRebuildService } from './automatic-profile-rebuild.service';
import { BACKEND_CONTROLLED_ANALYSIS_VERSION } from './analysis-run.constants';

// C2b.3: a diferencia del endpoint manual (C2b.2, que permite reintentar
// despues de un `failed`), el auto-trigger post-emision debe ser
// best-effort y nunca generar reintentos infinitos en la misma llamada de
// emision ni en emisiones repetidas: cualquier run previo para la MISMA
// TextEvidence (sin importar el resultado) bloquea un run nuevo.
const AUTOMATIC_TEXT_ANALYSIS_DEDUP_STATUSES: AnalysisRunStatus[] = [
  AnalysisRunStatus.pending,
  AnalysisRunStatus.running,
  AnalysisRunStatus.completed,
  AnalysisRunStatus.failed
];

type EligibleCredential = {
  id: string;
  type: CredentialType;
  status: CredentialStatus;
  title: string;
  description: string | null;
  subjectUserId: string;
  credentialSubject: Prisma.JsonValue;
  documentEvidences: Array<{ kind: DocumentEvidenceKind; mimeType: string }>;
};

/**
 * C2b.3: analogo a AutomaticDocumentAnalysisService, pero para `course`
 * sin PDF vigente. Reusa TextEvidenceService/AnalysisRunService/
 * AnalysisRunExecutionService ya existentes -- no crea AnalysisRun ni
 * AnalysisRunSource a mano.
 *
 * Nunca lanza: cualquier error (incluida la ejecucion IA) se atrapa y se
 * loguea de forma segura, para que el caller (IssuerCredentialIssueService)
 * nunca vea revertida la emision por esto.
 */
@Injectable()
export class AutomaticCourseTextAnalysisService {
  private readonly logger = new Logger(AutomaticCourseTextAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly textEvidenceService: TextEvidenceService,
    private readonly analysisRunService: AnalysisRunService,
    private readonly executionService: AnalysisRunExecutionService,
    private readonly profileRebuildService: AutomaticProfileRebuildService
  ) {}

  async analyzeIssuedCourseIfEligible(
    credentialId: string,
    submittedByUserId: string
  ): Promise<void> {
    try {
      const credential = await this.readEligibleCredential(credentialId);
      if (!credential) return;
      if (credential.status !== CredentialStatus.issued) return;
      if (credential.type !== CredentialType.course) return;
      if (this.hasCurrentPdf(credential.documentEvidences)) return;

      const textEvidenceId = await this.resolveTextEvidenceId(
        credential,
        submittedByUserId
      );
      if (!textEvidenceId) return;

      const alreadyHandled = await this.hasReusableRunForTextEvidence(
        credentialId,
        textEvidenceId
      );
      if (alreadyHandled) return;

      const pending = await this.analysisRunService.createPendingRun({
        credentialId,
        requestedByUserId: null,
        inputMode: AnalysisRunInputMode.text,
        trigger: AnalysisRunTrigger.system,
        requestedPipelineVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION,
        requestedTaxonomyVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION
      });

      const executed = await this.executionService.executePendingTextRun(
        pending.runReference
      );

      // C2b.4: solo se llega aca si la ejecucion completo y persistio un
      // SemanticAnalysis (executePendingTextRun lanza en cualquier otro
      // caso, y el catch de abajo lo atraparia antes de esta linea).
      await this.profileRebuildService.rebuildAfterAutomaticAnalysis({
        credentialId,
        holderUserId: credential.subjectUserId,
        analysisRunId: executed.runReference
      });
    } catch (error: unknown) {
      this.logSafeFailure(credentialId, error);
    }
  }

  private async readEligibleCredential(
    credentialId: string
  ): Promise<EligibleCredential | null> {
    return this.prisma.credential.findUnique({
      where: { id: credentialId },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        description: true,
        subjectUserId: true,
        credentialSubject: true,
        documentEvidences: {
          where: { status: DocumentEvidenceStatus.current },
          select: { kind: true, mimeType: true }
        }
      }
    });
  }

  private hasCurrentPdf(
    documentEvidences: Array<{ kind: DocumentEvidenceKind; mimeType: string }>
  ): boolean {
    // PDF tiene prioridad absoluta: si hay un PDF vigente, el flujo
    // documental automatico (AutomaticDocumentAnalysisService) ya se
    // encarga -- este servicio nunca genera ni analiza texto en ese caso.
    return documentEvidences.some(
      (document) =>
        document.kind === DocumentEvidenceKind.pdf &&
        document.mimeType === 'application/pdf'
    );
  }

  /**
   * Prioridad de fuentes textuales: si ya existe una TextEvidence
   * `current` (manual o de una ejecucion anterior), se usa tal cual --
   * nunca se genera ni se reemplaza. Solo si no existe ninguna se
   * construye el texto declarado del curso y se genera una nueva.
   * Devuelve null si no hay fuente utilizable (ni existente ni generable).
   */
  private async resolveTextEvidenceId(
    credential: EligibleCredential,
    submittedByUserId: string
  ): Promise<string | null> {
    const existingCurrent = await this.prisma.textEvidence.findFirst({
      where: { credentialId: credential.id, status: TextEvidenceStatus.current },
      select: { id: true }
    });
    if (existingCurrent) {
      return existingCurrent.id;
    }

    const subject = this.asPlainRecord(credential.credentialSubject);
    const content = buildCourseTextAnalysisContent({
      achievementName: credential.title,
      description: credential.description,
      competencies: subject.competencies,
      learningOutcomes: subject.learning_outcomes
    });
    if (!content) return null;

    const ensured =
      await this.textEvidenceService.ensureSystemGeneratedCurrentTextEvidenceForCredential(
        credential.id,
        content,
        submittedByUserId
      );
    return ensured.id;
  }

  private async hasReusableRunForTextEvidence(
    credentialId: string,
    textEvidenceId: string
  ): Promise<boolean> {
    const existingRun = await this.prisma.analysisRun.findFirst({
      where: {
        credentialId,
        inputMode: AnalysisRunInputMode.text,
        status: { in: AUTOMATIC_TEXT_ANALYSIS_DEDUP_STATUSES },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.text_evidence,
            textEvidenceId
          }
        }
      },
      select: { id: true }
    });
    return existingRun !== null;
  }

  private asPlainRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private logSafeFailure(credentialId: string, error: unknown): void {
    const reason =
      error instanceof HttpException ? error.message : 'unexpected_error';
    this.logger.error(
      JSON.stringify({
        event: 'automatic_course_text_analysis_failed',
        credentialId,
        reason
      })
    );
  }
}
