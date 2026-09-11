/**
 * Congelamiento de inputs del ReasoningRun — slice F3.2.
 *
 * Responde una sola pregunta, de forma determinista y sin ninguna llamada a
 * modelo:
 *
 *     "Para este holder y este Objective, ¿cuál era exactamente el universo de
 *      credenciales/evidencia, y qué extracción exacta quedó preparada como
 *      input del futuro reasoner?"
 *
 * NO ejecuta Objective Analysis, no construye EvidenceUnits, no razona, no aplica
 * policy, no llama al proveedor ni a FastAPI, y NO CREA EXTRACCIONES. Observa y
 * congela el estado que ya existe. Si a una fuente le falta la extracción, eso se
 * registra como un hecho — no se arregla llamando a F1.4.
 *
 * LA AUTORIDAD SE DERIVA, NUNCA LLEGA DEL LLAMANTE. La firma acepta
 * `(ownerUserId, objectiveId)` y nada más: no hay forma de pasar el snapshot del
 * Objective, ids de credenciales, ids de evidencia, ids de `AnalysisRunSource` ni
 * SHAs. La misma disciplina causal de F0.5/F1.4.
 *
 * TODO OCURRE DENTRO DE UNA SOLA TRANSACCIÓN SERIALIZABLE. El snapshot del
 * Objective, la clasificación de credenciales y fuentes, la selección de
 * candidatos de extracción y la persistencia final leen el MISMO estado del
 * dominio. Sin llamadas de red, sin descargas de storage: F3.2 no las necesita,
 * así que no hay ninguna razón para mantener la transacción abierta esperando a
 * nadie.
 */

