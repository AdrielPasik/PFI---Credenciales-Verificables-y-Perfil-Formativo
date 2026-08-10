import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  CredentialType,
  DocumentEvidenceKind,
  Prisma,
  TextEvidenceStatus
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

type ClaimedRunBase = {
  id: string;
  credentialId: string;
  requestedPipelineVersion: string;
  requestedTaxonomyVersion: string;
  sourceSha256: string;
  sourceCount: number;
};

type ClaimedDocumentRun = ClaimedRunBase & {
  documentEvidenceId: string;
};

type ClaimedTextRun = ClaimedRunBase & {
  textEvidenceId: string;
};

// C2b.2: 'text' se agrega para la ejecucion textual; 'combined' nunca es un
// stage valido -- se rechaza antes de reclamar el run (ver
// assertInputModeSupported), nunca llega a producir un artifact.
type ExecutionStage = 'document' | 'text' | 'ai' | 'semantic';

type SafeFailure = {
  code: string;
  message: string;
};

const COMBINED_NOT_IMPLEMENTED_MESSAGE =
  'El análisis combinado todavía no está implementado.';

@Injectable()
export class AnalysisRunExecutionService {
  private readonly logger = new Logger(AnalysisRunExecutionService.name);

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
    const executionStartedAt = Date.now();

