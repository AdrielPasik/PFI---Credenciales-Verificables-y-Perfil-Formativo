/**
 * Trust gate de source extraction — slice F0.5.
 *
 * LA PREGUNTA CAMBIA RESPECTO DE F0.4::
 *
 *     F0.4  "¿este artifact es internamente válido y fiel al contrato?"
 *     F0.5  "¿este artifact válido está atado a la fuente autoritativa que
 *            este AnalysisRun congeló?"
 *
 * LA CADENA DE AUTORIDAD, siempre en este sentido::
 *
 *     AnalysisRunSource            <- raíz de autoridad
 *       -> entidad fuente autoritativa (DocumentEvidence / TextEvidence)
 *         -> material autoritativo (bytes de storage / content persistido)
 *           -> verificación de SHA
 *             -> binding
 *
 * Nada de lo que trae el artifact decide QUÉ se lee. Ni su id de fuente, ni su
 * `storageKey`, ni su `sourceType`. Esos campos sólo se COMPARAN contra lo que
 * ya se leyó de forma autoritativa. Al revés sería el defecto clásico: el
 * llamador aporta la identidad del artifact y también la "autoridad" con la que
 * se lo compara.
 *
 * LÍMITE DE LA GARANTÍA, dicho sin rodeos.
 *
 * Para `TEXT`, el contenido autoritativo ES el texto canónico, así que la
 * igualdad se comprueba de verdad. Para `PDF_DOCUMENT`, F0.5 verifica que los
 * bytes autoritativos son los congelados, pero **no reejecuta pdfplumber ni
 * pypdf**, así que NO prueba de forma independiente que `pages[].canonicalText`
 * provenga de esos bytes bajo la `extractionIdentity` declarada. Eso descansa en
 * el productor de extracción como servicio interno de cómputo:
 *
 *     PDF_EXTRACTION_DERIVATION_INDEPENDENTLY_VERIFIED:  NO
 *     PDF_EXTRACTION_PRODUCER_TRUST:  EXPLICIT_ARCHITECTURAL_ASSUMPTION
 *
 * F0.5 NO es una defensa contra un productor FastAPI malicioso, y no debe
 * presentarse como tal. Un artifact PDF internamente válido y correctamente
 * atado a la fuente sigue siendo, en cuanto a derivación,
 * `SOURCE_BOUND_BUT_DERIVATION_NOT_INDEPENDENTLY_PROVEN`. Hay un test
 * adversarial que lo demuestra en vez de dejarlo como nota al pie.
 *
 * Además, F0.5 todavía no tiene wiring de orquestación, así que la PROCEDENCIA
 * del artifact no puede comprobarse operacionalmente::
 *
 *     PDF_PRODUCER_PROVENANCE_ENFORCED_IN_F0_5:                    NO
 *     PDF_PRODUCER_PROVENANCE_REQUIRED_BEFORE_REASONING_INTEGRATION: YES
 */

import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  DOCUMENT_STORAGE_PORT,
  type DocumentStoragePort
} from '../document-evidence/document-storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { isProductNormalizedText } from '../text-evidence/product-text-normalization';
import { verifySourceExtractionArtifact } from './source-extraction-artifact.verifier';
import { failTrust } from './source-extraction-trust.errors';
import { type AuthoritativeSourceBoundExtraction } from './source-extraction-trust.types';

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export interface TrustSourceExtractionInput {
  /** Raíz de autoridad. NO se acepta metadata de fuente del llamador. */
  analysisRunSourceId: string;
  /** Artifact sin verificar. Pasa por F0.4 antes de tocar nada de dominio. */
  artifact: unknown;
}

