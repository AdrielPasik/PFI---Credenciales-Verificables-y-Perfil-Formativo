import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SourceExtractionOrchestrationService } from '../source-extraction/source-extraction-orchestration.service';

/**
 * Backfill del slot de extraccion F1 sobre filas `AnalysisRunSource` YA EXISTENTES.
 *
 * POR QUE EXISTE. F1.6 conecto la extraccion al lifecycle de analisis semantico
 * como best-effort NO BLOQUEANTE: si fallaba, el run igual completaba y el slot
 * quedaba ABSENT. El propio F1.6 dejo escrito que no ofrecia mecanismo de
 * reintento y que "una capa futura podra volver a invocarlo antes de necesitar
 * esa evidencia". Esta es esa capa.
 *
 * La necesidad es concreta: F3.2 congela el inventario de un ReasoningRun y una
 * fuente sin slot se clasifica `BLOCKED_EXTRACTION_UNAVAILABLE`, lo que hace
 * nacer el run `failed`. Credenciales emitidas antes de F1 tienen evidencia
 * perfectamente valida y ningun slot.
 *
 * NO DUPLICA NADA. No extrae, no canonicaliza, no hashea, no calcula trust y no
 * escribe las columnas del slot. Todo eso pasa dentro de
 * `ensureExtractionForAnalysisRunSource`, que ya es source-bound, fill-once y
 * idempotente. Este servicio solo decide QUE filas son elegibles y las pasa.
 *
 * NO TOCA EL ANALISIS SEMANTICO. No crea `AnalysisRun`, ni `SemanticAnalysis`,
 * ni `ReasoningRun`; no reconstruye perfiles y no llama a ningun modelo. La
 * extraccion en si es determinista.
 *
 * NO ES UN ENDPOINT. No se registra en ningun controller: es herramienta de
 * operador, no capacidad de producto, y no debe poder dispararse por HTTP.
 */

/** Estado del slot leido antes de decidir. Deriva de los TRES campos juntos. */
export type ExtractionSlotState = 'EMPTY' | 'COMPLETE' | 'PARTIAL';

export type SourceExtractionBackfillOutcome =
  /** La fila pedida no existe. Precondicion incumplida. */
  | 'NOT_FOUND'
  /** Slot vacio y elegible; en dry-run no se toca. */
  | 'DRY_RUN_ELIGIBLE'
  /** Slot ya completo. No se invoca la extraccion: es fill-once. */
  | 'ALREADY_COMPLETE'
  /** Bundle a medias. Se para: no se repara ni se completa por encima. */
  | 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED'
  | 'EXTRACTION_COMPLETED'
  | 'EXTRACTION_FAILED';

export interface SourceExtractionBackfillRow {
  readonly analysisRunSourceId: string;
  readonly outcome: SourceExtractionBackfillOutcome;
  /** `null` si la fila no existe. Metadato seguro: nunca contenido. */
  readonly sourceType: string | null;
  readonly slotState: ExtractionSlotState | null;
  /** Solo tras una extraccion exitosa. Es una clasificacion, no un dato del holder. */
  readonly extractionDerivationTrust?: string;
  /**
   * Solo en `EXTRACTION_FAILED`, y solo el NOMBRE de la clase de error.
   * Nunca el mensaje: puede llevar invariantes con ids, y no se necesita para
   * decidir. El detalle vive en el log del proceso, no en el resumen.
   */
  readonly failureName?: string;
}

export interface SourceExtractionBackfillSummary {
  readonly execute: boolean;
  /** `true` si se aborto en la fase de inspeccion, sin extraer nada. */
  readonly abortedBeforeExecution: boolean;
  readonly rows: readonly SourceExtractionBackfillRow[];
}

const SLOT_SELECT = {
  id: true,
  sourceType: true,
  extractionArtifactCanonicalJson: true,
  artifactBlobSha256: true,
  extractionDerivationTrust: true
} as const;

interface SlotRow {
  id: string;
  sourceType: string;
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
}

export function readSlotState(row: {
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
}): ExtractionSlotState {
  const present = [
    row.extractionArtifactCanonicalJson,
    row.artifactBlobSha256,
    row.extractionDerivationTrust
  ].filter((value) => value !== null).length;

  if (present === 0) return 'EMPTY';
  if (present === 3) return 'COMPLETE';
  // El CHECK de F1.1 protege el bundle a nivel DB, asi que esto no deberia
  // existir. Si existe, es un hecho que hay que mirar, no uno que tapar.
  return 'PARTIAL';
}

