import { type BackfillSummary } from '../analysis-run-backfill.service';

const BOOLEAN_FLAGS = new Set([
  '--force',
  '--execute',
  '--rebuildProfile',
  '--help'
]);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export interface ReprocessDocumentsArgs {
  help: boolean;
  holderEmail: string | null;
  credentialId: string | null;
  force: boolean;
  execute: boolean;
  rebuildProfile: boolean;
  limit: number;
}

export const REPROCESS_DOCUMENTS_HELP_TEXT = `
Uso: npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- [opciones]

Herramienta interna de backfill/reanalysis para demo. NO es un endpoint
publico. Reanaliza credenciales issued con evidencia documental PDF
vigente, reusando el mismo pipeline que el analisis automatico (storage,
AiServiceClient, SemanticService, AnalysisRunExecutionService).

Selector (exactamente uno es requerido):
  --holderEmail <email>       Credenciales issued del holder exacto.
  --credentialId <id>         Una credencial especifica.

Flags:
  --force                     Permite crear un nuevo run aunque ya exista
                               un AnalysisRun completed para el
                               DocumentEvidence current. Nunca ignora un
                               run pending/running (concurrencia).
  --rebuildProfile            Reconstruye el perfil del holder al final,
                               solo si --execute y hubo al menos una
                               ejecucion exitosa.
  --execute                   Requerido para escribir en la base y llamar
                               al AI Service. Sin --execute: dry-run (no
                               escribe, no llama IA, no reconstruye perfil).
  --limit <n>                 Limite de credenciales a considerar con
                               --holderEmail (default ${DEFAULT_LIMIT}, maximo ${MAX_LIMIT}).
  --help                      Muestra esta ayuda y termina.

Ejemplos:
  npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- \\
    --holderEmail holder.demo@example.com --force --rebuildProfile --execute

  npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- \\
    --credentialId <id> --force --execute
`.trim();

export function parseReprocessDocumentsArgs(
  argv: string[]
): ReprocessDocumentsArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }
    if (BOOLEAN_FLAGS.has(current)) {
      flags.add(current);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Falta valor para el argumento ${current}.`);
    }
    values.set(current, next);
    index += 1;
  }

  if (flags.has('--help')) {
    return {
      help: true,
      holderEmail: null,
      credentialId: null,
      force: false,
      execute: false,
      rebuildProfile: false,
      limit: DEFAULT_LIMIT
    };
  }

  const holderEmail = values.get('--holderEmail')?.trim() || null;
  const credentialId = values.get('--credentialId')?.trim() || null;

  if (Boolean(holderEmail) === Boolean(credentialId)) {
    throw new Error(
      'Debe indicarse exactamente uno de --holderEmail o --credentialId.'
    );
  }

  const limit = parseLimit(values.get('--limit'));

  return {
    help: false,
    holderEmail,
    credentialId,
    force: flags.has('--force'),
    execute: flags.has('--execute'),
    rebuildProfile: flags.has('--rebuildProfile'),
    limit
  };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_LIMIT) {
    throw new Error(`--limit debe ser un entero entre 1 y ${MAX_LIMIT}.`);
  }
  return parsed;
}

export function formatBackfillSummary(summary: BackfillSummary): string {
  return JSON.stringify(summary, null, 2);
}
