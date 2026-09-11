/**
 * Orquestacion de extraccion de fuente — slice F1.4.
 *
 * Cierra la CADENA CAUSAL que F0.5 dejo abierta:
 *
 *     AnalysisRunSource autoritativa
 *       -> material autoritativo (bytes de storage / content persistido)
 *         -> productor interno FastAPI (F1.3 -> F0.2 / F0.3)
 *           -> `unknown`
 *             -> F0.4 + F0.5   (trust gate)
 *               -> AuthoritativeSourceBoundExtraction
 *                 -> F1.2      (MONOTONIC_FILL_ONCE)
 *                   -> extraccion persistida y verificada
 *
 * LA API RECIBE UN SOLO ARGUMENTO, y eso es el punto.
 *
 * `ensureExtractionForAnalysisRunSource(analysisRunSourceId)` no acepta bytes,
 * contenido, shas, ids de entidad fuente, storageKey ni artifact. Un llamador NO
 * puede decir a la vez "procesa esta AnalysisRunSource" y "pero usa este material
 * que te paso": la segunda mitad de esa frase no es representable. Todo el
 * material se DERIVA de la autoridad, siempre en el mismo sentido.
 *
 * QUE PROPIEDAD CIERRA F1.4, dicho con precision. Son DOS, y hoy tienen valores
 * distintos:
 *
 *     F1_4_ORCHESTRATION_PROVENANCE_PATH:       CAUSALLY_ENFORCED
 *     PRODUCTIVE_ANALYSIS_RUN_PROVENANCE_PATH:  NOT_YET_WIRED
 *
 * La primera: toda extraccion que llega al slot persistido POR ESTE CAMINO viene
 * de una fuente elegida por NestJS, cuyo material exacto NestJS leyo y
 * transporto, y cuya respuesta paso por F0.5 antes de poder persistirse. F1.4
 * proporciona, entonces, un camino causalmente controlado para persistir una
 * extraccion.
 *
 * La segunda: ese camino TODAVIA NO forma parte del lifecycle productivo de
 * `AnalysisRun`. Este servicio no esta registrado en ningun modulo Nest y
 * `AnalysisRunExecutionService` no lo invoca, asi que hoy ninguna extraccion
 * llega al slot por ejecucion de un run. El wiring es F1.6.
 *
 * La distincion importa: "si se persiste por aca, hay procedencia" es cierto; "el
 * camino productivo vigente ya tiene procedencia" no lo es todavia, porque el
 * antecedente no se cumple en produccion. Colapsar las dos afirmaciones en una
 * sola linea seria decir de mas.
 *
 * Ninguna de las dos significa que toda invocacion posible del productor este
 * bajo procedencia —F1.3 sigue siendo un transporte interno invocable—, ni
 * attestation criptografica, ni re-extraccion independiente. Por eso para PDF se
 * mantiene
 *
 *     PDF_EXTRACTION_DERIVATION_TRUST: PRODUCER_ASSUMED
 *
 * exactamente como lo dejo F0.5, y no cambia ni con este slice ni con F1.6.
 * Procedencia causal y prueba de derivacion son dos cosas distintas y no se
 * canjean una por otra.
 *
 * F1.4 NO TOCA EL LIFECYCLE PRODUCTIVO. `AnalysisRunExecutionService` queda
 * intacto. Eso es F1.6, despues del endurecimiento de privacidad de F1.5.
 * Primero se demuestra el pipeline causal; recien despues se cambia cuando un run
 * puede fallar.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AiServiceClient } from '../ai/ai-service.client';
import {
  DOCUMENT_STORAGE_PORT,
  type DocumentStoragePort
} from '../document-evidence/document-storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { failOrchestration } from './source-extraction-orchestration.errors';
import { SourceExtractionSlotService } from './source-extraction-slot.service';
import { type PersistedVerifiedSourceExtraction } from './source-extraction-slot.types';
import { SourceExtractionTrustGateService } from './source-extraction-trust-gate.service';

const SHA256_HEX = /^[a-f0-9]{64}$/i;

/**
 * Valores de dominio como literales, NO importados de `@prisma/client`.
 *
 * Es la misma decision que ya tomaron el trust gate de F0.5 y el repositorio de
 * F1.2: ningun modulo de `src/source-extraction/` importa el cliente de Prisma, y
 * el test de independencia de F0.4 recorre el directorio entero para mantenerlo
 * asi. Aflojar ese allowlist para tres constantes le abriria la puerta tambien a
 * los modulos del verificador, que deben poder correr sin nada generado.
 *
 * La red de seguridad esta en `__guards__/source-extraction-production-callers`,
 * que SI importa el enum real y ancla estos literales contra el: si alguien
 * renombra el enum en el schema, ese test rompe en vez de que la comparacion
 * empiece a fallar en silencio.
 */
