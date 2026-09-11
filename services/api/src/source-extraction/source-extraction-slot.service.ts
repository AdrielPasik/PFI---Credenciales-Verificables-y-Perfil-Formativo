/**
 * Repositorio del extraction slot — slice F1.2.
 *
 * Dos operaciones internas, y nada más:
 *
 *     ESCRITURA  persistir exactamente una vez, sobre su AnalysisRunSource, una
 *                extracción que YA pasó F0.4 y el binding autoritativo de F0.5
 *     LECTURA    recuperar el artifact exacto y volver a verificarlo antes de
 *                devolverlo
 *
 * LA PERSISTENCIA ES UN BORDE NO CONFIABLE EN LA LECTURA. Que un artifact haya
 * sido válido al escribirse no dice nada sobre lo que la base devuelve después,
 * así que la lectura repite la verificación completa. F1.2 no repara nada: ni
 * re-normaliza, ni re-extrae, ni sobrescribe.
 *
 * Lo que F1.2 NO hace, deliberadamente: no vuelve a correr F0.5. No relee S3, no
 * relee `TextEvidence.content`, no re-verifica la autoridad de la fuente. El
 * binding se exigió ANTES de escribir; lo que se recupera es la extracción
 * históricamente atada a este `AnalysisRunSource`, y volver a atarla contra el
 * estado actual de la fuente sería otra pregunta.
 */

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { canonicalJson } from './canonical-json';
import {
  SourceExtractionVerificationError,
  verifySourceExtractionArtifact
} from './source-extraction-artifact.verifier';
import { failSlot } from './source-extraction-slot.errors';
import {
  type PersistedVerifiedSourceExtraction,
  type SlotReadOutcome
} from './source-extraction-slot.types';
import {
  type AuthoritativeSourceBoundExtraction,
  type ExtractionDerivationTrust
} from './source-extraction-trust.types';

/** Columnas del slot, tal como viven en `AnalysisRunSource`. */
export interface RawSlot {
  extractionArtifactCanonicalJson: string | null;
  artifactBlobSha256: string | null;
  extractionDerivationTrust: string | null;
}

const SLOT_SELECT = {
  extractionArtifactCanonicalJson: true,
  artifactBlobSha256: true,
  extractionDerivationTrust: true
} as const;