@Injectable()
export class SourceExtractionBackfillService {
  private readonly logger = new Logger(SourceExtractionBackfillService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly sourceExtraction: SourceExtractionOrchestrationService
  ) {}

  /**
   * DOS FASES, y la separacion es la garantia principal.
   *
   *   1. INSPECCION. Se leen TODAS las filas pedidas y se clasifican. Si alguna
   *      no existe o tiene el bundle a medias, se aborta ACA: no se extrae ni
   *      una sola, y no se escribio nada. Fail-closed sobre el conjunto, no
   *      fila por fila — el operador nombro esas filas juntas y una precondicion
   *      rota pone en duda la premisa de la operacion entera.
   *
   *   2. EJECUCION, solo con `execute`. Se extrae unicamente lo `EMPTY`. Un
   *      fallo corta el bucle: las filas restantes no se intentan. Lo ya
   *      persistido queda —cada slot es su propia transaccion— y eso es
   *      correcto: una extraccion valida no se revierte porque otra falle.
   */
  public async run(
    analysisRunSourceIds: readonly string[],
    options: { execute: boolean }
  ): Promise<SourceExtractionBackfillSummary> {
    const inspected = await this.inspect(analysisRunSourceIds);

    const blocking = inspected.filter(
      (row) =>
        row.outcome === 'NOT_FOUND' ||
        row.outcome === 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED'
    );

    if (blocking.length > 0 || !options.execute) {
      return {
        execute: options.execute,
        abortedBeforeExecution: blocking.length > 0,
        rows: inspected
      };
    }

    return {
      execute: true,
      abortedBeforeExecution: false,
      rows: await this.execute(inspected)
    };
  }

  // -------------------------------------------------------------------------
  // Fase 1 — solo lectura
  // -------------------------------------------------------------------------

  private async inspect(
    analysisRunSourceIds: readonly string[]
  ): Promise<SourceExtractionBackfillRow[]> {
    const found = (await this.prisma.analysisRunSource.findMany({
      where: { id: { in: [...analysisRunSourceIds] } },
      select: SLOT_SELECT
    })) as SlotRow[];

    const byId = new Map(found.map((row) => [row.id, row]));

    // Se recorre el orden que dio el operador, no el que devolvio la base: el
    // resumen tiene que leerse contra la lista que se escribio.
    return analysisRunSourceIds.map((analysisRunSourceId) => {
      const row = byId.get(analysisRunSourceId);
      if (!row) {
        return { analysisRunSourceId, outcome: 'NOT_FOUND' as const, sourceType: null, slotState: null };
      }

      const slotState = readSlotState(row);
      const outcome: SourceExtractionBackfillOutcome =
        slotState === 'EMPTY'
          ? 'DRY_RUN_ELIGIBLE'
          : slotState === 'COMPLETE'
            ? 'ALREADY_COMPLETE'
            : 'PARTIAL_SLOT_INTEGRITY_REVIEW_REQUIRED';

      return { analysisRunSourceId, outcome, sourceType: row.sourceType, slotState };
    });
  }

  // -------------------------------------------------------------------------
  // Fase 2 — la unica que escribe, y no escribe ella
  // -------------------------------------------------------------------------

  private async execute(
    inspected: readonly SourceExtractionBackfillRow[]
  ): Promise<SourceExtractionBackfillRow[]> {
    const rows: SourceExtractionBackfillRow[] = [];
    let stopped = false;

    for (const row of inspected) {
      if (stopped || row.outcome !== 'DRY_RUN_ELIGIBLE') {
        rows.push(row);
        continue;
      }

      try {
        const persisted = await this.sourceExtraction.ensureExtractionForAnalysisRunSource(
          row.analysisRunSourceId
        );
        this.logger.log(
          `extraction_backfill_filled analysisRunSourceId=${row.analysisRunSourceId} ` +
            `coverage=${persisted.artifact.coverageStatus} ` +
            `trust=${persisted.extractionDerivationTrust}`
        );
        rows.push({
          ...row,
          outcome: 'EXTRACTION_COMPLETED',
          extractionDerivationTrust: persisted.extractionDerivationTrust
        });
      } catch (error: unknown) {
        // Se registra la clase, no el mensaje: los invariantes del pipeline
        // llevan ids internos y no hacen falta para decidir que hacer.
        const failureName = error instanceof Error ? error.name : 'UnknownError';
        this.logger.error(
          `extraction_backfill_failed analysisRunSourceId=${row.analysisRunSourceId} ` +
            `failure=${failureName}`
        );
        rows.push({ ...row, outcome: 'EXTRACTION_FAILED', failureName });
        stopped = true;
      }
    }

    return rows;
  }
}