const DOCUMENT_EVIDENCE_SOURCE_TYPE = 'document_evidence';
const PDF_DOCUMENT_KIND = 'pdf';

/**
 * El unico mimeType que el extractor F0 V1 cubre. El kind `pdf` por si solo no
 * alcanza: se exigen AMBOS, porque una fila donde el kind y el mimeType se
 * contradicen no describe una fuente PDF confiable.
 */
const PDF_MIME_TYPE = 'application/pdf';

const AUTHORITY_SELECT = {
  id: true,
  analysisRunId: true,
  sourceType: true,
  documentEvidenceId: true,
  textEvidenceId: true,
  sourceSha256: true,
  analysisRun: { select: { credentialId: true } },
  // La entidad fuente se toma SIEMPRE por la relacion de la fila congelada. No se
  // vuelve a buscar "la evidencia actual" de la credencial.
  documentEvidence: {
    select: {
      id: true,
      credentialId: true,
      kind: true,
      mimeType: true,
      sha256: true,
      storageKey: true
    }
  },
  textEvidence: { select: { id: true, credentialId: true, content: true, sha256: true } }
} as const;

interface AuthorityRow {
  id: string;
  analysisRunId: string;
  sourceType: string;
  documentEvidenceId: string | null;
  textEvidenceId: string | null;
  sourceSha256: string;
  analysisRun: { credentialId: string };
  documentEvidence: {
    id: string;
    credentialId: string;
    kind: string;
    mimeType: string;
    sha256: string;
    storageKey: string;
  } | null;
  textEvidence: { id: string; credentialId: string; content: string; sha256: string } | null;
}

interface OrchestrationDetailBase {
  invariant: string;
  analysisRunSourceId: string;
  analysisRunId?: string;
  sourceEntityId?: string;
}