function sha256OfUtf8(value: string): string {
  // El input del hash son los bytes UTF-8 de la cadena canónica EXACTA. No los
  // code units UTF-16 de JavaScript: para cualquier carácter fuera del BMP esos
  // dos conjuntos de bytes difieren.
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

@Injectable()
export class SourceExtractionSlotService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Llena el slot exactamente una vez.
   *
   * El destino se DERIVA del binding, no lo aporta el llamador: una firma que
   * aceptara un id de destino además del binding permitiría expresar dos
   * identidades distintas y habría que reconciliarlas. Un solo argumento portador
   * de autoridad hace que esa discrepancia no sea representable.
   *
   * El input es `AuthoritativeSourceBoundExtraction` y no un artifact suelto,
   * porque F1.2 sólo puede persistir algo que ya pasó F0.4 y el binding de F0.5.
   * El tipo lo hace cumplir; no se reimplementa ninguna de las dos capas.
   */
  public async fillExtractionSlot(
    binding: AuthoritativeSourceBoundExtraction
  ): Promise<PersistedVerifiedSourceExtraction> {
    const analysisRunSourceId = binding.analysisRunSourceId;

    const canonical = canonicalJson(binding.artifact);
    const blobSha256 = sha256OfUtf8(canonical);
    const derivationTrust = binding.extractionDerivationTrust;

    // Compare-and-set: sólo escribe si el slot sigue ABSENT. Es el mismo patrón
    // de claim condicional que `analysis-run-execution.service.ts` usa para
    // pasar un run de `pending` a `running`.
    //
    // Los tres campos van en UNA sola operación: el CHECK de F1.1 protege el
    // bundle a nivel DB, pero un bundle parcial no debe ser alcanzable ni
    // siquiera de forma transitoria desde la aplicación.
    const filled = await this.prisma.analysisRunSource.updateMany({
      where: {
        id: analysisRunSourceId,
        extractionArtifactCanonicalJson: null,
        artifactBlobSha256: null,
        extractionDerivationTrust: null
      },
      data: {
        extractionArtifactCanonicalJson: canonical,
        artifactBlobSha256: blobSha256,
        extractionDerivationTrust: derivationTrust
      }
    });

    if (filled.count === 1) {
      return deepFreeze({
        analysisRunSourceId,
        artifact: binding.artifact,
        extractionDerivationTrust: derivationTrust,
        artifactBlobSha256: blobSha256
      });
    }

    // count === 0 NO significa "el slot ya estaba lleno". Puede ser que la fila
    // no exista, que el bundle esté parcial, o que esté lleno con otra cosa. Se
    // relee de forma autoritativa y se clasifica.
    return this.classifyFailedFill(analysisRunSourceId, canonical, blobSha256, derivationTrust);
  }

  /**
   * Recupera el slot y lo vuelve a verificar por completo.
   *
   * Devuelve un resultado discriminado en vez de lanzar para los dos estados que
   * son respuestas legítimas —fila inexistente y slot ABSENT—, y lanza para los
   * que son corrupción. Un slot ABSENT NO es coverage `FAILED` ni fuente vacía:
   * significa que esta fuente nunca se extrajo, y confundirlo con un resultado de
   * extracción sería exactamente el error que F0 evitó en el otro sentido.
   */
  public async readExtractionSlot(analysisRunSourceId: string): Promise<SlotReadOutcome> {
    const row = await this.prisma.analysisRunSource.findUnique({
      where: { id: analysisRunSourceId },
      select: SLOT_SELECT
    });

    if (!row) {
      return { status: 'SOURCE_NOT_FOUND', analysisRunSourceId };
    }
    if (this.slotIsAbsent(row)) {
      return { status: 'SLOT_ABSENT', analysisRunSourceId };
    }

    return {
      status: 'SLOT_PRESENT',
      analysisRunSourceId,
      extraction: this.verifyPersistedSlot(analysisRunSourceId, row)
    };
  }

  /**
   * Verifica un slot YA LEÍDO, sin tocar la base — slice F3.2.
   *
   * `readExtractionSlot` lee con `this.prisma`, así que no puede participar de
   * una transacción ajena. F3.2 necesita leer sus filas con el cliente de SU
   * transacción serializable y verificarlas ahí adentro, o el inventario quedaría
   * mezclado entre dos estados del dominio.
   *
   * Por eso este método expone la MISMA verificación —blob SHA, parse, F0.4 y
   * canonical-at-rest— sobre columnas que el llamante ya trajo. No duplica nada:
   * delega en la implementación privada que también usa la lectura normal.
   *
   * Devuelve `null` si el slot está ABSENT, que es una respuesta legítima y no un
   * error. Lanza `SourceExtractionSlotError` con código cerrado si está corrupto.
   */
  public verifyReadExtractionSlot(
    analysisRunSourceId: string,
    slot: RawSlot
  ): PersistedVerifiedSourceExtraction | null {
    if (this.slotIsAbsent(slot)) return null;
    return this.verifyPersistedSlot(analysisRunSourceId, slot);
  }

  // -------------------------------------------------------------------------
  // Verificación del slot persistido
  // -------------------------------------------------------------------------

  private slotIsAbsent(slot: RawSlot): boolean {
    return (
      slot.extractionArtifactCanonicalJson === null &&
      slot.artifactBlobSha256 === null &&
      slot.extractionDerivationTrust === null
    );
  }

  /**
   * Orden de verificación: bytes primero, semántica después.
   *
   * Se comprueba el SHA del blob ANTES de parsear, para no confiar en el payload
   * de un blob que ya se sabe alterado.
   */
  private verifyPersistedSlot(
    analysisRunSourceId: string,
    slot: RawSlot
  ): PersistedVerifiedSourceExtraction {
    const { extractionArtifactCanonicalJson, artifactBlobSha256, extractionDerivationTrust } = slot;

    // La migración de F1.1 impide bundles parciales con un CHECK, pero la lectura
    // se defiende igual: mocks, corrupción manual y errores de schema futuros no
    // pasan por ese CHECK. Un bundle parcial se RECHAZA; nunca se trata como ABSENT.
    if (
      extractionArtifactCanonicalJson === null ||
      artifactBlobSha256 === null ||
      extractionDerivationTrust === null
    ) {
      failSlot('EXTRACTION_SLOT_INCONSISTENT', {
        invariant: 'extraction_slot_is_partially_populated',
        analysisRunSourceId,
        presentFields: Object.entries(slot)
          .filter(([, value]) => value !== null)
          .map(([key]) => key)
      });
    }

    if (sha256OfUtf8(extractionArtifactCanonicalJson) !== artifactBlobSha256) {
      failSlot('ARTIFACT_BLOB_SHA_MISMATCH', {
        invariant: 'recomputed_blob_sha_does_not_match_stored_witness',
        analysisRunSourceId
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractionArtifactCanonicalJson);
    } catch {
      failSlot('ARTIFACT_BLOB_JSON_INVALID', {
        invariant: 'stored_blob_is_not_valid_json',
        analysisRunSourceId
      });
    }

    // F0.4 otra vez, completo. Que haya sido válido al escribirse no dice nada
    // sobre lo que la base devuelve ahora.
    let artifact;
    try {
      artifact = verifySourceExtractionArtifact(parsed);
    } catch (error) {
      if (error instanceof SourceExtractionVerificationError) {
        failSlot('ARTIFACT_VERIFICATION_FAILED', {
          invariant: `f0_4_verification_failed:${error.code}`,
          analysisRunSourceId
        });
      }
      throw error;
    }

    // CANONICAL-AT-REST. `extractionArtifactCanonicalJson` no significa "JSON
    // válido que representa un artifact válido": significa la serialización
    // MINIMAL_DETERMINISTIC_JSON_V1 EXACTA del artifact verificado. Un JSON
    // semánticamente equivalente pero con otro orden de claves, otro escaping o
    // whitespace insignificante pasa el SHA de blob (si lo recalcularon) y pasa
    // F0.4, y aun así no es lo que se persistió por contrato.
    //
    // Se rechaza; NO se reemplaza en silencio por la forma canónica.
    if (canonicalJson(artifact) !== extractionArtifactCanonicalJson) {
      failSlot('ARTIFACT_CANONICAL_BLOB_MISMATCH', {
        invariant: 'stored_blob_is_not_the_canonical_serialization',
        analysisRunSourceId
      });
    }

    return deepFreeze({
      analysisRunSourceId,
      artifact,
      // Se devuelve el valor PERSISTIDO, no se vuelve a inferir desde
      // `sourceType`. Es una afirmación histórica congelada: re-derivarla podría
      // actualizar retroactivamente algo que nunca se estableció.
      extractionDerivationTrust: extractionDerivationTrust as ExtractionDerivationTrust,
      artifactBlobSha256
    });
  }

  // -------------------------------------------------------------------------
  // Clasificación de un compare-and-set perdido
  // -------------------------------------------------------------------------

  private async classifyFailedFill(
    analysisRunSourceId: string,
    canonical: string,
    blobSha256: string,
    derivationTrust: ExtractionDerivationTrust
  ): Promise<PersistedVerifiedSourceExtraction> {
    const row = await this.prisma.analysisRunSource.findUnique({
      where: { id: analysisRunSourceId },
      select: SLOT_SELECT
    });

    if (!row) {
      failSlot('ANALYSIS_RUN_SOURCE_NOT_FOUND', {
        invariant: 'analysis_run_source_does_not_exist',
        analysisRunSourceId
      });
    }

    if (this.slotIsAbsent(row)) {
      // El slot sigue ABSENT y aun así el CAS no escribió. No es un estado que
      // esta capa pueda explicar, y adivinar sería peor que fallar.
      failSlot('EXTRACTION_SLOT_INCONSISTENT', {
        invariant: 'conditional_fill_did_not_apply_on_an_absent_slot',
        analysisRunSourceId
      });
    }

    // El slot existente sólo puede considerarse un estado válido con el cual
    // converger si atraviesa la MISMA lectura segura: blob SHA, parse, F0.4 y
    // canonical-at-rest. Comparar columnas crudas no alcanzaría.
    const persisted = this.verifyPersistedSlot(analysisRunSourceId, row);

    const sameBundle =
      row.extractionArtifactCanonicalJson === canonical &&
      row.artifactBlobSha256 === blobSha256 &&
      row.extractionDerivationTrust === derivationTrust;

    if (sameBundle) {
      // Convergencia idempotente. NO viola MONOTONIC_FILL_ONCE: el estado PRESENT
      // nunca se reescribió, y el reintento simplemente encontró su propio
      // resultado ya escrito. Cero escrituras.
      return persisted;
    }

    // Distinto bundle. Se rechaza sin escribir: nada de last-write-wins, nada de
    // reintentos. Una extracción distinta de la misma fuente pertenece a otro
    // AnalysisRun, no a una mutación de éste.
    failSlot('EXTRACTION_SLOT_CONFLICT', {
      invariant: 'slot_already_filled_with_a_different_bundle',
      analysisRunSourceId
    });
  }
}
