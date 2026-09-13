import {
  type SourceExtractionBackfillSummary
} from '../source-extraction-backfill.service';

/**
 * Argumentos y salida del backfill de slots de extraccion F1.
 *
 * Todo lo de este archivo es PURO: se prueba sin base, sin Nest y sin red.
 */

const BOOLEAN_FLAGS = new Set(['--execute', '--help']);

/**
 * UUID v4 en minuscula o mayuscula. El repositorio usa `@default(uuid())` de
 * Prisma, asi que aceptar cualquier string permitiria pasar un id de otra
 * entidad por error y recibir un `NOT_FOUND` confuso en vez de un rechazo claro.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BackfillSourceExtractionArgs {
  help: boolean;
  execute: boolean;
  /** Deduplicados, en el orden en que el operador los escribio. */
  analysisRunSourceIds: string[];
}

export const BACKFILL_SOURCE_EXTRACTION_HELP_TEXT = `
Uso: npm run analysis:backfill:source-extraction --workspace @credential-intelligence/api -- <analysisRunSourceId...> [--execute]

Herramienta de OPERADOR. Llena el slot de extraccion F1 de filas
AnalysisRunSource que YA EXISTEN y lo tienen vacio. Reusa la orquestacion
productiva (SourceExtractionOrchestrationService): no extrae por su cuenta,
no calcula hashes, no calcula trust y no escribe las columnas del slot.

NO reanaliza. No crea AnalysisRun, SemanticAnalysis ni ReasoningRun, no
reconstruye perfiles y no llama a ningun modelo de lenguaje. La extraccion en
si es deterministica.

Sirve para credenciales emitidas antes de F1, cuya evidencia es valida pero
nunca tuvo extraccion persistida, y que por eso bloquean el congelamiento de
inventario de un ReasoningRun.

Argumentos:
  <analysisRunSourceId...>    Uno o mas ids EXPLICITOS. No hay descubrimiento
                               automatico: el operador elige las filas.

Flags:
  --execute                   Requerido para escribir. Sin este flag es
                               DRY-RUN: inspecciona, clasifica y no toca nada.
  --help                      Muestra esta ayuda y termina.

Precondiciones por fila:
  slot vacio      -> elegible
  slot completo   -> ALREADY_COMPLETE, no se toca (es fill-once)
  slot a medias   -> PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED, se ABORTA todo
  fila inexistente-> NOT_FOUND, se ABORTA todo

Si alguna fila no existe o tiene el bundle a medias, no se extrae NINGUNA.

Ejemplos:
  npm run analysis:backfill:source-extraction --workspace @credential-intelligence/api -- \\
    11111111-1111-4111-8111-111111111111

  npm run analysis:backfill:source-extraction --workspace @credential-intelligence/api -- \\
    11111111-1111-4111-8111-111111111111 22222222-2222-4222-8222-222222222222 --execute
`.trim();

export function parseBackfillSourceExtractionArgs(
  argv: string[]
): BackfillSourceExtractionArgs {
  const flags = new Set<string>();
  const ids: string[] = [];

  for (const current of argv) {
    if (current.startsWith('--')) {
      if (!BOOLEAN_FLAGS.has(current)) {
        throw new Error(`Argumento desconocido: ${current}.`);
      }
      flags.add(current);
      continue;
    }
    if (!UUID_PATTERN.test(current)) {
      throw new Error(`No es un analysisRunSourceId valido: ${current}.`);
    }
    // Deduplicado conservando la primera aparicion: repetir un id no puede
    // convertirse en dos intentos sobre la misma fila.
    if (!ids.includes(current)) ids.push(current);
  }

  const help = flags.has('--help');
  if (!help && ids.length === 0) {
    throw new Error('Hace falta al menos un analysisRunSourceId.');
  }

  return { help, execute: flags.has('--execute'), analysisRunSourceIds: ids };
}

/**
 * Codigos de salida. El fallo NO se esconde detras de un log: un operador que
 * encadene comandos tiene que poder cortar.
 */
export const BACKFILL_EXIT = {
  OK: 0,
  INVALID_ARGUMENTS: 1,
  PRECONDITION_FAILED: 2,
  EXTRACTION_FAILED: 3
} as const;

export function backfillExitCode(summary: SourceExtractionBackfillSummary): number {
  if (summary.rows.some((row) => row.outcome === 'EXTRACTION_FAILED')) {
    return BACKFILL_EXIT.EXTRACTION_FAILED;
  }
  if (
    summary.rows.some(
      (row) =>
        row.outcome === 'NOT_FOUND' ||
        row.outcome === 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED'
    )
  ) {
    return BACKFILL_EXIT.PRECONDITION_FAILED;
  }
  return BACKFILL_EXIT.OK;
}

/** Resumen de texto. Solo ids internos y clasificaciones cerradas. */
export function formatBackfillSourceExtractionSummary(
  summary: SourceExtractionBackfillSummary
): string {
  const lines = [
    summary.execute
      ? 'Backfill de extraccion F1 — EJECUCION'
      : 'Backfill de extraccion F1 — DRY-RUN (no se escribio nada)'
  ];

  if (summary.abortedBeforeExecution) {
    lines.push(
      'ABORTADO en la inspeccion: alguna fila no existe o tiene el bundle a medias.',
      'No se intento ninguna extraccion.'
    );
  }

  lines.push('');
  for (const row of summary.rows) {
    const parts = [
      row.analysisRunSourceId,
      row.outcome,
      `sourceType=${row.sourceType ?? '-'}`,
      `slot=${row.slotState ?? '-'}`
    ];
    if (row.extractionDerivationTrust) parts.push(`trust=${row.extractionDerivationTrust}`);
    if (row.failureName) parts.push(`failure=${row.failureName}`);
    lines.push(`  ${parts.join('  ')}`);
  }

  const count = (outcome: string) =>
    summary.rows.filter((row) => row.outcome === outcome).length;

  lines.push(
    '',
    `total=${summary.rows.length}` +
      `  elegibles=${count('DRY_RUN_ELIGIBLE')}` +
      `  completadas=${count('EXTRACTION_COMPLETED')}` +
      `  ya_completas=${count('ALREADY_COMPLETE')}` +
      `  parciales=${count('PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED')}` +
      `  inexistentes=${count('NOT_FOUND')}` +
      `  fallidas=${count('EXTRACTION_FAILED')}`
  );

  if (!summary.execute && count('DRY_RUN_ELIGIBLE') > 0) {
    lines.push('', 'Para escribir, repetir el mismo comando con --execute.');
  }

  return lines.join('\n');
}