function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Comparación de SHA con la convención de dominio ya existente (`toLowerCase`). */
function sameSha(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
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
export class SourceExtractionTrustGateService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_STORAGE_PORT)
    private readonly storage: DocumentStoragePort
  ) {}

  /**
   * Ata un artifact no confiable a la fuente autoritativa de un
   * `AnalysisRunSource`.
   *
   * Levanta `SourceExtractionVerificationError` si el artifact no es
   * internamente válido (F0.4), o `SourceExtractionTrustError` si lo es pero no
   * corresponde a la fuente autoritativa. Nunca devuelve un binding parcial.
   */
  public async trustSourceExtractionForAnalysisRunSource(
    input: TrustSourceExtractionInput
  ): Promise<AuthoritativeSourceBoundExtraction> {
    // 1. F0.4 SIEMPRE primero. Un artifact que miente sobre sí mismo se rechaza
    //    antes de tocar el dominio, y sólo el snapshot verificado —desacoplado y
    //    profundamente congelado— sigue adelante.
    const artifact = verifySourceExtractionArtifact(input.artifact);

    // 2. Autoridad. Se carga por el id pedido, y de acá sale TODO lo demás.
    const source = await this.prisma.analysisRunSource.findUnique({
      where: { id: input.analysisRunSourceId },
      select: {
        id: true,
        analysisRunId: true,
        sourceType: true,
        documentEvidenceId: true,
        textEvidenceId: true,
        sourceSha256: true,
        documentEvidence: { select: { id: true, sha256: true, storageKey: true } },
        textEvidence: { select: { id: true, content: true, sha256: true } }
      }
    });

    if (!source) {
      failTrust('ANALYSIS_RUN_SOURCE_NOT_FOUND', {
        invariant: 'analysis_run_source_does_not_exist',
        analysisRunSourceId: input.analysisRunSourceId
      });
    }

    const base = {
      invariant: '',
      analysisRunSourceId: source.id,
      analysisRunId: source.analysisRunId
    };

    if (!SHA256_HEX.test(source.sourceSha256)) {
      failTrust('ANALYSIS_RUN_SOURCE_INVALID', {
        ...base,
        invariant: 'frozen_source_sha256_is_not_hex'
      });
    }

    // XOR productivo: exactamente una de las dos referencias.
    const hasDocument = source.documentEvidenceId !== null;
    const hasText = source.textEvidenceId !== null;
    if (hasDocument === hasText) {
      failTrust('ANALYSIS_RUN_SOURCE_INVALID', {
        ...base,
        invariant: 'analysis_run_source_must_reference_exactly_one_entity'
      });
    }

    if (hasDocument) {
      return this.bindDocumentSource(source, artifact);
    }
    return this.bindTextSource(source, artifact);
  }

  // -------------------------------------------------------------------------
  // PDF_DOCUMENT
  // -------------------------------------------------------------------------

  private async bindDocumentSource(
    source: {
      id: string;
      analysisRunId: string;
      documentEvidenceId: string | null;
      sourceSha256: string;
      documentEvidence: { id: string; sha256: string; storageKey: string } | null;
    },
    artifact: ReturnType<typeof verifySourceExtractionArtifact>
  ): Promise<AuthoritativeSourceBoundExtraction> {
    const base = {
      invariant: '',
      analysisRunSourceId: source.id,
      analysisRunId: source.analysisRunId,
      sourceType: 'PDF_DOCUMENT'
    };

    // El tipo lo decide la AUTORIDAD, no el artifact.
    if (artifact.sourceType !== 'PDF_DOCUMENT') {
      failTrust('SOURCE_TYPE_MISMATCH', {
        ...base,
        invariant: 'authority_declares_document_evidence_but_artifact_is_text'
      });
    }

    const document = source.documentEvidence;
    if (!document) {
      failTrust('SOURCE_ENTITY_NOT_FOUND', {
        ...base,
        invariant: 'document_evidence_does_not_exist',
        sourceEntityId: source.documentEvidenceId ?? undefined
      });
    }

    const detail = { ...base, sourceEntityId: document.id };

    if (artifact.source.documentEvidenceId !== document.id) {
      failTrust('SOURCE_ENTITY_MISMATCH', {
        ...detail,
        invariant: 'artifact_document_evidence_id_is_not_authoritative'
      });
    }
    if (!sameSha(artifact.source.sourceSha256, source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'artifact_sha_does_not_match_frozen_run_sha'
      });
    }
    if (!sameSha(document.sha256, source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'document_evidence_sha_does_not_match_frozen_run_sha'
      });
    }
    if (artifact.source.storageKey !== document.storageKey) {
      failTrust('SOURCE_STORAGE_MISMATCH', {
        ...detail,
        invariant: 'artifact_storage_key_is_not_authoritative'
      });
    }

    // Se lee SIEMPRE por el storageKey AUTORITATIVO, nunca por el del artifact.
    // Que ambos coincidan ya se comprobó arriba; usar el del artifact igual
    // sería darle al llamador la última palabra sobre qué se lee.
    let bytes: Buffer;
    try {
      bytes = await this.storage.readDocument(document.storageKey);
    } catch {
      // La infraestructura ausente NO se convierte en un artifact `FAILED`: sin
      // poder establecer la autoridad de la fuente, no hay binding.
      failTrust('SOURCE_READ_FAILED', {
        ...detail,
        invariant: 'authoritative_document_bytes_could_not_be_read'
      });
    }

    if (!sameSha(sha256Of(bytes), source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'authoritative_bytes_sha_does_not_match_frozen_run_sha'
      });
    }

    return deepFreeze({
      analysisRunId: source.analysisRunId,
      analysisRunSourceId: source.id,
      sourceType: 'PDF_DOCUMENT' as const,
      sourceEntityId: document.id,
      sourceSha256: source.sourceSha256,
      extractionIdentity: artifact.extractionIdentity,
      // NestJS no reejecutó la extracción: la derivación queda asumida.
      extractionDerivationTrust: 'PRODUCER_ASSUMED' as const,
      artifact
    });
  }

  // -------------------------------------------------------------------------
  // TEXT
  // -------------------------------------------------------------------------

  private async bindTextSource(
    source: {
      id: string;
      analysisRunId: string;
      textEvidenceId: string | null;
      sourceSha256: string;
      textEvidence: { id: string; content: string; sha256: string } | null;
    },
    artifact: ReturnType<typeof verifySourceExtractionArtifact>
  ): Promise<AuthoritativeSourceBoundExtraction> {
    const base = {
      invariant: '',
      analysisRunSourceId: source.id,
      analysisRunId: source.analysisRunId,
      sourceType: 'TEXT'
    };

    if (artifact.sourceType !== 'TEXT') {
      failTrust('SOURCE_TYPE_MISMATCH', {
        ...base,
        invariant: 'authority_declares_text_evidence_but_artifact_is_document'
      });
    }

    const text = source.textEvidence;
    if (!text) {
      failTrust('SOURCE_ENTITY_NOT_FOUND', {
        ...base,
        invariant: 'text_evidence_does_not_exist',
        sourceEntityId: source.textEvidenceId ?? undefined
      });
    }

    const detail = { ...base, sourceEntityId: text.id };

    if (artifact.source.textEvidenceId !== text.id) {
      failTrust('SOURCE_ENTITY_MISMATCH', {
        ...detail,
        invariant: 'artifact_text_evidence_id_is_not_authoritative'
      });
    }
    if (!sameSha(artifact.source.sourceSha256, source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'artifact_sha_does_not_match_frozen_run_sha'
      });
    }
    if (!sameSha(text.sha256, source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'text_evidence_sha_does_not_match_frozen_run_sha'
      });
    }
    if (!sameSha(sha256Of(Buffer.from(text.content, 'utf8')), source.sourceSha256)) {
      failTrust('SOURCE_SHA_MISMATCH', {
        ...detail,
        invariant: 'recomputed_content_sha_does_not_match_frozen_run_sha'
      });
    }

    // El artifact declara `PRODUCT_NFC_LINEENDINGS_TRIM`. Si el contenido
    // almacenado dejó de ser punto fijo de esa normalización, la declaración
    // sería falsa. Se rechaza; NO se normaliza y se acepta, porque normalizar
    // acá desalinearía el sha almacenado.
    if (!isProductNormalizedText(text.content)) {
      failTrust('TEXT_NORMALIZATION_DRIFT', {
        ...detail,
        invariant: 'stored_content_is_not_a_product_normalization_fixed_point'
      });
    }

    // Binding directo y fuerte, posible sólo para TEXT: acá el texto fuente
    // autoritativo ES el texto canónico de F0. Igualdad exacta, sin trim, sin
    // normalización, sin reparación.
    if (artifact.documentCanonicalText !== text.content) {
      failTrust('TEXT_CANONICAL_TEXT_MISMATCH', {
        ...detail,
        invariant: 'artifact_canonical_text_is_not_the_authoritative_content'
      });
    }

    return deepFreeze({
      analysisRunId: source.analysisRunId,
      analysisRunSourceId: source.id,
      sourceType: 'TEXT' as const,
      sourceEntityId: text.id,
      sourceSha256: source.sourceSha256,
      extractionIdentity: artifact.extractionIdentity,
      // Para TEXT la derivación queda DEMOSTRADA, no asumida.
      extractionDerivationTrust: 'AUTHORITATIVE_CONTENT_MATCHED' as const,
      artifact
    });
  }
}