import { Injectable } from '@nestjs/common';
import {
  CredentialStatus,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma,
  ReasoningRunInventoryDisposition,
  ReasoningRunStatus,
  TextEvidenceStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { SourceExtractionSlotError } from '../source-extraction/source-extraction-slot.errors';
import {
  SourceExtractionSlotService,
  type RawSlot
} from '../source-extraction/source-extraction-slot.service';
import {
  REASONING_INPUT_FREEZE_BLOCKED,
  failFreeze
} from './reasoning-run-input-freeze.errors';
import { assertInventoryRowShape } from './reasoning-run-inventory-row.invariants';

/**
 * El ÚNICO mimeType que el extractor V1 cubre.
 *
 * Se exigen `kind` y `mimeType` a la vez, igual que
 * `AutomaticDocumentAnalysisService`, `AutomaticCourseTextAnalysisService.hasCurrentPdf`
 * y el gate de F1.4: una fila donde ambos se contradicen no describe una fuente
 * PDF confiable. No se define "PDF" de ninguna otra forma.
 */
const PDF_MIME_TYPE = 'application/pdf';

const D = ReasoningRunInventoryDisposition;

/** Item de inventario listo para persistir. Espeja las columnas de F3.1. */
interface InventoryRow {
  readonly credentialId: string;
  readonly disposition: ReasoningRunInventoryDisposition;
  readonly documentEvidenceId: string | null;
  readonly textEvidenceId: string | null;
  readonly sourceSha256: string | null;
  readonly selectedAnalysisRunSourceId: string | null;
  readonly artifactBlobSha256: string | null;
  readonly runLocalSourceId: string | null;
}

export interface FrozenReasoningRun {
  readonly reasoningRunId: string;
  readonly status: ReasoningRunStatus;
  readonly failureCode: string | null;
  readonly inventorySize: number;
  readonly includedSourceCount: number;
  readonly blockedSourceCount: number;
}

/**
 * La fuente autoritativa elegida como representación primaria, antes de mirar
 * ninguna extracción.
 */
interface PrimarySource {
  readonly documentEvidenceId: string | null;
  readonly textEvidenceId: string | null;
  readonly sourceSha256: string;
}

const CANDIDATE_SELECT = {
  id: true,
  sourceSha256: true,
  documentEvidenceId: true,
  textEvidenceId: true,
  extractionArtifactCanonicalJson: true,
  artifactBlobSha256: true,
  extractionDerivationTrust: true,
  analysisRun: { select: { credentialId: true } }
} as const;

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class ReasoningRunInputFreezeService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly slots: SourceExtractionSlotService
  ) {}

  /**
   * Crea un `ReasoningRun` con su inventario COMPLETO congelado.
   *
   * `ownerUserId` lo aporta el llamante interno —el futuro `/me` de F3.7—, y es
   * la única autoridad de identidad que entra. Todo lo demás se deriva.
   */
  public async createFrozenReasoningRunForUser(
    ownerUserId: string,
    objectiveId: string
  ): Promise<FrozenReasoningRun> {
    return this.prisma.$transaction(
      async (tx) => this.freeze(tx, ownerUserId, objectiveId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async freeze(
    tx: TransactionClient,
    ownerUserId: string,
    objectiveId: string
  ): Promise<FrozenReasoningRun> {
    const objective = await this.loadOwnedObjective(tx, ownerUserId, objectiveId);
    const credentials = await this.loadHolderCredentials(tx, ownerUserId);

    const rows: InventoryRow[] = [];
    for (const credential of credentials) {
      rows.push(...(await this.classifyCredential(tx, ownerUserId, credential)));
    }

    // Los `src_NN` se asignan DESPUÉS de clasificar todo, sobre el orden estable
    // de credenciales: así no dependen de en qué orden se resolvieron las
    // verificaciones.
    const numbered = this.assignRunLocalSourceIds(rows);
    for (const row of numbered) {
      assertInventoryRowShape(row);
    }

    const blocked = numbered.filter((row) => this.isBlocked(row.disposition));
    const included = numbered.filter((row) => row.disposition === D.INCLUDED);
    const failed = blocked.length > 0;
    const now = new Date();

    const run = await tx.reasoningRun.create({
      data: {
        ownerUserId,
        objectiveId,
        objectiveDefinitionSnapshot: objective.definition as Prisma.InputJsonValue,
        objectiveTitleSnapshot: objective.title,
        status: failed ? ReasoningRunStatus.failed : ReasoningRunStatus.pending,
        failureCode: failed ? REASONING_INPUT_FREEZE_BLOCKED : null,
        failedAt: failed ? now : null,
        inventory: { create: numbered.map((row) => ({ ...row })) }
      },
      select: { id: true, status: true, failureCode: true }
    });

    return {
      reasoningRunId: run.id,
      status: run.status,
      failureCode: run.failureCode,
      inventorySize: numbered.length,
      includedSourceCount: included.length,
      blockedSourceCount: blocked.length
    };
  }

  // -------------------------------------------------------------------------
  // Objective
  // -------------------------------------------------------------------------

  /**
   * Un Objective ajeno y uno inexistente dan el MISMO resultado.
   *
   * El filtro combinado hace que la pregunta "¿existe este id?" no sea
   * respondible por un holder que no lo posee, igual que en `/me/objectives`.
   */
  private async loadOwnedObjective(
    tx: TransactionClient,
    ownerUserId: string,
    objectiveId: string
  ): Promise<{ definition: unknown; title: string }> {
    const objective = await tx.objective.findFirst({
      where: { id: objectiveId, ownerUserId },
      select: { definition: true, title: true }
    });

    if (!objective) {
      failFreeze('OBJECTIVE_NOT_FOUND', {
        invariant: 'objective_does_not_exist_or_is_not_owned_by_this_user',
        objectiveId
      });
    }

    // Se re-verifica con el verificador productivo de F2 en vez de copiar la
    // columna a ciegas: un run congelado contra una definición ilegible no
    // podría validarse después contra nada.
    try {
      verifyObjectiveDefinitionArtifact(objective.definition);
    } catch {
      failFreeze('OBJECTIVE_DEFINITION_CORRUPT', {
        invariant: 'persisted_objective_definition_must_verify',
        objectiveId
      });
    }

    return { definition: objective.definition, title: objective.title };
  }

  // -------------------------------------------------------------------------
  // Inventario, enraizado en la credencial
  // -------------------------------------------------------------------------

  /**
   * Las credenciales del holder, por la relación autoritativa del dominio.
   *
   * `subjectUserId` es el titular. NO se infiere pertenencia por email, por DID,
   * por issuer ni por quién subió la evidencia.
   *
   * Orden `(createdAt ASC, id ASC)`: `createdAt` es inmutable —`@default(now())`,
   * sin `@updatedAt`— y `id` desempata. Deliberadamente NO se usa
   * `Credential.updatedAt`, que muta.
   */
  private async loadHolderCredentials(tx: TransactionClient, ownerUserId: string) {
    return tx.credential.findMany({
      where: { subjectUserId: ownerUserId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        documentEvidences: {
          orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            kind: true,
            mimeType: true,
            sha256: true,
            status: true
          }
        },
        textEvidences: {
          orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          select: { id: true, sha256: true, status: true }
        }
      }
    });
  }

  private async classifyCredential(
    tx: TransactionClient,
    ownerUserId: string,
    credential: Awaited<
      ReturnType<ReasoningRunInputFreezeService['loadHolderCredentials']>
    >[number]
  ): Promise<InventoryRow[]> {
    // La credencial queda fuera ANTES de mirar sus fuentes: enumerarlas repetiría
    // N veces la misma causa. UNA fila por credencial excluida.
    if (credential.status === CredentialStatus.draft) {
      return [this.credentialLevelRow(credential.id, D.EXCLUDED_CREDENTIAL_STATE_DRAFT)];
    }
    if (credential.status === CredentialStatus.revoked) {
      return [this.credentialLevelRow(credential.id, D.EXCLUDED_CREDENTIAL_STATE_REVOKED)];
    }

    const rows: InventoryRow[] = [];

    // `replaced` queda VISIBLE como superseded, nunca como grounding.
    for (const document of credential.documentEvidences) {
      if (document.status === DocumentEvidenceStatus.replaced) {
        rows.push(
          this.sourceLevelRow(credential.id, D.EXCLUDED_SOURCE_SUPERSEDED, {
            documentEvidenceId: document.id,
            textEvidenceId: null,
            sourceSha256: this.authoritativeSha(document.sha256)
          })
        );
      }
    }
    for (const text of credential.textEvidences) {
      if (text.status === TextEvidenceStatus.replaced) {
        rows.push(
          this.sourceLevelRow(credential.id, D.EXCLUDED_SOURCE_SUPERSEDED, {
            documentEvidenceId: null,
            textEvidenceId: text.id,
            sourceSha256: this.authoritativeSha(text.sha256)
          })
        );
      }
    }

    const currentDocuments = credential.documentEvidences.filter(
      (document) => document.status === DocumentEvidenceStatus.current
    );
    const currentTexts = credential.textEvidences.filter(
      (text) => text.status === TextEvidenceStatus.current
    );

    const eligiblePdf = currentDocuments.find(
      (document) =>
        document.kind === DocumentEvidenceKind.pdf &&
        document.mimeType === PDF_MIME_TYPE
    );

    // Un documento vigente que no es PDF soportado NO bloquea al texto: se
    // clasifica como tipo no soportado y la selección sigue entre lo que V1
    // efectivamente soporta. Es lo que ya hace `hasCurrentPdf`.
    for (const document of currentDocuments) {
      if (document === eligiblePdf) continue;
      rows.push(
        this.sourceLevelRow(credential.id, D.EXCLUDED_UNSUPPORTED_TYPE, {
          documentEvidenceId: document.id,
          textEvidenceId: null,
          sourceSha256: this.authoritativeSha(document.sha256)
        })
      );
    }

    let primary: PrimarySource | null = null;

    if (eligiblePdf) {
      primary = {
        documentEvidenceId: eligiblePdf.id,
        textEvidenceId: null,
        sourceSha256: this.authoritativeSha(eligiblePdf.sha256)
      };
      // Con PDF elegible, el texto vigente es la representación alterna: queda
      // EXCLUIDA pero VISIBLE. No se le crea extracción ni se le bindea una
      // histórica.
      for (const text of currentTexts) {
        rows.push(
          this.sourceLevelRow(credential.id, D.EXCLUDED_ALTERNATE_REPRESENTATION, {
            documentEvidenceId: null,
            textEvidenceId: text.id,
            sourceSha256: this.authoritativeSha(text.sha256)
          })
        );
      }
    } else if (currentTexts.length > 0) {
      const [selectedText, ...rest] = currentTexts;
      primary = {
        documentEvidenceId: null,
        textEvidenceId: selectedText.id,
        sourceSha256: this.authoritativeSha(selectedText.sha256)
      };
      // El índice único parcial deja a lo sumo un TextEvidence current por
      // credencial, así que `rest` está vacío en el dominio real. Se clasifica
      // igual en vez de descartarlo en silencio.
      for (const text of rest) {
        rows.push(
          this.sourceLevelRow(credential.id, D.EXCLUDED_ALTERNATE_REPRESENTATION, {
            documentEvidenceId: null,
            textEvidenceId: text.id,
            sourceSha256: this.authoritativeSha(text.sha256)
          })
        );
      }
    }

    if (primary) {
      rows.push(await this.bindPrimarySource(tx, ownerUserId, credential.id, primary));
    }

    // Sólo si la credencial no produjo NINGUNA fila source-level. Si tiene
    // fuentes `replaced`, esas filas ya hacen observable la ausencia de grounding
    // y agregar otra grabaría dos veces el mismo hecho.
    if (rows.length === 0) {
      return [this.credentialLevelRow(credential.id, D.EXCLUDED_NO_GROUNDING_SOURCE)];
    }

    return rows;
  }

  // -------------------------------------------------------------------------
  // Selección y verificación del candidato de extracción — HD-3
  // -------------------------------------------------------------------------

  /**
   * `LATEST_STRUCTURALLY_PRESENT_CANDIDATE_THEN_VERIFY_FAIL_CLOSED`.
   *
   * Selección temporal PRIMERO, verificación DESPUÉS, y fail closed. No se
   * recorren candidatos hasta encontrar uno que verifique: saltear el más
   * reciente porque está corrupto ocultaría una violación de integridad
   * persistida.
   *
   * El `sourceSha256` NO entra en el filtro de elegibilidad, y eso es una
   * decisión con motivo: `DocumentEvidence.sha256` y `TextEvidence.sha256` son
   * write-once —el único update sobre esas filas es `current -> replaced`—, así
   * que una entidad de evidencia tiene un solo SHA de por vida. Un
   * `AnalysisRunSource` que la referencia con OTRO SHA es una inconsistencia, no
   * una variación histórica legítima; filtrarla lo escondería y podría hacer caer
   * la selección en una fila anterior.
   */
  private async bindPrimarySource(
    tx: TransactionClient,
    ownerUserId: string,
    credentialId: string,
    primary: PrimarySource
  ): Promise<InventoryRow> {
    const candidate = await tx.analysisRunSource.findFirst({
      where: {
        documentEvidenceId: primary.documentEvidenceId,
        textEvidenceId: primary.textEvidenceId,
        NOT: {
          extractionArtifactCanonicalJson: null,
          artifactBlobSha256: null,
          extractionDerivationTrust: null
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: CANDIDATE_SELECT
    });

    if (!candidate) {
      // No existe representación estructuralmente presente. NO se crea una: F3.2
      // congela lo que hay. Llamar a F1.4 acá sería fabricar el input que se está
      // auditando.
      return this.sourceLevelRow(
        credentialId,
        D.BLOCKED_EXTRACTION_UNAVAILABLE,
        primary
      );
    }

    const blockedByIntegrity = (): InventoryRow => ({
      ...this.sourceLevelRow(
        credentialId,
        D.BLOCKED_EXTRACTION_INTEGRITY_FAILURE,
        primary
      ),
      // Se conserva el candidato EXACTO que falló: sin él, el fallo quedaría sin
      // sujeto.
      selectedAnalysisRunSourceId: candidate.id
    });

    // Binding causal, no sólo integridad referencial: la fila elegida tiene que
    // ser de ESTA entidad de evidencia, de ESTA credencial, con ESTE SHA.
    const sameEntity =
      candidate.documentEvidenceId === primary.documentEvidenceId &&
      candidate.textEvidenceId === primary.textEvidenceId;
    const sameCredential = candidate.analysisRun.credentialId === credentialId;
    const sameSha =
      candidate.sourceSha256.toLowerCase() === primary.sourceSha256;

    if (!sameEntity || !sameCredential || !sameSha) {
      return blockedByIntegrity();
    }

    let verified;
    try {
      verified = this.slots.verifyReadExtractionSlot(candidate.id, candidate as RawSlot);
    } catch (error: unknown) {
      // SÓLO se convierte en disposición un fallo DETERMINISTA y clasificado del
      // contrato de extracción. `SourceExtractionSlotError` es exactamente ese
      // conjunto cerrado: blob SHA, JSON inválido, verificación F0.4, canonical
      // at rest, bundle parcial.
      //
      // Cualquier otra cosa —Prisma caído, timeout, bug— se propaga y hace
      // rollback: no se inventa una fila que afirme haber observado algo que
      // nunca se observó.
      if (error instanceof SourceExtractionSlotError) {
        return blockedByIntegrity();
      }
      throw error;
    }

    if (!verified) {
      // El filtro pedía bundle completo, así que llegar acá significa que la fila
      // cambió bajo los pies o que el filtro no aplicó. Es un estado inconsistente
      // observado, no una ausencia.
      return blockedByIntegrity();
    }

    // Redundante con la verificación —el artifact ya se validó contra su blob—,
    // pero explícito: el witness que se congela es el del slot verificado.
    if (verified.artifactBlobSha256 !== candidate.artifactBlobSha256) {
      return blockedByIntegrity();
    }

    return {
      ...this.sourceLevelRow(credentialId, D.INCLUDED, primary),
      selectedAnalysisRunSourceId: candidate.id,
      artifactBlobSha256: verified.artifactBlobSha256
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * El SHA autoritativo es el de la entidad de evidencia, en minúscula.
   *
   * Es EXACTAMENTE la misma derivación que ya usa `AnalysisRunService.toSource`
   * (`evidence.sha256.toLowerCase()`) y que `AnalysisRunExecutionService` compara.
   * No se recorta, no se re-normaliza, no se hashea un wrapper JSON y no se
   * inventa una convención nueva.
   */
  private authoritativeSha(sha256: string): string {
    return sha256.toLowerCase();
  }

  private isBlocked(disposition: ReasoningRunInventoryDisposition): boolean {
    return (
      disposition === D.BLOCKED_EXTRACTION_UNAVAILABLE ||
      disposition === D.BLOCKED_EXTRACTION_INTEGRITY_FAILURE
    );
  }

  private credentialLevelRow(
    credentialId: string,
    disposition: ReasoningRunInventoryDisposition
  ): InventoryRow {
    return {
      credentialId,
      disposition,
      documentEvidenceId: null,
      textEvidenceId: null,
      sourceSha256: null,
      selectedAnalysisRunSourceId: null,
      artifactBlobSha256: null,
      runLocalSourceId: null
    };
  }

  private sourceLevelRow(
    credentialId: string,
    disposition: ReasoningRunInventoryDisposition,
    source: PrimarySource
  ): InventoryRow {
    return {
      credentialId,
      disposition,
      documentEvidenceId: source.documentEvidenceId,
      textEvidenceId: source.textEvidenceId,
      sourceSha256: source.sourceSha256,
      selectedAnalysisRunSourceId: null,
      artifactBlobSha256: null,
      runLocalSourceId: null
    };
  }

  /**
   * `src_01`, `src_02`, … sólo para `INCLUDED`, en el orden en que quedaron las
   * filas — que es el orden estable de credenciales `(createdAt ASC, id ASC)`.
   *
   * En V1 hay a lo sumo una representación INCLUDED por credencial, así que ese
   * orden ya determina la numeración por completo. No se usa el orden accidental
   * de Prisma/Postgres, ni la calidad de la extracción, ni la relevancia
   * semántica.
   */
  private assignRunLocalSourceIds(rows: readonly InventoryRow[]): InventoryRow[] {
    let index = 0;
    return rows.map((row) => {
      if (row.disposition !== D.INCLUDED) return row;
      index += 1;
      return { ...row, runLocalSourceId: `src_${String(index).padStart(2, '0')}` };
    });
  }
}
