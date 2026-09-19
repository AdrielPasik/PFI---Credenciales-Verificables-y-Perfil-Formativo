/**
 * Clasificacion de inventario enraizada en la credencial — primitiva COMPARTIDA.
 *
 * Extraida sin cambios de comportamiento de `reasoning-run-input-freeze.service.ts`
 * para que dos productos distintos congelen evidencia con EXACTAMENTE la misma
 * semantica:
 *
 *     ReasoningRun del holder      universo = credenciales del holder
 *     VerificationRun publico      universo = credenciales que el holder AUTORIZO
 *
 * Lo que decide el universo NO vive aca. Esta primitiva no sabe quien es el
 * dueño, no conoce Objectives, no conoce shares ni politicas: recibe un filtro de
 * credenciales ya autorizado por el llamante y responde una sola pregunta:
 *
 *     "Para estas credenciales, que evidencia exacta queda como input, y por que
 *      queda afuera la que no?"
 *
 * Duplicar esta logica en un segundo archivo es justamente lo que se evita: dos
 * copias de la seleccion de candidatos terminarian divergiendo en silencio, y
 * una misma disposicion pasaria a significar dos cosas.
 *
 * Sin I/O de red ni de storage: `verifyReadExtractionSlot` valida el artifact
 * contra su propio blob en memoria. Por eso todo corre dentro de la transaccion
 * del llamante.
 */

import {
  CredentialStatus,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma,
  ReasoningRunInventoryDisposition,
  TextEvidenceStatus
} from '@prisma/client';

import { SourceExtractionSlotError } from '../source-extraction/source-extraction-slot.errors';
import {
  type RawSlot,
  type SourceExtractionSlotService
} from '../source-extraction/source-extraction-slot.service';
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

type TransactionClient = Prisma.TransactionClient;

/** Item de inventario listo para persistir. Espeja las columnas de F3.1. */
export interface InventoryRow {
  readonly credentialId: string;
  readonly disposition: ReasoningRunInventoryDisposition;
  readonly documentEvidenceId: string | null;
  readonly textEvidenceId: string | null;
  readonly sourceSha256: string | null;
  readonly selectedAnalysisRunSourceId: string | null;
  readonly artifactBlobSha256: string | null;
  readonly runLocalSourceId: string | null;
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

const CREDENTIAL_INVENTORY_SELECT = {
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
} satisfies Prisma.CredentialSelect;

type InventoryCredential = Prisma.CredentialGetPayload<{
  select: typeof CREDENTIAL_INVENTORY_SELECT;
}>;

/**
 * Carga el universo que el LLAMANTE ya decidio.
 *
 * El `where` lo arma el wrapper de producto: el del holder filtra por
 * `subjectUserId`, el publico por el conjunto autorizado. Esta funcion solo fija
 * lo que tiene que ser identico para los dos — la forma leida y el ORDEN.
 *
 * Orden `(createdAt ASC, id ASC)`: `createdAt` es inmutable —`@default(now())`,
 * sin `@updatedAt`— y `id` desempata. Deliberadamente NO se usa
 * `Credential.updatedAt`, que muta. De este orden depende la numeracion
 * `src_NN`, asi que no puede variar entre productos.
 */
export async function loadCredentialsForInventory(
  tx: TransactionClient,
  where: Prisma.CredentialWhereInput
): Promise<InventoryCredential[]> {
  return tx.credential.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: CREDENTIAL_INVENTORY_SELECT
  });
}

/**
 * Clasifica un universo de credenciales en filas de inventario numeradas y
 * verificadas. Determinista, sin llamada a modelo, sin crear extracciones.
 */
export async function classifyCredentialInventory(
  tx: TransactionClient,
  slots: SourceExtractionSlotService,
  credentials: readonly InventoryCredential[]
): Promise<InventoryRow[]> {
  const rows: InventoryRow[] = [];
  for (const credential of credentials) {
    rows.push(...(await classifyCredential(tx, slots, credential)));
  }

  // Los `src_NN` se asignan DESPUÉS de clasificar todo, sobre el orden estable
  // de credenciales: así no dependen de en qué orden se resolvieron las
  // verificaciones.
  const numbered = assignRunLocalSourceIds(rows);
  for (const row of numbered) {
    assertInventoryRowShape(row);
  }
  return numbered;
}

export function isBlockedDisposition(disposition: ReasoningRunInventoryDisposition): boolean {
  return (
    disposition === D.BLOCKED_EXTRACTION_UNAVAILABLE ||
    disposition === D.BLOCKED_EXTRACTION_INTEGRITY_FAILURE
  );
}

