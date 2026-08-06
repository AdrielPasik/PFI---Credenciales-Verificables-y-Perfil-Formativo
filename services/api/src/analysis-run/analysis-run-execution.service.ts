import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  CredentialStatus,
  DocumentEvidenceKind,
  Prisma
} from '@prisma/client';

import { AiServiceClient } from '../ai/ai-service.client';
import { AiServiceClientError } from '../ai/ai-service.types';
import { DocumentStorageError } from '../document-evidence/document-storage.error';
import {
  DOCUMENT_STORAGE_PORT,
  DocumentStoragePort
} from '../document-evidence/document-storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { SemanticService } from '../semantic/semantic.service';
import { AnalysisRunExecutionSummary } from './analysis-run.types';

type ClaimedRun = {
  id: string;
  credentialId: string;
  requestedPipelineVersion: string;
  requestedTaxonomyVersion: string;
  documentEvidenceId: string;
  sourceSha256: string;
  sourceCount: number;
};

@Injectable()
export class AnalysisRunExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiServiceClient,
    private readonly semanticService: SemanticService,
    @Inject(DOCUMENT_STORAGE_PORT)
    private readonly storage: DocumentStoragePort
  ) {}

  async executePendingDocumentRun(
    analysisRunId: string
  ): Promise<AnalysisRunExecutionSummary> {
    const runId = this.requiredId(analysisRunId);
    const claimed = await this.claim(runId);
    let stage: 'document' | 'ai' | 'semantic' = 'document';

    try {
      const document = await this.prisma.documentEvidence.findUnique({
        where: { id: claimed.documentEvidenceId },
        select: {
          id: true,
          credentialId: true,
          kind: true,
          originalFileName: true,
          sha256: true,
          storageKey: true
        }
      });
      if (
        !document ||
        document.credentialId !== claimed.credentialId ||
        document.kind !== DocumentEvidenceKind.pdf ||
        document.sha256.toLowerCase() !== claimed.sourceSha256.toLowerCase()
      ) {
        throw new ConflictException('La fuente documental del analisis es inconsistente.');
      }

      const bytes = await this.storage.readDocument(document.storageKey);
      stage = 'ai';
      const artifact = await this.aiClient.analyzePdf({
        fileBytes: bytes,
        documentId: claimed.id,
        fileName: this.safeFileName(document.originalFileName),
        pipelineVersion: claimed.requestedPipelineVersion,
        taxonomyVersion: claimed.requestedTaxonomyVersion
      });

      stage = 'semantic';
      const completedAt = new Date();
      const completed = await this.prisma.$transaction(
        async (transaction) => {
          const semantic = await this.semanticService.persistForCredential(
            claimed.credentialId,
            artifact,
            { analysisRunId: claimed.id, transaction }
          );
          const update = await transaction.analysisRun.updateMany({
            where: { id: claimed.id, status: AnalysisRunStatus.running },
            data: {
              status: AnalysisRunStatus.completed,
              completedAt,
              failedAt: null,
              errorCode: null,
              errorMessage: null
            }
          });
          if (update.count !== 1) {
            throw new ConflictException('El analisis ya no esta en ejecucion.');
          }
          return semantic;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return {
        runReference: claimed.id,
        credentialReference: claimed.credentialId,
        status: AnalysisRunStatus.completed,
        semanticAnalysisReference: completed.id,
        artifactStatus: completed.status,
        sourceCount: claimed.sourceCount,
        completedAt: completedAt.toISOString()
      };
    } catch (error: unknown) {
      const safe = this.safeFailure(error, stage);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.analysisRun.updateMany({
          where: { id: claimed.id, status: AnalysisRunStatus.running },
          data: {
            status: AnalysisRunStatus.failed,
            failedAt: new Date(),
            errorCode: safe.code,
            errorMessage: safe.message
          }
        });
      });
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ServiceUnavailableException(safe.message);
    }
  }

  private async claim(id: string): Promise<ClaimedRun> {
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.analysisRun.findUnique({
          where: { id },
          select: {
            id: true,
            credentialId: true,
            status: true,
            inputMode: true,
            requestedPipelineVersion: true,
            requestedTaxonomyVersion: true,
            credential: { select: { status: true } },
            sources: {
              select: {
                sourceType: true,
                documentEvidenceId: true,
                textEvidenceId: true,
                sourceSha256: true
              }
            }
          }
        });
        if (!run) throw new NotFoundException('No se encontro el analisis solicitado.');
        if (run.status !== AnalysisRunStatus.pending) {
          throw new ConflictException('El analisis no esta pendiente.');
        }
        if (run.inputMode !== AnalysisRunInputMode.document) {
          throw new ConflictException('P5b solo ejecuta analisis documentales.');
        }
        if (run.credential.status !== CredentialStatus.draft) {
          throw new ConflictException('La credencial ya no esta en borrador.');
        }
        const documents = run.sources.filter(
          (source) => source.sourceType === AnalysisRunSourceType.document_evidence
        );
        if (
          run.sources.length !== 1 ||
          documents.length !== 1 ||
          !documents[0].documentEvidenceId ||
          documents[0].textEvidenceId
        ) {
          throw new ConflictException('El analisis no tiene una unica fuente documental.');
        }
        if (!/^[a-f0-9]{64}$/i.test(documents[0].sourceSha256)) {
          throw new ConflictException('La fuente documental tiene un hash invalido.');
        }
        const claim = await transaction.analysisRun.updateMany({
          where: { id, status: AnalysisRunStatus.pending },
          data: { status: AnalysisRunStatus.running, startedAt: new Date() }
        });
        if (claim.count !== 1) {
          throw new ConflictException('El analisis ya fue reclamado.');
        }
        return {
          id: run.id,
          credentialId: run.credentialId,
          requestedPipelineVersion: run.requestedPipelineVersion,
          requestedTaxonomyVersion: run.requestedTaxonomyVersion,
          documentEvidenceId: documents[0].documentEvidenceId,
          sourceSha256: documents[0].sourceSha256,
          sourceCount: run.sources.length
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private safeFailure(error: unknown, stage: string) {
    if (error instanceof AiServiceClientError) {
      if (error.code === 'timeout') return { code: 'ai_timeout', message: 'El servicio de analisis excedio el tiempo disponible.' };
      if (error.status === 401 || error.status === 403) return { code: 'ai_authentication_failed', message: 'El servicio de analisis rechazo la credencial interna.' };
      return { code: 'ai_unavailable', message: 'El servicio de analisis no esta disponible.' };
    }
    if (error instanceof DocumentStorageError || stage === 'document') {
      return { code: 'document_unavailable', message: 'No se pudo leer la evidencia documental.' };
    }
    if (stage === 'semantic') {
      return { code: 'semantic_persistence_failed', message: 'No se pudo validar o persistir el resultado semantico.' };
    }
    return { code: 'analysis_failed', message: 'No se pudo completar el analisis.' };
  }

  private requiredId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ConflictException('La referencia del analisis es requerida.');
    }
    return value.trim();
  }

  private safeFileName(value: string): string {
    const normalized = value.replace(/[\u0000-\u001f\u007f\\/]/g, ' ').trim();
    return normalized.slice(0, 200) || 'evidence.pdf';
  }
}
