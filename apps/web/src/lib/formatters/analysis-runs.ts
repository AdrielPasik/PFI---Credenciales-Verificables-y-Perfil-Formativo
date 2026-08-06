import type {
  AnalysisRunInputMode,
  AnalysisRunSourceType,
  AnalysisRunStatus
} from '@/models/analysis-runs';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const confidenceFormatter = new Intl.NumberFormat('es-AR', {
  style: 'percent',
  maximumFractionDigits: 0
});

const statusLabels: Record<AnalysisRunStatus, string> = {
  pending: 'Análisis pendiente',
  running: 'Analizando documento',
  completed: 'Análisis completado',
  failed: 'No se pudo completar el análisis',
  canceled: 'Análisis cancelado'
};

const inputModeLabels: Record<AnalysisRunInputMode, string> = {
  document: 'Documento',
  text: 'Texto',
  combined: 'Documento y texto'
};

const sourceLabels: Record<AnalysisRunSourceType, string> = {
  document_evidence: 'Evidencia documental',
  text_evidence: 'Evidencia textual'
};

const knownQualityFlagLabels: Record<string, string> = {
  low_coverage: 'Cobertura limitada',
  qualitative_only: 'Resultado principalmente cualitativo'
};

export function formatAnalysisRunStatus(status: AnalysisRunStatus) {
  return statusLabels[status];
}

export function formatAnalysisInputMode(inputMode: AnalysisRunInputMode) {
  return inputModeLabels[inputMode];
}

export function formatAnalysisSource(sourceType: AnalysisRunSourceType) {
  return sourceLabels[sourceType];
}

export function formatAnalysisDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function formatAnalysisConfidence(value: number | null) {
  return value === null ? 'No informada' : confidenceFormatter.format(value);
}

export function formatQualityFlag(flag: string) {
  const known = knownQualityFlagLabels[flag];

  if (known) {
    return known;
  }

  const words = flag.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toLocaleUpperCase('es-AR') + words.slice(1);
}