    return this.executeAndComplete(claimed, executionStartedAt, 'document', async (setStage) => {
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
      setStage('ai');
      return this.aiClient.analyzePdf({
        fileBytes: bytes,
        documentId: claimed.id,
        correlationId: claimed.id,
        fileName: this.safeFileName(document.originalFileName),
        pipelineVersion: claimed.requestedPipelineVersion,
        taxonomyVersion: claimed.requestedTaxonomyVersion
      });
    });
  }

  /**
   * C2b.2: ejecuta un AnalysisRun inputMode=text. Reusa el mismo claim ->
   * llamar IA -> validar/persistir SemanticAnalysis -> completar/failed que
   * ya prueba executePendingDocumentRun (ver executeAndComplete) -- la unica
   * diferencia real es la fuente (TextEvidence en vez de DocumentEvidence/
   * storage) y la metadata declarada que se envia junto al contenido.
   */
  async executePendingTextRun(
    analysisRunId: string
  ): Promise<AnalysisRunExecutionSummary> {
    const runId = this.requiredId(analysisRunId);
    const claimed = await this.claimText(runId);
    const executionStartedAt = Date.now();

    return this.executeAndComplete(claimed, executionStartedAt, 'text', async (setStage) => {
      const textEvidence = await this.prisma.textEvidence.findUnique({
        where: { id: claimed.textEvidenceId },
        select: {
          id: true,
          credentialId: true,
          content: true,
          sha256: true,
          status: true
        }
      });
      if (
        !textEvidence ||
        textEvidence.credentialId !== claimed.credentialId ||
        textEvidence.status !== TextEvidenceStatus.current ||
        textEvidence.sha256.toLowerCase() !== claimed.sourceSha256.toLowerCase()
      ) {
        throw new ConflictException('La fuente textual del analisis es inconsistente.');
      }

      const credential = await this.prisma.credential.findUnique({
        where: { id: claimed.credentialId },
        select: { type: true, hours: true, credentialSubject: true }
      });
      if (!credential) {
        throw new ConflictException('La credencial del analisis ya no existe.');
      }

      setStage('ai');
      return this.aiClient.analyzeText({
        content: textEvidence.content,
        metadata: this.buildTextAnalysisMetadata(credential),
        sourceRefs: {
          textEvidenceId: textEvidence.id,
          credentialId: claimed.credentialId
        },
        correlationId: claimed.id,
        pipelineVersion: claimed.requestedPipelineVersion,
        taxonomyVersion: claimed.requestedTaxonomyVersion
      });
    });
  }

  /**
   * Reclama el run (pending -> running) y llama a `produceArtifact`, que debe
   * leer la fuente correspondiente (document/text) y devolver el artifact IA
   * crudo. Centraliza la persistencia de SemanticAnalysis, el cierre
   * completed/failed y el logging seguro de errores -- comun a document y
   * text, para no duplicar esa logica por cada modo.
   */
  private async executeAndComplete(
    claimed: { id: string; credentialId: string; sourceCount: number },
    executionStartedAt: number,
    initialStage: ExecutionStage,
    produceArtifact: (
      setStage: (stage: ExecutionStage) => void
    ) => Promise<unknown>
  ): Promise<AnalysisRunExecutionSummary> {
    let stage: ExecutionStage = initialStage;
    const setStage = (next: ExecutionStage) => {
      stage = next;
    };

    try {
      const artifact = await produceArtifact(setStage);

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
      this.logFailure({
        analysisRunId: claimed.id,
        credentialId: claimed.credentialId,
        stage,
        safe,
        error,
        durationMs: Date.now() - executionStartedAt
      });
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ServiceUnavailableException(safe.message);
    }
  }

  private buildTextAnalysisMetadata(credential: {
    type: CredentialType;
    hours: Prisma.Decimal | null;
    credentialSubject: Prisma.JsonValue;
  }): Record<string, unknown> {
    const subject = this.asPlainRecord(credential.credentialSubject);
    const metadata: Record<string, unknown> = {
      credentialType: credential.type
    };
    const platformName = this.readOptionalSubjectString(subject, 'platform_name');
    if (platformName) metadata.platformName = platformName;
    const modality = this.readOptionalSubjectString(subject, 'modality');
    if (modality) metadata.modality = modality;
    const hours = this.toNullableNumber(credential.hours);
    if (hours !== null) metadata.hours = hours;
    // languageHint: sin heuristica segura hoy para inferirlo desde
    // credentialSubject; se omite en vez de adivinar (C2b.1 ya documenta
    // que este campo es opcional/futuro).
    return metadata;
  }

  private asPlainRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readOptionalSubjectString(
    subject: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = subject[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private toNullableNumber(value: Prisma.Decimal | null): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async claim(id: string): Promise<ClaimedDocumentRun> {
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.analysisRun.findUnique({
          where: { id },
          select: {
            id: true,
            credentialId: true,
            status: true,
            inputMode: true,
            trigger: true,
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
        this.assertInputModeSupported(
          run.inputMode,
          AnalysisRunInputMode.document,
          'P5b solo ejecuta analisis documentales.'
        );
        const canExecuteForCredential =
          run.credential.status === CredentialStatus.draft ||
          (run.trigger === AnalysisRunTrigger.system &&
            run.credential.status === CredentialStatus.issued);
        if (!canExecuteForCredential) {
          throw new ConflictException(
            'La credencial no admite la ejecucion de este analisis.'
          );
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

  private async claimText(id: string): Promise<ClaimedTextRun> {
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.analysisRun.findUnique({
          where: { id },
          select: {
            id: true,
            credentialId: true,
            status: true,
            inputMode: true,
            trigger: true,
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
        this.assertInputModeSupported(
          run.inputMode,
          AnalysisRunInputMode.text,
          'Este metodo solo ejecuta analisis textuales.'
        );
        const canExecuteForCredential =
          run.credential.status === CredentialStatus.draft ||
          (run.trigger === AnalysisRunTrigger.system &&
            run.credential.status === CredentialStatus.issued);
        if (!canExecuteForCredential) {
          throw new ConflictException(
            'La credencial no admite la ejecucion de este analisis.'
          );
        }
        const texts = run.sources.filter(
          (source) => source.sourceType === AnalysisRunSourceType.text_evidence
        );
        if (
          run.sources.length !== 1 ||
          texts.length !== 1 ||
          !texts[0].textEvidenceId ||
          texts[0].documentEvidenceId
        ) {
          throw new ConflictException('El analisis no tiene una unica fuente textual.');
        }
        if (!/^[a-f0-9]{64}$/i.test(texts[0].sourceSha256)) {
          throw new ConflictException('La fuente textual tiene un hash invalido.');
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
          textEvidenceId: texts[0].textEvidenceId,
          sourceSha256: texts[0].sourceSha256,
          sourceCount: run.sources.length
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /**
   * `combined` nunca es ejecutable hoy (C2b.2 solo implementa text; combined
   * queda fuera de alcance) -- se rechaza con un mensaje honesto antes de
   * comparar contra el modo esperado, para no confundirlo con "modo
   * incorrecto para este metodo".
   */
  private assertInputModeSupported(
    mode: AnalysisRunInputMode,
    expected: AnalysisRunInputMode,
    unsupportedModeMessage: string
  ): void {
    if (mode === AnalysisRunInputMode.combined) {
      throw new ConflictException(COMBINED_NOT_IMPLEMENTED_MESSAGE);
    }
    if (mode !== expected) {
      throw new ConflictException(unsupportedModeMessage);
    }
  }

  private safeFailure(error: unknown, stage: ExecutionStage): SafeFailure {
    if (error instanceof AiServiceClientError) {
      if (error.status === 401 || error.status === 403) {
        return {
          code: 'ai_authentication_failed',
          message: 'El servicio de análisis rechazó la credencial interna.'
        };
      }
      if (error.code === 'timeout' || error.status === 504) {
        return {
          code: 'ai_timeout',
          message: 'El servicio de análisis excedió el tiempo disponible.'
        };
      }
      if (error.code === 'configuration') {
        return {
          code: 'ai_invalid_configuration',
          message: 'La configuración del servicio de análisis no es válida.'
        };
      }
      if (error.code === 'invalid_response') {
        return {
          code: 'ai_invalid_response',
          message: 'El servicio de análisis devolvió una respuesta no válida.'
        };
      }
      if (error.code === 'http') return this.mapHttpFailure(error.status);
      if (error.code === 'unavailable') {
        return {
          code: 'ai_network_unreachable',
          message: 'No se pudo conectar con el servicio de análisis.'
        };
      }
      if (error.code === 'file') {
        return {
          code: 'ai_input_rejected',
          message: 'La evidencia no pudo procesarse automáticamente.'
        };
      }
      return {
        code: 'ai_unavailable',
        message: 'El servicio de análisis no está disponible.'
      };
    }
    if (error instanceof DocumentStorageError || stage === 'document') {
      return {
        code: 'document_unavailable',
        message: 'No se pudo leer la evidencia documental.'
      };
    }
    if (stage === 'text') {
      return {
        code: 'text_unavailable',
        message: 'No se pudo leer la evidencia textual.'
      };
    }
    if (stage === 'semantic') {
      return {
        code: 'semantic_persistence_failed',
        message: 'No se pudo validar o persistir el resultado semántico.'
      };
    }
    return {
      code: 'analysis_failed',
      message: 'No se pudo completar el análisis.'
    };
  }

  private mapHttpFailure(status: number | null): SafeFailure {
    switch (status) {
      case 400:
      case 422:
        return {
          code: 'ai_input_rejected',
          message: 'La evidencia no pudo procesarse automáticamente.'
        };
      case 404:
      case 405:
        return {
          code: 'ai_endpoint_not_found',
          message: 'El servicio de análisis no respondió en la ruta esperada.'
        };
      case 409:
        return {
          code: 'ai_version_conflict',
          message: 'El servicio de análisis no está alineado con la versión solicitada.'
        };
      case 413:
        return {
          code: 'ai_input_too_large',
          message: 'La evidencia supera el tamaño permitido para análisis.'
        };
      case 503:
        return {
          code: 'ai_dependency_unavailable',
          message: 'El servicio de análisis no tiene disponible una dependencia necesaria.'
        };
      case 500:
      default:
        return {
          code: 'ai_unavailable',
          message: 'El servicio de análisis no está disponible.'
        };
    }
  }

  private logFailure(input: {
    analysisRunId: string;
    credentialId: string;
    stage: ExecutionStage;
    safe: SafeFailure;
    error: unknown;
    durationMs: number;
  }) {
    const clientError =
      input.error instanceof AiServiceClientError ? input.error : null;
    const event = {
      event: 'analysis_run_execution_failed',
      analysisRunId: input.analysisRunId,
      credentialId: input.credentialId,
      stage: input.stage,
      errorCode: input.safe.code,
      aiServiceErrorCode: clientError?.code ?? null,
      httpStatus: this.safeHttpStatus(clientError?.status),
      detail: this.sanitizeDiagnosticDetail(clientError?.detail),
      causeCode: this.safeCauseCode(clientError?.causeCode),
      durationMs: Math.max(0, Math.round(input.durationMs))
    };
    this.logger.error(JSON.stringify(event));
  }

  private safeHttpStatus(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
      ? value
      : null;
  }

  private safeCauseCode(value: string | null | undefined): string | null {
    return typeof value === 'string' && /^[A-Z0-9_-]{2,64}$/.test(value)
      ? value
      : null;
  }

  private sanitizeDiagnosticDetail(value: unknown): string | null {
    if (typeof value !== 'string') {
      return value === null || value === undefined ? null : 'structured_detail';
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    if (
      /https?:\/\/|%PDF-|\b(?:authorization|bearer|token|secret|password|storage(?:key)?|path|artifact|content|analysisJson|textForEmbedding)\b/i.test(
        normalized
      )
    ) {
      return 'upstream_detail_redacted';
    }
    return normalized.slice(0, 160);
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
