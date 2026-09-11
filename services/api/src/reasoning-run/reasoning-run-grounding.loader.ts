/**
 * Carga y verificación del grounding set congelado — extraído en F3.5.
 *
 * F3.4 lo necesitaba para construir el catálogo; F3.5 lo necesita para
 * reverificarlo antes de razonar. Tener dos copias de este camino sería peor que
 * una abstracción: es la comprobación de que el universo de evidencia sigue
 * siendo el que el run congeló, y dos implementaciones que se separan en silencio
 * dejarían una de las dos etapas verificando menos.
 *
 * QUÉ VERIFICA, por cada item `INCLUDED` del inventario:
 *
 *     el binding congelado está completo
 *     el `AnalysisRunSource` seleccionado sigue existiendo
 *     su slot de extracción está PRESENTE
 *     el `source_extraction_v1` persistido supera el verificador de F0
 *     `artifactBlobSha256` sigue coincidiendo con el congelado
 *     `sourceSha256` sigue coincidiendo con el congelado
 *
 * NO reselecciona fuente, no llama a la orquestación de extracción, no genera una
 * extracción nueva y no toca la disposición del inventario. El run ya congeló su
 * representación; elegir otra sería evaluar contra un universo distinto del que
 * quedó registrado.
 *
 * Lanza un error NEUTRO: cada etapa decide con qué `failureCode` marca el run,
 * porque el hecho es el mismo pero la etapa que lo descubrió no.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import { type VerifiedSourceExtractionArtifact } from '../source-extraction/source-extraction-artifact.types';

const INCLUDED = 'INCLUDED';

const INVENTORY_SELECT = {
  disposition: true,
  runLocalSourceId: true,
  sourceSha256: true,
  selectedAnalysisRunSourceId: true,
  artifactBlobSha256: true
} as const;

const EXTRACTION_SLOT_SELECT = {
  extractionArtifactCanonicalJson: true,
  artifactBlobSha256: true,
  extractionDerivationTrust: true
} as const;

/** Una fuente INCLUIDA con su extracción ya verificada. */
export interface GroundedSource {
  readonly runLocalSourceId: string;
  readonly sourceSha256: string;
  readonly artifact: VerifiedSourceExtractionArtifact;
}

/**
 * El grounding congelado ya no es utilizable.
 *
 * No lleva `failureCode`: el código de fallo del run es una decisión de la etapa
 * que lo descubrió, no de este cargador.
 */
export class GroundingUnusableError extends Error {
  public constructor(
    public readonly invariant: string,
    public readonly runLocalSourceId?: string
  ) {
    super(invariant);
    this.name = 'GroundingUnusableError';
  }
}

@Injectable()
export class ReasoningRunGroundingLoader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly extractionSlots: SourceExtractionSlotService
  ) {}

  /**
   * Carga y verifica TODAS las fuentes INCLUIDAS del run.
   *
   * Se ordena por `runLocalSourceId` para que el conjunto sea determinista: el
   * orden accidental de Prisma no puede decidir en qué orden ve el modelo las
   * fuentes.
   */
  public async loadVerifiedGroundingSet(
    reasoningRunId: string
  ): Promise<readonly GroundedSource[]> {
    const inventory = await this.prisma.reasoningRunInventoryItem.findMany({
      where: { reasoningRunId, disposition: INCLUDED as never },
      select: INVENTORY_SELECT,
      orderBy: { runLocalSourceId: 'asc' }
    });

    const grounded: GroundedSource[] = [];
    for (const item of inventory) {
      const runLocalSourceId = item.runLocalSourceId;
      if (
        runLocalSourceId === null ||
        item.sourceSha256 === null ||
        item.selectedAnalysisRunSourceId === null ||
        item.artifactBlobSha256 === null
      ) {
        throw new GroundingUnusableError(
          'included_inventory_item_must_carry_its_binding_fields',
          runLocalSourceId ?? undefined
        );
      }

      grounded.push({
        runLocalSourceId,
        sourceSha256: item.sourceSha256,
        artifact: await this.loadVerifiedExtraction(
          runLocalSourceId,
          item.selectedAnalysisRunSourceId,
          item.artifactBlobSha256,
          item.sourceSha256
        )
      });
    }
    return grounded;
  }

  private async loadVerifiedExtraction(
    runLocalSourceId: string,
    selectedAnalysisRunSourceId: string,
    frozenArtifactBlobSha256: string,
    frozenSourceSha256: string
  ): Promise<VerifiedSourceExtractionArtifact> {
    const row = await this.prisma.analysisRunSource.findUnique({
      where: { id: selectedAnalysisRunSourceId },
      select: EXTRACTION_SLOT_SELECT
    });
    if (!row) {
      throw new GroundingUnusableError(
        'frozen_selected_analysis_run_source_no_longer_exists',
        runLocalSourceId
      );
    }

    let persisted;
    try {
      persisted = this.extractionSlots.verifyReadExtractionSlot(
        selectedAnalysisRunSourceId,
        row
      );
    } catch {
      // Se pierde el error interno a propósito: puede llevar detalle del
      // artifact, y el llamante sólo necesita saber QUÉ fuente no sirve.
      throw new GroundingUnusableError(
        'persisted_source_extraction_no_longer_verifies',
        runLocalSourceId
      );
    }

    if (persisted === null) {
      throw new GroundingUnusableError(
        'frozen_extraction_slot_is_absent',
        runLocalSourceId
      );
    }
    if (persisted.artifactBlobSha256 !== frozenArtifactBlobSha256) {
      throw new GroundingUnusableError(
        'artifact_blob_sha_no_longer_matches_the_frozen_binding',
        runLocalSourceId
      );
    }
    if (persisted.artifact.source.sourceSha256 !== frozenSourceSha256) {
      throw new GroundingUnusableError(
        'source_sha_no_longer_matches_the_frozen_binding',
        runLocalSourceId
      );
    }

    return persisted.artifact;
  }
}
