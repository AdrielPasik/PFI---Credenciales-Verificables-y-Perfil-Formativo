import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  DocumentEvidenceStatus,
  Prisma,
  TextEvidenceStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  AnalysisRunSummary,
  CreateAnalysisRunInput
} from './analysis-run.types';

const evidenceSelect = {
  id: true,
  credentialId: true,
  sha256: true,
  status: true
} as const;

type SafeEvidence = {
  id: string;
  credentialId: string;
  sha256: string;
  status: DocumentEvidenceStatus | TextEvidenceStatus;
};

@Injectable()
export class AnalysisRunService {
  constructor(private readonly prisma: PrismaService) {}

  async createPendingRun(
    input: CreateAnalysisRunInput
  ): Promise<AnalysisRunSummary> {
    const normalized = this.validateInput(input);

    return this.prisma.$transaction(
      async (transaction) => {
        const credential = await transaction.credential.findUnique({
          where: { id: normalized.credentialId },
          select: { id: true, status: true }
        });
        if (!credential) {
          throw new NotFoundException('No se encontro la credencial solicitada.');
        }
        if (
          credential.status !== CredentialStatus.draft &&
          !(
            normalized.trigger === AnalysisRunTrigger.system &&
            credential.status === CredentialStatus.issued
          )
        ) {
          throw new ConflictException(
            'La credencial no admite este tipo de analisis.'
          );
        }

        const sources = await this.resolveCurrentSources(
          transaction,
          credential.id,
          normalized.inputMode
        );
        const run = await transaction.analysisRun.create({
          data: {
            credentialId: credential.id,
            requestedByUserId: normalized.requestedByUserId,
            status: AnalysisRunStatus.pending,
            inputMode: normalized.inputMode,
            trigger: normalized.trigger,
            requestedPipelineVersion: normalized.requestedPipelineVersion,
            requestedTaxonomyVersion: normalized.requestedTaxonomyVersion,
            sources: { create: sources }
          },
          select: {
            id: true,
            credentialId: true,
            status: true,
            inputMode: true,
            trigger: true,
            requestedPipelineVersion: true,
            requestedTaxonomyVersion: true,
            createdAt: true,
            sources: { select: { sourceType: true } }
          }
        });

        return {
          runReference: run.id,
          credentialReference: run.credentialId,
          status: run.status,
          inputMode: run.inputMode,
          trigger: run.trigger,
          requestedPipelineVersion: run.requestedPipelineVersion,
          requestedTaxonomyVersion: run.requestedTaxonomyVersion,
          sourceTypes: run.sources.map((source) => source.sourceType),
          sourceCount: run.sources.length,
          createdAt: run.createdAt.toISOString()
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async resolveCurrentSources(
    transaction: Prisma.TransactionClient,
    credentialId: string,
    inputMode: AnalysisRunInputMode
  ): Promise<Prisma.AnalysisRunSourceUncheckedCreateWithoutAnalysisRunInput[]> {
    const needsDocument = inputMode !== AnalysisRunInputMode.text;
    const needsText = inputMode !== AnalysisRunInputMode.document;
    const document = needsDocument
      ? await transaction.documentEvidence.findFirst({
          where: { credentialId, status: DocumentEvidenceStatus.current },
          select: evidenceSelect
        })
      : null;
    const text = needsText
      ? await transaction.textEvidence.findFirst({
          where: { credentialId, status: TextEvidenceStatus.current },
          select: evidenceSelect
        })
      : null;

    if (needsDocument && !document) {
      throw new BadRequestException('La credencial no tiene evidencia documental vigente.');
    }
    if (needsText && !text) {
      throw new BadRequestException('La credencial no tiene evidencia textual vigente.');
    }

    const sources: Prisma.AnalysisRunSourceUncheckedCreateWithoutAnalysisRunInput[] = [];
    if (document) {
      sources.push(this.toSource(document, AnalysisRunSourceType.document_evidence));
    }
    if (text) {
      sources.push(this.toSource(text, AnalysisRunSourceType.text_evidence));
    }
    return sources;
  }

  private toSource(
    evidence: SafeEvidence,
    sourceType: AnalysisRunSourceType
  ): Prisma.AnalysisRunSourceUncheckedCreateWithoutAnalysisRunInput {
    if (!/^[0-9a-f]{64}$/i.test(evidence.sha256)) {
      throw new ConflictException('La evidencia vigente no tiene un hash valido.');
    }
    const isDocument = sourceType === AnalysisRunSourceType.document_evidence;
    const source = {
      sourceType,
      documentEvidenceId: isDocument ? evidence.id : null,
      textEvidenceId: isDocument ? null : evidence.id,
      sourceSha256: evidence.sha256.toLowerCase(),
      sourceLabel: null,
      sourceStatusAtRun: evidence.status
    };
    this.assertExactlyOneSource(source);
    return source;
  }

  private assertExactlyOneSource(source: {
    documentEvidenceId: string | null;
    textEvidenceId: string | null;
  }): void {
    if (Boolean(source.documentEvidenceId) === Boolean(source.textEvidenceId)) {
      throw new BadRequestException('Una fuente debe referenciar exactamente una evidencia.');
    }
  }

  private validateInput(input: CreateAnalysisRunInput): CreateAnalysisRunInput {
    const credentialId = this.required(input.credentialId, 'credentialId');
    const pipeline = this.required(
      input.requestedPipelineVersion,
      'requestedPipelineVersion'
    );
    const taxonomy = this.required(
      input.requestedTaxonomyVersion,
      'requestedTaxonomyVersion'
    );
    if (!Object.values(AnalysisRunInputMode).includes(input.inputMode)) {
      throw new BadRequestException('inputMode no es valido.');
    }
    if (!Object.values(AnalysisRunTrigger).includes(input.trigger)) {
      throw new BadRequestException('trigger no es valido.');
    }
    const requester = input.requestedByUserId?.trim() || null;
    if (input.trigger === AnalysisRunTrigger.manual && !requester) {
      throw new BadRequestException(
        'requestedByUserId es requerido para un trigger manual.'
      );
    }
    return {
      credentialId,
      requestedByUserId: requester,
      inputMode: input.inputMode,
      trigger: input.trigger,
      requestedPipelineVersion: pipeline,
      requestedTaxonomyVersion: taxonomy
    };
  }

  private required(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${name} es requerido.`);
    }
    return value.trim();
  }
}
