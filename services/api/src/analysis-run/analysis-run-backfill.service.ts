import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus,
  AnalysisRunTrigger,
  CredentialStatus,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { BACKEND_CONTROLLED_ANALYSIS_VERSION } from './analysis-run.constants';
import { AnalysisRunExecutionService } from './analysis-run-execution.service';
import { AnalysisRunService } from './analysis-run.service';

/**
 * IA-Q1c: herramienta interna de backfill/reanalysis para demo. NO es un
 * endpoint publico. Reusa AnalysisRunService.createPendingRun() y
 * AnalysisRunExecutionService.executePendingDocumentRun() tal cual -- no
 * duplica lectura de storage, llamada a IA, persistencia de
 * SemanticAnalysis ni sanitizacion de errores. Los runs que crea usan
 * inputMode=document, trigger=system, requestedByUserId=null -- los mismos
 * valores que ya usa AutomaticDocumentAnalysisService para P6b -- sin
 * agregar enums Prisma nuevos. El endpoint manual HTTP y el trigger
 * automatico best-effort no cambian: este servicio no se registra en
 * ningun controller.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_CANDIDATE_LIMIT = 25;
const MAX_TITLE_PREVIEW_LENGTH = 80;

// pending/running siempre bloquean (seguridad de concurrencia, --force no
// los ignora). completed bloquea salvo --force. failed/canceled nunca
// bloquean: no impiden reintentar sin --force.
const BLOCKING_RUN_STATUSES = [
  AnalysisRunStatus.pending,
  AnalysisRunStatus.running,
  AnalysisRunStatus.completed
] as const;

export type BackfillSkipReason =
  | 'not_issued'
  | 'no_current_document_evidence'
  | 'non_pdf_evidence'
  | 'already_pending'
  | 'already_running'
  | 'already_analyzed';

export interface BackfillSelector {
  holderEmail?: string;
  credentialId?: string;
}

export interface BackfillOptions {
  force: boolean;
  execute: boolean;
  rebuildProfile: boolean;
  limit?: number;
}

export interface BackfillCredentialResult {
  credentialId: string;
  titlePreview: string;
  outcome: 'processed' | 'planned' | 'skipped' | 'failed';
  skipReason?: BackfillSkipReason;
  runReference?: string;
  semanticAnalysisReference?: string;
  errorCode?: string;
}

export interface BackfillSummary {
  selector: 'holderEmail' | 'credentialId';
  dryRun: boolean;
  force: boolean;
  candidatesFound: number;
  processed: number;
  planned: number;
  skipped: number;
  failed: number;
  results: BackfillCredentialResult[];
  profileRebuilt: boolean;
  profileRebuildSkippedReason?:
    | 'not_requested'
    | 'dry_run'
    | 'no_successful_executions'
    | 'no_holder_resolved';
}

interface Candidate {
  id: string;
  status: CredentialStatus;
  title: string;
  subjectUserId: string;
  currentDocument: { id: string; kind: DocumentEvidenceKind; mimeType: string } | null;
}

const candidateSelect = Prisma.validator<Prisma.CredentialSelect>()({
  id: true,
  status: true,
  title: true,
  subjectUserId: true,
  documentEvidences: {
    where: { status: DocumentEvidenceStatus.current },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { id: true, kind: true, mimeType: true }
  }
});

type CandidateRow = Prisma.CredentialGetPayload<{
  select: typeof candidateSelect;
}>;

@Injectable()
export class AnalysisRunBackfillService {
  private readonly logger = new Logger(AnalysisRunBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisRunService: AnalysisRunService,
    private readonly executionService: AnalysisRunExecutionService,
    private readonly formativeProfileService: FormativeProfileService
  ) {}

  async run(
    selector: BackfillSelector,
    options: BackfillOptions
  ): Promise<BackfillSummary> {
    const selectorKind = this.assertExactlyOneSelector(selector);
    const limit = this.normalizeLimit(options.limit);

    const { candidates, holderUserId } =
      selectorKind === 'holderEmail'
        ? await this.selectByHolderEmail(selector.holderEmail!, limit)
        : await this.selectByCredentialId(selector.credentialId!);

    const results: BackfillCredentialResult[] = [];
    let anySuccess = false;

    for (const candidate of candidates) {
      const result = await this.processCandidate(candidate, options);
      results.push(result);
      if (result.outcome === 'processed') {
        anySuccess = true;
      }
      this.logResult(candidate, result);
    }

    const rebuild = await this.maybeRebuildProfile(
      options,
      holderUserId,
      anySuccess
    );

    return {
      selector: selectorKind,
      dryRun: !options.execute,
      force: options.force,
      candidatesFound: candidates.length,
      processed: results.filter((r) => r.outcome === 'processed').length,
      planned: results.filter((r) => r.outcome === 'planned').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
      ...rebuild
    };
  }

  private async processCandidate(
    candidate: Candidate,
    options: BackfillOptions
  ): Promise<BackfillCredentialResult> {
    const skipReason = await this.decideSkipReason(candidate, options.force);
    if (skipReason) {
      return {
        credentialId: candidate.id,
        titlePreview: this.titlePreview(candidate.title),
        outcome: 'skipped',
        skipReason
      };
    }

    if (!options.execute) {
      return {
        credentialId: candidate.id,
        titlePreview: this.titlePreview(candidate.title),
        outcome: 'planned'
      };
    }

    let runReference: string | undefined;
    try {
      const pending = await this.analysisRunService.createPendingRun({
        credentialId: candidate.id,
        requestedByUserId: null,
        inputMode: AnalysisRunInputMode.document,
        trigger: AnalysisRunTrigger.system,
        requestedPipelineVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION,
        requestedTaxonomyVersion: BACKEND_CONTROLLED_ANALYSIS_VERSION
      });
      runReference = pending.runReference;

      const executed = await this.executionService.executePendingDocumentRun(
        pending.runReference
      );

      return {
        credentialId: candidate.id,
        titlePreview: this.titlePreview(candidate.title),
        outcome: 'processed',
        runReference: executed.runReference,
        semanticAnalysisReference: executed.semanticAnalysisReference
      };
    } catch (error: unknown) {
      return {
        credentialId: candidate.id,
        titlePreview: this.titlePreview(candidate.title),
        outcome: 'failed',
        runReference,
        errorCode: await this.safeErrorCode(error, runReference)
      };
    }
  }

  private async decideSkipReason(
    candidate: Candidate,
    force: boolean
  ): Promise<BackfillSkipReason | null> {
    if (candidate.status !== CredentialStatus.issued) {
      return 'not_issued';
    }
    if (!candidate.currentDocument) {
      return 'no_current_document_evidence';
    }
    if (
      candidate.currentDocument.kind !== DocumentEvidenceKind.pdf ||
      candidate.currentDocument.mimeType !== 'application/pdf'
    ) {
      return 'non_pdf_evidence';
    }

    // Idempotencia por fuente VIGENTE: solo cuenta un run cuya fuente sea
    // el DocumentEvidence current exacto. Si la evidencia fue reemplazada,
    // un run completed contra la evidencia anterior no bloquea un run
    // nuevo para la evidencia current.
    const existingRuns = await this.prisma.analysisRun.findMany({
      where: {
        credentialId: candidate.id,
        inputMode: AnalysisRunInputMode.document,
        status: { in: [...BLOCKING_RUN_STATUSES] },
        sources: {
          some: {
            sourceType: AnalysisRunSourceType.document_evidence,
            documentEvidenceId: candidate.currentDocument.id
          }
        }
      },
      select: { status: true }
    });
    const statuses = new Set(existingRuns.map((run) => run.status));

    if (statuses.has(AnalysisRunStatus.pending)) return 'already_pending';
    if (statuses.has(AnalysisRunStatus.running)) return 'already_running';
    if (statuses.has(AnalysisRunStatus.completed) && !force) {
      return 'already_analyzed';
    }

    return null;
  }

  private async selectByHolderEmail(
    holderEmail: string,
    limit: number
  ): Promise<{ candidates: Candidate[]; holderUserId: string | null }> {
    const normalizedEmail = this.normalizeAndValidateEmail(holderEmail);
    const matches = await this.prisma.user.findMany({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true },
      take: 2
    });

    if (matches.length === 0) {
      throw new NotFoundException(
        'No se encontro un titular con el email indicado.'
      );
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        'No se pudo resolver un unico titular para el email indicado.'
      );
    }

    const holderUserId = matches[0].id;
    const credentials = await this.prisma.credential.findMany({
      where: { subjectUserId: holderUserId, status: CredentialStatus.issued },
      select: candidateSelect,
      orderBy: { id: 'asc' },
      take: limit
    });

    return {
      candidates: credentials.map((credential) => this.toCandidate(credential)),
      holderUserId
    };
  }

  private async selectByCredentialId(
    credentialId: string
  ): Promise<{ candidates: Candidate[]; holderUserId: string | null }> {
    const normalized = credentialId.trim();
    if (!normalized) {
      throw new BadRequestException('credentialId no puede estar vacio.');
    }

    const credential = await this.prisma.credential.findUnique({
      where: { id: normalized },
      select: candidateSelect
    });

    if (!credential) {
      throw new NotFoundException('No se encontro la credencial indicada.');
    }

    const candidate = this.toCandidate(credential);
    return {
      candidates: [candidate],
      holderUserId: candidate.subjectUserId
    };
  }

  private toCandidate(value: CandidateRow): Candidate {
    return {
      id: value.id,
      status: value.status,
      title: value.title,
      subjectUserId: value.subjectUserId,
      currentDocument: value.documentEvidences[0] ?? null
    };
  }

  private async maybeRebuildProfile(
    options: BackfillOptions,
    holderUserId: string | null,
    anySuccess: boolean
  ): Promise<
    Pick<BackfillSummary, 'profileRebuilt' | 'profileRebuildSkippedReason'>
  > {
    if (!options.rebuildProfile) {
      return { profileRebuilt: false, profileRebuildSkippedReason: 'not_requested' };
    }
    if (!options.execute) {
      return { profileRebuilt: false, profileRebuildSkippedReason: 'dry_run' };
    }
    if (!anySuccess) {
      return {
        profileRebuilt: false,
        profileRebuildSkippedReason: 'no_successful_executions'
      };
    }
    if (!holderUserId) {
      return {
        profileRebuilt: false,
        profileRebuildSkippedReason: 'no_holder_resolved'
      };
    }

    await this.formativeProfileService.rebuildForUser(holderUserId);
    return { profileRebuilt: true };
  }

  private assertExactlyOneSelector(
    selector: BackfillSelector
  ): 'holderEmail' | 'credentialId' {
    const hasEmail = Boolean(selector.holderEmail?.trim());
    const hasCredentialId = Boolean(selector.credentialId?.trim());

    if (hasEmail === hasCredentialId) {
      throw new BadRequestException(
        'Debe indicarse exactamente uno de holderEmail o credentialId.'
      );
    }

    return hasEmail ? 'holderEmail' : 'credentialId';
  }

  private normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_CANDIDATE_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new BadRequestException('limit debe ser un entero positivo.');
    }
    return limit;
  }

  private normalizeAndValidateEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !EMAIL_PATTERN.test(normalized)) {
      throw new BadRequestException('holderEmail debe tener un formato valido.');
    }
    return normalized;
  }

  private titlePreview(title: string): string {
    const normalized = title.trim().replace(/\s+/g, ' ');
    return normalized.length > MAX_TITLE_PREVIEW_LENGTH
      ? `${normalized.slice(0, MAX_TITLE_PREVIEW_LENGTH)}...`
      : normalized;
  }

  /**
   * Reusa el errorCode ya sanitizado que AnalysisRunExecutionService
   * persistio en el AnalysisRun fallido (nunca vuelve a sanitizar un error
   * crudo). Si el fallo ocurrio antes de crear el run (createPendingRun),
   * usa un codigo generico fijo -- los mensajes de esas excepciones ya son
   * texto curado por AnalysisRunService, pero igual no se propagan crudos
   * aca para no depender de su redaccion exacta en el resumen del script.
   */
  private async safeErrorCode(
    error: unknown,
    runReference: string | undefined
  ): Promise<string> {
    if (runReference) {
      const run = await this.prisma.analysisRun.findUnique({
        where: { id: runReference },
        select: { errorCode: true }
      });
      if (run?.errorCode) {
        return run.errorCode;
      }
    }
    return 'run_creation_rejected';
  }

  private logResult(candidate: Candidate, result: BackfillCredentialResult) {
    const event = {
      event: 'analysis_run_backfill_' + result.outcome,
      credentialId: candidate.id,
      credentialStatus: candidate.status,
      titlePreview: result.titlePreview,
      skipReason: result.skipReason ?? null,
      runReference: result.runReference ?? null,
      errorCode: result.errorCode ?? null
    };
    if (result.outcome === 'failed') {
      this.logger.error(JSON.stringify(event));
    } else {
      this.logger.log(JSON.stringify(event));
    }
  }
}