async function classifyCredential(
  tx: TransactionClient,
  slots: SourceExtractionSlotService,
  credential: InventoryCredential
): Promise<InventoryRow[]> {
  // La credencial queda fuera ANTES de mirar sus fuentes: enumerarlas repetiría
  // N veces la misma causa. UNA fila por credencial excluida.
  if (credential.status === CredentialStatus.draft) {
    return [credentialLevelRow(credential.id, D.EXCLUDED_CREDENTIAL_STATE_DRAFT)];
  }
  if (credential.status === CredentialStatus.revoked) {
    return [credentialLevelRow(credential.id, D.EXCLUDED_CREDENTIAL_STATE_REVOKED)];
  }

  const rows: InventoryRow[] = [];

  // `replaced` queda VISIBLE como superseded, nunca como grounding.
  for (const document of credential.documentEvidences) {
    if (document.status === DocumentEvidenceStatus.replaced) {
      rows.push(
        sourceLevelRow(credential.id, D.EXCLUDED_SOURCE_SUPERSEDED, {
          documentEvidenceId: document.id,
          textEvidenceId: null,
          sourceSha256: authoritativeSha(document.sha256)
        })
      );
    }
  }
  for (const text of credential.textEvidences) {
    if (text.status === TextEvidenceStatus.replaced) {
      rows.push(
        sourceLevelRow(credential.id, D.EXCLUDED_SOURCE_SUPERSEDED, {
          documentEvidenceId: null,
          textEvidenceId: text.id,
          sourceSha256: authoritativeSha(text.sha256)
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
      document.kind === DocumentEvidenceKind.pdf && document.mimeType === PDF_MIME_TYPE
  );

  // Un documento vigente que no es PDF soportado NO bloquea al texto: se
  // clasifica como tipo no soportado y la selección sigue entre lo que V1
  // efectivamente soporta. Es lo que ya hace `hasCurrentPdf`.
  for (const document of currentDocuments) {
    if (document === eligiblePdf) continue;
    rows.push(
      sourceLevelRow(credential.id, D.EXCLUDED_UNSUPPORTED_TYPE, {
        documentEvidenceId: document.id,
        textEvidenceId: null,
        sourceSha256: authoritativeSha(document.sha256)
      })
    );
  }

  let primary: PrimarySource | null = null;

  if (eligiblePdf) {
    primary = {
      documentEvidenceId: eligiblePdf.id,
      textEvidenceId: null,
      sourceSha256: authoritativeSha(eligiblePdf.sha256)
    };
    // Con PDF elegible, el texto vigente es la representación alterna: queda
    // EXCLUIDA pero VISIBLE. No se le crea extracción ni se le bindea una
    // histórica.
    for (const text of currentTexts) {
      rows.push(
        sourceLevelRow(credential.id, D.EXCLUDED_ALTERNATE_REPRESENTATION, {
          documentEvidenceId: null,
          textEvidenceId: text.id,
          sourceSha256: authoritativeSha(text.sha256)
        })
      );
    }
  } else if (currentTexts.length > 0) {
    const [selectedText, ...rest] = currentTexts;
    primary = {
      documentEvidenceId: null,
      textEvidenceId: selectedText.id,
      sourceSha256: authoritativeSha(selectedText.sha256)
    };
    // El índice único parcial deja a lo sumo un TextEvidence current por
    // credencial, así que `rest` está vacío en el dominio real. Se clasifica
    // igual en vez de descartarlo en silencio.
    for (const text of rest) {
      rows.push(
        sourceLevelRow(credential.id, D.EXCLUDED_ALTERNATE_REPRESENTATION, {
          documentEvidenceId: null,
          textEvidenceId: text.id,
          sourceSha256: authoritativeSha(text.sha256)
        })
      );
    }
  }

  if (primary) {
    rows.push(await bindPrimarySource(tx, slots, credential.id, primary));
  }

  // Sólo si la credencial no produjo NINGUNA fila source-level. Si tiene
  // fuentes `replaced`, esas filas ya hacen observable la ausencia de grounding
  // y agregar otra grabaría dos veces el mismo hecho.
  if (rows.length === 0) {
    return [credentialLevelRow(credential.id, D.EXCLUDED_NO_GROUNDING_SOURCE)];
  }

  return rows;
}

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
async function bindPrimarySource(
  tx: TransactionClient,
  slots: SourceExtractionSlotService,
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
    // No existe representación estructuralmente presente. NO se crea una: el
    // freeze congela lo que hay. Llamar a F1.4 acá sería fabricar el input que
    // se está auditando.
    return sourceLevelRow(credentialId, D.BLOCKED_EXTRACTION_UNAVAILABLE, primary);
  }

  const blockedByIntegrity = (): InventoryRow => ({
    ...sourceLevelRow(credentialId, D.BLOCKED_EXTRACTION_INTEGRITY_FAILURE, primary),
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
  const sameSha = candidate.sourceSha256.toLowerCase() === primary.sourceSha256;

  if (!sameEntity || !sameCredential || !sameSha) {
    return blockedByIntegrity();
  }

  let verified;
  try {
    verified = slots.verifyReadExtractionSlot(candidate.id, candidate as RawSlot);
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
    ...sourceLevelRow(credentialId, D.INCLUDED, primary),
    selectedAnalysisRunSourceId: candidate.id,
    artifactBlobSha256: verified.artifactBlobSha256
  };
}

/**
 * El SHA autoritativo es el de la entidad de evidencia, en minúscula.
 *
 * Es EXACTAMENTE la misma derivación que ya usa `AnalysisRunService.toSource`
 * (`evidence.sha256.toLowerCase()`) y que `AnalysisRunExecutionService` compara.
 * No se recorta, no se re-normaliza, no se hashea un wrapper JSON y no se
 * inventa una convención nueva.
 */
function authoritativeSha(sha256: string): string {
  return sha256.toLowerCase();
}

function credentialLevelRow(
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

function sourceLevelRow(
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
function assignRunLocalSourceIds(rows: readonly InventoryRow[]): InventoryRow[] {
  let index = 0;
  return rows.map((row) => {
    if (row.disposition !== D.INCLUDED) return row;
    index += 1;
    return { ...row, runLocalSourceId: `src_${String(index).padStart(2, '0')}` };
  });
}
