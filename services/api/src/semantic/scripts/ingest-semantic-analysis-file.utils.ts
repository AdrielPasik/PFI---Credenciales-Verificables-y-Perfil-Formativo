import { type SemanticAnalysis } from '@prisma/client';

export interface SemanticIngestFileArgs {
  credentialId: string;
  filePath: string;
}

export function parseSemanticIngestFileArgs(
  argv: string[]
): SemanticIngestFileArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Falta valor para el argumento ${current}.`);
    }

    args.set(current, next);
    index += 1;
  }

  const credentialId = args.get('--credentialId')?.trim();
  const filePath = args.get('--file')?.trim();

  if (!credentialId) {
    throw new Error('Debe enviarse --credentialId <credential-id>.');
  }

  if (!filePath) {
    throw new Error('Debe enviarse --file <path-to-semantic-analysis-v1-json>.');
  }

  return {
    credentialId,
    filePath
  };
}

export function formatPersistedSemanticAnalysisSummary(
  semanticAnalysis: Pick<
    SemanticAnalysis,
    | 'id'
    | 'credentialId'
    | 'schemaVersion'
    | 'status'
    | 'pipelineVersion'
    | 'taxonomyVersion'
    | 'confidence'
    | 'analyzedAt'
  >
): string {
  return JSON.stringify(
    {
      id: semanticAnalysis.id,
      credentialId: semanticAnalysis.credentialId,
      schemaVersion: semanticAnalysis.schemaVersion,
      status: semanticAnalysis.status,
      pipelineVersion: semanticAnalysis.pipelineVersion,
      taxonomyVersion: semanticAnalysis.taxonomyVersion,
      confidence: formatConfidenceValue(semanticAnalysis.confidence),
      analyzedAt: semanticAnalysis.analyzedAt.toISOString()
    },
    null,
    2
  );
}

function formatConfidenceValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return value;
}
