import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  TextEvidenceStatus
} from '@prisma/client';

import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { BACKEND_CONTROLLED_ANALYSIS_VERSION } from './analysis-run.constants';
import { AnalysisRunService } from './analysis-run.service';
import { IssuerDocumentAnalysisResponseDto } from './dto/issuer-document-analysis-response.dto';
import { IssuerTextAnalysisResponseDto } from './dto/issuer-text-analysis-response.dto';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const EXECUTION_FAILED_MESSAGE = 'No se pudo completar el analisis documental.';
const TEXT_EXECUTION_FAILED_MESSAGE = 'No se pudo completar el analisis textual.';
const NO_CURRENT_TEXT_EVIDENCE_MESSAGE =
  'La credencial no tiene evidencia textual vigente para analizar.';
const TEXT_RUN_ALREADY_EXISTS_MESSAGE =
  'Ya existe un analisis textual para esta evidencia; consulta el resultado existente en analysis-runs/latest.';

// C2b.2: mismos estados que ya usa AutomaticDocumentAnalysisService para
// decidir si reusar un run existente en vez de crear uno nuevo -- pending y
// running porque ya hay trabajo en curso, completed porque ya existe un
// resultado para esta fuente exacta.
const REUSABLE_TEXT_RUN_STATUSES: AnalysisRunStatus[] = [
  AnalysisRunStatus.pending,
  AnalysisRunStatus.running,
  AnalysisRunStatus.completed
];

@Injectable()
export class IssuerAnalysisRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly analysisRunService: AnalysisRunService,
    private readonly executionService: AnalysisRunExecutionService
  ) {}

  async triggerDocumentAnalysis(
    issuerId: string,
    credentialId: string,
    requestedByUserId: string
  ): Promise<IssuerDocumentAnalysisResponseDto> {
    await this.issuersService.assertUserCanRunDocumentAnalysisForIssuer(
      requestedByUserId,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: { id: true, status: true }
    });
    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }
    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'Solo una credencial en borrador puede analizarse.'
      );
    }

    const pending = await this.analysisRunService.createPendingRun({
      credentialId: credential.id,
      requestedByUserId,
      inputMode: AnalysisRunInputMode.document,
      trigger: AnalysisRunTrigger.manual,
      requestedPipelineVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION,
      requestedTaxonomyVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION
    });

    try {
      const completed =
        await this.executionService.executePendingDocumentRun(
          pending.runReference
        );
      return {
        analysisRunId: completed.runReference,
        credentialId: completed.credentialReference,
        status: completed.status,
        semanticAnalysisId: completed.semanticAnalysisReference,
        artifactStatus: completed.artifactStatus,
        sourceCount: completed.sourceCount,
        completedAt: completed.completedAt
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new ServiceUnavailableException(EXECUTION_FAILED_MESSAGE);
    }
  }

  /**
   * C2b.2: dispara analisis textual manual sobre la TextEvidence current de
   * una credencial. Draft-only, igual que el trigger documental manual --
   * issued/revoked quedan operativamente read-only para triggers manuales;
   * el analisis automatico post-issue para cursos sin PDF queda para C2b.3.
   *
   * Dedup: por TextEvidence.id current, no solo por credentialId -- si la
   * credencial ya tiene un run pending/running/completed para la MISMA
   * evidencia vigente, se rechaza (409) en vez de crear un run duplicado o
   * reejecutar. Si la evidencia fue reemplazada (nueva TextEvidence
   * current), un run anterior sobre la evidencia vieja no bloquea un
   * analisis nuevo, porque el filtro es por textEvidenceId exacto.
   */
  async triggerTextAnalysis(
    issuerId: string,
    credentialId: string,
    requestedByUserId: string
  ): Promise<IssuerTextAnalysisResponseDto> {
    // Reusa la misma verificacion de rol/membresia/autorizacion que ya usa
    // el trigger documental -- ambos son "ejecutar un analisis" bajo el
    // mismo nivel de permiso; no se agrega un metodo nuevo en IssuersService
    // para mantener este cambio dentro del alcance de analysis-run/**.
    await this.issuersService.assertUserCanRunDocumentAnalysisForIssuer(
      requestedByUserId,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: { id: true, status: true }
    });
    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }
    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'Solo una credencial en borrador puede analizarse.'
      );
    }

    const currentText = await this.prisma.textEvidence.findFirst({
      where: { credentialId: credential.id, status: TextEvidenceStatus.current },
      select: { id: true }
    });
    if (!currentText) {
      throw new UnprocessableEntityException(NO_CURRENT_TEXT_EVIDENCE_MESSAGE);
    }

    const existingRun = await this.prisma.analysisRun.findFirst({
      where: {
        credentialId: credential.id,
        inputMode: AnalysisRunInputMode.text,
        status: { in: REUSABLE_TEXT_RUN_STATUSES },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.text_evidence,
            textEvidenceId: currentText.id
          }
        }
      },
      select: { id: true }
    });
    if (existingRun) {
      throw new ConflictException(TEXT_RUN_ALREADY_EXISTS_MESSAGE);
    }

    const pending = await this.analysisRunService.createPendingRun({
      credentialId: credential.id,
      requestedByUserId,
      inputMode: AnalysisRunInputMode.text,
      trigger: AnalysisRunTrigger.manual,
      requestedPipelineVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION,
      requestedTaxonomyVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION
    });

    try {
      const completed =
        await this.executionService.executePendingTextRun(
          pending.runReference
        );
      return {
        analysisRunId: completed.runReference,
        credentialId: completed.credentialReference,
        status: completed.status,
        semanticAnalysisId: completed.semanticAnalysisReference,
        artifactStatus: completed.artifactStatus,
        sourceCount: completed.sourceCount,
        completedAt: completed.completedAt
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new ServiceUnavailableException(TEXT_EXECUTION_FAILED_MESSAGE);
    }
  }
}
