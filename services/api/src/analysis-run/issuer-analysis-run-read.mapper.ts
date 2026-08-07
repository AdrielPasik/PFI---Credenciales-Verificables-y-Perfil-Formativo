import { InternalServerErrorException } from '@nestjs/common';
import {
  AnalysisRunStatus,
  Prisma
} from '@prisma/client';

import { IssuerAnalysisRunStatusResponseDto } from './dto/issuer-analysis-run-status-response.dto';

const INVALID_READ_MODEL_MESSAGE =
  'No se pudo leer el resultado del analisis solicitado.';

const safeFailureMessages: Record<string, string> = {
  ai_timeout: 'El servicio de analisis excedio el tiempo disponible.',
  ai_authentication_failed:
    'El servicio de analisis rechazo la credencial interna.',
  ai_unavailable: 'El servicio de analisis no esta disponible.',
  ai_input_rejected:
    'La evidencia no pudo procesarse automaticamente.',
  ai_endpoint_not_found:
    'El servicio de analisis no respondio en la ruta esperada.',
  ai_version_conflict:
    'El servicio de analisis no esta alineado con la version solicitada.',
  ai_input_too_large:
    'La evidencia supera el tamano permitido para analisis.',
  ai_dependency_unavailable:
    'El servicio de analisis no tiene disponible una dependencia necesaria.',
  ai_invalid_response:
    'El servicio de analisis devolvio una respuesta no valida.',
  ai_invalid_configuration:
    'La configuracion del servicio de analisis no es valida.',
  ai_network_unreachable:
    'No se pudo conectar con el servicio de analisis.',
  document_unavailable: 'No se pudo leer la evidencia documental.',
  semantic_persistence_failed:
    'No se pudo validar o persistir el resultado semantico.',
  analysis_failed: 'No se pudo completar el analisis.'
};

export const issuerAnalysisRunReadSelect =
  Prisma.validator<Prisma.AnalysisRunSelect>()({
    id: true,
    credentialId: true,
    status: true,
    inputMode: true,
    trigger: true,
    requestedPipelineVersion: true,
    requestedTaxonomyVersion: true,
    startedAt: true,
    completedAt: true,
    failedAt: true,
    errorCode: true,
    createdAt: true,
    sources: {
      select: { sourceType: true }
    },
    semanticAnalyses: {
      orderBy: [{ analyzedAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: {
        id: true,
        status: true,
        pipelineVersion: true,
        taxonomyVersion: true,
        confidence: true,
        areas: true,
        skills: true,
        concepts: true,
        qualityFlags: true,
        analyzedAt: true
      }
    }
  });

type IssuerAnalysisRunReadRecord = Prisma.AnalysisRunGetPayload<{
  select: typeof issuerAnalysisRunReadSelect;
}>;

export function mapIssuerAnalysisRunReadModel(
  run: IssuerAnalysisRunReadRecord
): IssuerAnalysisRunStatusResponseDto {
  const semantic = run.semanticAnalyses[0] ?? null;
  const failure = mapFailure(run.status, run.errorCode);

  return {
    analysisRunId: run.id,
    credentialId: run.credentialId,
    status: run.status,
    inputMode: run.inputMode,
    trigger: run.trigger,
    requestedPipelineVersion: run.requestedPipelineVersion,
    requestedTaxonomyVersion: run.requestedTaxonomyVersion,
    sourceCount: run.sources.length,
    sourceTypes: run.sources.map((source) => source.sourceType),
    createdAt: run.createdAt.toISOString(),
    startedAt: toIso(run.startedAt),
    completedAt: toIso(run.completedAt),
    failedAt: toIso(run.failedAt),
    errorCode: failure?.code ?? null,
    errorMessage: failure?.message ?? null,
    semanticAnalysis: semantic
      ? {
          semanticAnalysisId: semantic.id,
          status: semantic.status,
          pipelineVersion: semantic.pipelineVersion,
          taxonomyVersion: semantic.taxonomyVersion,
          confidence: toNullableNumber(semantic.confidence),
          areasCount: toArray(semantic.areas).length,
          skillsCount: toArray(semantic.skills).length,
          conceptsCount: toArray(semantic.concepts).length,
          qualityFlags: toStringArray(semantic.qualityFlags),
          analyzedAt: semantic.analyzedAt.toISOString()
        }
      : null
  };
}

function mapFailure(
  status: AnalysisRunStatus,
  errorCode: string | null
): { code: string; message: string } | null {
  if (status !== AnalysisRunStatus.failed) return null;
  const code =
    errorCode && safeFailureMessages[errorCode]
      ? errorCode
      : 'analysis_failed';
  return { code, message: safeFailureMessages[code] };
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalidReadModel();
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalidReadModel();
  }
  return [...value];
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(
    typeof value === 'object' && value && 'toString' in value
      ? value.toString()
      : value
  );
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw invalidReadModel();
  }
  return numeric;
}

function invalidReadModel(): InternalServerErrorException {
  return new InternalServerErrorException(INVALID_READ_MODEL_MESSAGE);
}