/** Comparacion de sha con la convencion de dominio ya existente (`toLowerCase`). */
function sameSha(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class SourceExtractionOrchestrationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiServiceClient,
    private readonly trustGate: SourceExtractionTrustGateService,
    private readonly slots: SourceExtractionSlotService,
    @Inject(DOCUMENT_STORAGE_PORT)
    private readonly storage: DocumentStoragePort
  ) {}

  /**
   * Garantiza que este `AnalysisRunSource` tenga su extraccion persistida y
   * verificada, extrayendola si todavia no la tiene.
   *
   * Es idempotente: si el slot ya esta PRESENT devuelve lo persistido sin volver a
   * llamar al productor. Si no lo esta, corre la cadena completa.
   */
  public async ensureExtractionForAnalysisRunSource(
    analysisRunSourceId: string
  ): Promise<PersistedVerifiedSourceExtraction> {
    // 1. SLOT PRIMERO. Un reintento dentro del MISMO run no debe re-extraer: el
    //    slot es MONOTONIC_FILL_ONCE y lo que ya se congelo es la respuesta.
    //
    //    Esto NO es reuso cross-run y no toca `REUSE_SCOPE: NONE_IN_V1`: la
    //    lectura esta indexada por `analysisRunSourceId`, asi que otro
    //    AnalysisRun sobre la misma evidencia tiene su propia fila y su propia
    //    extraccion. No se comparte nada entre runs.
    //
    //    Un slot corrupto LANZA desde F1.2 y se propaga tal cual. No se "repara"
    //    re-extrayendo por encima: eso convertiria una perdida de integridad ya
    //    detectada en un dato nuevo que la tapa.
    const existing = await this.slots.readExtractionSlot(analysisRunSourceId);
    if (existing.status === 'SLOT_PRESENT') {
      return existing.extraction;
    }
    if (existing.status === 'SOURCE_NOT_FOUND') {
      failOrchestration('ANALYSIS_RUN_SOURCE_NOT_FOUND_FOR_EXTRACTION', {
        invariant: 'analysis_run_source_does_not_exist',
        analysisRunSourceId
      });
    }

    // 2. AUTORIDAD. De esta fila sale TODO lo demas: que tipo de operacion es, que
    //    entidad fuente se usa y que material se envia.
    const source = await this.loadAuthority(analysisRunSourceId);

    const artifact =
      source.documentEvidenceId !== null
        ? await this.produceFromDocumentSource(source)
        : await this.produceFromTextSource(source);

    // 3. EL RESPONSE ES `unknown` Y SE TRATA COMO TAL. Va entero al trust gate, sin
    //    inspeccion parcial, sin cast, sin leer un solo campo antes. F0.5 corre
    //    F0.4 por dentro y vuelve a establecer el binding contra la fuente
    //    autoritativa: el fail-fast del paso 2 no lo sustituye, lo precede.
    const binding = await this.trustGate.trustSourceExtractionForAnalysisRunSource({
      analysisRunSourceId,
      artifact
    });

    // 4. RECIEN AHORA se persiste. El tipo de `fillExtractionSlot` es
    //    `AuthoritativeSourceBoundExtraction`, asi que el orden F0.5 -> F1.2 no es
    //    una convencion de este metodo: no hay forma de escribir un artifact que
    //    no haya pasado por el gate.
    //
    //    La concurrencia es de F1.2 y no se duplica aca: mismo bundle converge
    //    idempotentemente, bundle distinto es conflicto y no se sobrescribe.
    return this.slots.fillExtractionSlot(binding);
  }

  // -------------------------------------------------------------------------
  // Autoridad
  // -------------------------------------------------------------------------

  private async loadAuthority(analysisRunSourceId: string): Promise<AuthorityRow> {
    const source = (await this.prisma.analysisRunSource.findUnique({
      where: { id: analysisRunSourceId },
      select: AUTHORITY_SELECT
    })) as AuthorityRow | null;

    if (!source) {
      // Carrera posible: la fila existia al leer el slot y ya no.
      failOrchestration('ANALYSIS_RUN_SOURCE_NOT_FOUND_FOR_EXTRACTION', {
        invariant: 'analysis_run_source_does_not_exist',
        analysisRunSourceId
      });
    }

    const base: OrchestrationDetailBase = {
      invariant: '',
      analysisRunSourceId,
      analysisRunId: source.analysisRunId
    };

    if (!SHA256_HEX.test(source.sourceSha256)) {
      failOrchestration('ANALYSIS_RUN_SOURCE_INVALID_FOR_EXTRACTION', {
        ...base,
        invariant: 'frozen_source_sha256_is_not_hex'
      });
    }

    const hasDocument = source.documentEvidenceId !== null;
    const hasText = source.textEvidenceId !== null;
    if (hasDocument === hasText) {
      failOrchestration('ANALYSIS_RUN_SOURCE_INVALID_FOR_EXTRACTION', {
        ...base,
        invariant: 'analysis_run_source_must_reference_exactly_one_entity'
      });
    }

    // El enum declarado y la referencia real tienen que decir lo mismo. Si se
    // contradicen no se elige un ganador: la autoridad esta rota y se para.
    const declaredDocument = source.sourceType === DOCUMENT_EVIDENCE_SOURCE_TYPE;
    if (declaredDocument !== hasDocument) {
      failOrchestration('ANALYSIS_RUN_SOURCE_INVALID_FOR_EXTRACTION', {
        ...base,
        invariant: 'declared_source_type_contradicts_the_referenced_entity'
      });
    }

    return source;
  }

  // -------------------------------------------------------------------------
  // Camino causal PDF
  // -------------------------------------------------------------------------

  private async produceFromDocumentSource(source: AuthorityRow): Promise<unknown> {
    const base: OrchestrationDetailBase = {
      invariant: '',
      analysisRunSourceId: source.id,
      analysisRunId: source.analysisRunId
    };
    const document = source.documentEvidence;

    if (!document) {
      failOrchestration('SOURCE_ENTITY_NOT_FOUND_FOR_EXTRACTION', {
        ...base,
        invariant: 'document_evidence_does_not_exist',
        sourceEntityId: source.documentEvidenceId ?? undefined
      });
    }

    const detail: OrchestrationDetailBase = { ...base, sourceEntityId: document.id };

    // ELEGIBILIDAD DE SUBTIPO, antes de leer un solo byte.
    //
    // `DocumentEvidence` puede ser PDF, PNG o JPEG. El DOMINIO decide si la
    // evidencia ES una fuente PDF; F0.2 decide que puede observar de sus bytes.
    // Por eso aca NO se mira el contenido: nada de `%PDF-`, nada de magic header,
    // nada de parseabilidad. Reinstalar ese guard seria justamente la regresion
    // que F1.3 tuvo que sacar del transporte.
    //
    // La consecuencia deseada: unos bytes PDF malformados SI van al productor y
    // pueden dar un artifact `FAILED` legitimo; una imagen conocida por el dominio
    // NO va, porque llamarla "un PDF que no pudimos leer" seria falso.
    if (document.kind !== PDF_DOCUMENT_KIND) {
      failOrchestration('DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION', {
        ...detail,
        invariant: 'document_kind_is_not_pdf',
        documentKind: document.kind
      });
    }
    if (document.mimeType !== PDF_MIME_TYPE) {
      failOrchestration('DOCUMENT_SOURCE_NOT_SUPPORTED_FOR_EXTRACTION', {
        ...detail,
        invariant: 'document_mime_type_is_not_application_pdf',
        documentKind: document.kind
      });
    }

    this.assertSnapshotConsistency({
      detail,
      entityCredentialId: document.credentialId,
      entitySha256: document.sha256,
      runCredentialId: source.analysisRun.credentialId,
      frozenSha256: source.sourceSha256,
      entityLabel: 'document_evidence'
    });

    // Los bytes se leen SIEMPRE por el storageKey AUTORITATIVO. No existe ningun
    // camino por el que un storageKey externo decida que se abre.
    //
    // Un fallo de storage se propaga como `DocumentStorageError` sin envolver: es
    // infraestructura, y NO se convierte en un artifact `FAILED` fabricado. El
    // productor no llega a invocarse y el slot queda ABSENT.
    const bytes = await this.storage.readDocument(document.storageKey);

    // Los bytes viajan EXACTAMENTE como se leyeron: sin transformar, sin
    // normalizar, sin recortar, sin round-trip por base64 en la aplicacion.
    // `Buffer` ya es un `Uint8Array`, asi que no se copia nada.
    return this.aiClient.extractPdfSource({
      fileBytes: bytes,
      documentEvidenceId: document.id,
      sourceSha256: source.sourceSha256,
      storageKey: document.storageKey
    });
  }

  // -------------------------------------------------------------------------
  // Camino causal TEXT
  // -------------------------------------------------------------------------

  private async produceFromTextSource(source: AuthorityRow): Promise<unknown> {
    const base: OrchestrationDetailBase = {
      invariant: '',
      analysisRunSourceId: source.id,
      analysisRunId: source.analysisRunId
    };
    const text = source.textEvidence;

    if (!text) {
      failOrchestration('SOURCE_ENTITY_NOT_FOUND_FOR_EXTRACTION', {
        ...base,
        invariant: 'text_evidence_does_not_exist',
        sourceEntityId: source.textEvidenceId ?? undefined
      });
    }

    const detail: OrchestrationDetailBase = { ...base, sourceEntityId: text.id };

    this.assertSnapshotConsistency({
      detail,
      entityCredentialId: text.credentialId,
      entitySha256: text.sha256,
      runCredentialId: source.analysisRun.credentialId,
      frozenSha256: source.sourceSha256,
      entityLabel: 'text_evidence'
    });

    // El contenido viaja VERBATIM. Ni trim, ni NFC, ni fines de linea, ni recorte.
    // Si el contenido almacenado dejo de ser punto fijo de
    // PRODUCT_NFC_LINEENDINGS_TRIM, F0.3 lo detecta y falla: arreglarlo aca
    // esconderia un defecto aguas arriba y haria que el artifact declarase una
    // normalizacion que nadie aplico donde correspondia.
    return this.aiClient.extractTextSource({
      content: text.content,
      textEvidenceId: text.id,
      sourceSha256: source.sourceSha256
    });
  }

  // -------------------------------------------------------------------------
  // Coherencia del snapshot autoritativo
  // -------------------------------------------------------------------------

  /**
   * Checks baratos, previos al transporte, siguiendo el precedente de
   * `AnalysisRunExecutionService`, que ya compara credencial y sha antes de llamar
   * a la IA.
   *
   * Son FAIL-FAST, no una sustitucion de F0.5: evitan gastar una lectura de
   * storage y una llamada HTTP sobre un snapshot que ya se sabe incoherente. El
   * binding autoritativo lo sigue estableciendo F0.5 despues de la respuesta.
   *
   * NO se exige que la entidad fuente siga siendo `current`. La pregunta de este
   * slice es "que fuente congelo este AnalysisRun", no "cual es la fuente actual
   * de la credencial hoy": un run historico debe poder extraer la evidencia que
   * uso aunque despues haya sido reemplazada.
   */
  private assertSnapshotConsistency(input: {
    detail: OrchestrationDetailBase;
    entityCredentialId: string;
    entitySha256: string;
    runCredentialId: string;
    frozenSha256: string;
    entityLabel: string;
  }): void {
    if (!sameSha(input.entitySha256, input.frozenSha256)) {
      failOrchestration('AUTHORITATIVE_SNAPSHOT_MISMATCH', {
        ...input.detail,
        invariant: `${input.entityLabel}_sha_does_not_match_frozen_run_sha`
      });
    }
    if (input.entityCredentialId !== input.runCredentialId) {
      failOrchestration('AUTHORITATIVE_SNAPSHOT_MISMATCH', {
        ...input.detail,
        invariant: `${input.entityLabel}_belongs_to_a_different_credential`
      });
    }
  }
}
