import { Injectable } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  DocumentEvidenceKind,
  DocumentEvidenceStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { BACKEND_CONTROLLED_ANALYSIS_VERSION } from './analysis-run.constants';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';

const REUSABLE_RUN_STATUSES = [
  AnalysisRunStatus.pending,
  AnalysisRunStatus.running,
  AnalysisRunStatus.completed
];

@Injectable()
export class AutomaticDocumentAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisRunService: AnalysisRunService,
    private readonly executionService: AnalysisRunExecutionService
  ) {}

  async analyzeIssuedCredentialIfEligible(credentialId: string): Promise<void> {
    const currentDocument = await this.prisma.documentEvidence.findFirst({
      where: {
        credentialId,
        status: DocumentEvidenceStatus.current
      },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        kind: true,
        mimeType: true
      }
    });

    if (
      !currentDocument ||
      currentDocument.kind !== DocumentEvidenceKind.pdf ||
      currentDocument.mimeType !== 'application/pdf'
    ) {
      return;
    }

    const existingRun = await this.prisma.analysisRun.findFirst({
      where: {
        credentialId,
        inputMode: AnalysisRunInputMode.document,
        status: { in: REUSABLE_RUN_STATUSES },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.document_evidence,
            documentEvidenceId: currentDocument.id
          }
        }
      },
      select: { id: true }
    });

    if (existingRun) {
      return;
    }

    const pending = await this.analysisRunService.createPendingRun({
      credentialId,
      requestedByUserId: null,
      inputMode: AnalysisRunInputMode.document,
      trigger: AnalysisRunTrigger.system,
      requestedPipelineVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION,
      requestedTaxonomyVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION
    });

    await this.executionService.executePendingDocumentRun(
      pending.runReference
    );
  }
}
