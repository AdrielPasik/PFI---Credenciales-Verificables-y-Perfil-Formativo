import type {
  AnalyzedObjectiveSnapshot,
  CreateObjectiveRequestBody,
  ObjectiveDetailVM,
  ObjectiveProposalCandidateVM,
  ObjectiveProposalRequestBody,
  ObjectiveProposalVM,
  ObjectiveReviewDraft,
  RequirementProvenanceKind,
  ReviewItem
} from '@/types/objectives';

/**
 * Núcleo puro de la revisión de Objetivos.
 *
 * Acá vive la ÚNICA regla de procedencia del cliente móvil. Ningún componente
 * la reimplementa: si estuviera en dos lugares se desincronizarían, y el
 * resultado sería afirmar un respaldo documental que nadie verificó.
 *
 * También viven acá las DOS fronteras de tamaño, que son distintas y ambas
 * reales:
 *
 *   1. SEMÁNTICA   60.000 code points de `rawObjectiveText` (lo que entra en
 *                  una sola llamada al proveedor, validado por el backend en
 *                  `objective-requirement-proposal.contract.ts`)
 *   2. TRANSPORTE  102.400 bytes del cuerpo HTTP serializado (límite por
 *                  defecto de body-parser en el backend)
 *
 * La segunda importa sobre todo al CONFIRMAR: el cuerpo de creación lleva el
 * texto original COMPLETO más cada `requirementText` más cada `sourceQuote`,
 * así que puede superar el límite aunque el objetivo por sí solo entrara.
 *
 * Nada de esto trunca, normaliza ni comprime. Si no entra, no se envía y se le
 * dice a la persona.
 */

/** Límite semántico del backend, medido en code points Unicode. */
export const MAX_OBJECTIVE_CODE_POINTS = 60_000;

/** Límite de transporte del backend (default de body-parser: 100 KiB). */
export const MAX_REQUEST_BODY_BYTES = 102_400;

export const MAX_TITLE_LENGTH = 500;

/**
 * Cuenta CODE POINTS, no unidades UTF-16.
 *
 * `"ab".length` y `Array.from("ab").length` coinciden para ASCII, pero un emoji
 * fuera del BMP pesa 2 unidades UTF-16 y 1 code point. El backend cuenta code
 * points; usar `.length` rechazaría textos que sí entran.
 */
export function countCodePoints(text: string): number {
  // El iterador de string recorre code points; se consume sin materializar un
  // array intermedio, que para 60.000 caracteres sería una copia entera.
  let count = 0;
  const iterator = text[Symbol.iterator]();
  while (!iterator.next().done) count += 1;
  return count;
}

/**
 * Longitud en bytes UTF-8 de una cadena, sin depender de `TextEncoder`.
 *
 * Hermes expone `TextEncoder`, pero calcularlo acá elimina la dependencia de un
 * global del runtime en la validación que decide si una petición se envía o no,
 * y hace que el guard sea testeable sin polyfills. La aritmética es la
 * definición de UTF-8, no una aproximación.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }

  return bytes;
}

/** Tamaño real del cuerpo HTTP que se va a enviar, en bytes UTF-8. */
export function serializedByteLength(payload: unknown): number {
  return utf8ByteLength(JSON.stringify(payload));
}

/** Corta por code points. `slice` desplazaría todo tras un carácter astral. */
export function sliceByCodePoints(
  text: string,
  start: number,
  end: number
): string {
  return Array.from(text).slice(start, end).join('');
}

/**
 * Parte el texto en tres para resaltar un rango, en code points.
 *
 * Se recorre una sola vez: para un objetivo de 60.000 code points, tres
 * `Array.from` separados serían tres copias completas.
 */
export function splitAroundRange(
  text: string,
  start: number,
  end: number
): { before: string; highlighted: string; after: string } {
  const points = Array.from(text);
  return {
    before: points.slice(0, start).join(''),
    highlighted: points.slice(start, end).join(''),
    after: points.slice(end).join('')
  };
}

// ---------------------------------------------------------------------------
// Construcción del borrador
// ---------------------------------------------------------------------------

let localKeyCounter = 0;

/** Identidad local. No es el `candidateId` y nunca viaja al servidor. */
export function nextLocalKey(): string {
  localKeyCounter += 1;
  return `item_${localKeyCounter}`;
}

function proposedItem(candidate: ObjectiveProposalCandidateVM): ReviewItem {
  return {
    localKey: nextLocalKey(),
    candidateId: candidate.candidateId,
    text: candidate.proposedRequirementText,
    originalProposedText: candidate.proposedRequirementText,
    origin: 'PROPOSED',
    wasEverEdited: false,
    primaryExcerpt: candidate.primaryExcerpt,
    excerptRange: candidate.excerptRange,
    grounding: candidate.grounding,
    confirmableAsSourceDerived: candidate.confirmableAsSourceDerived,
    sourceSectionLabel: candidate.sourceSectionLabel,
    isExactDuplicate: candidate.isExactDuplicate
  };
}

export function buildReviewDraft(
  snapshot: AnalyzedObjectiveSnapshot,
  proposal: ObjectiveProposalVM
): ObjectiveReviewDraft {
  return {
    snapshot,
    items: proposal.candidates.map(proposedItem),
    // Un omitido es un candidato de la MISMA propuesta, anclado igual: si se
    // usa sin editar, conserva la procedencia derivada como cualquier otro.
    omittedItems: proposal.omittedCandidates.map(proposedItem),
    identifiedCount:
      proposal.candidates.length + proposal.omittedCandidates.length,
    originallyOmittedIds: proposal.omittedCandidates.map(
      (candidate) => candidate.candidateId
    ),
    nonFormativeConditions: proposal.nonFormativeConditions,
    unresolvedPassageCount: proposal.unresolvedPassageCount
  };
}

/** Igualdad de texto sin distinguir mayúsculas ni espacios. Solo compara. */
function sameText(left: string, right: string): boolean {
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  return collapse(left) === collapse(right);
}

/**
 * Si `candidate` ya está en `items`: mismo texto o misma cita en el original.
 * Evita que un reemplazo deje dos veces el mismo requisito.
 */
export function isAlreadyInList(
  items: readonly ReviewItem[],
  candidate: ReviewItem
): boolean {
  return items.some(
    (item) =>
      sameText(item.text, candidate.text) ||
      (item.excerptRange !== null &&
        candidate.excerptRange !== null &&
        item.excerptRange.start === candidate.excerptRange.start &&
        item.excerptRange.end === candidate.excerptRange.end)
  );
}

/**
 * Reemplaza un requisito de la lista por uno omitido, en la MISMA posición.
 *
 * La cantidad no cambia, así que funciona con la lista llena. El que sale vuelve
 * a los omitidos (salvo que esté en blanco), con sus ediciones.
 */
export function replaceWithOmittedItem(
  draft: ObjectiveReviewDraft,
  omittedKey: string,
  targetKey: string
): ObjectiveReviewDraft {
  const incoming = draft.omittedItems.find(
    (candidate) => candidate.localKey === omittedKey
  );
  const index = draft.items.findIndex((item) => item.localKey === targetKey);
  const outgoing = draft.items[index];
  if (incoming === undefined || outgoing === undefined) return draft;
  const others = draft.items.filter((_, position) => position !== index);
  if (isAlreadyInList(others, incoming)) return draft;

  const items = [...draft.items];
  items[index] = incoming;
  const omittedItems = draft.omittedItems.filter(
    (candidate) => candidate.localKey !== omittedKey
  );
  if (outgoing.text.trim().length > 0) omittedItems.push(outgoing);
  return { ...draft, items, omittedItems };
}

/**
 * Pasa un requisito omitido a la lista de revisión, al final.
 *
 * Respeta el tope: con la lista llena no hace nada —la persona tiene que
 * eliminar uno primero—. Nunca reemplaza en silencio a otro requisito.
 */
export function takeOmittedItem(
  draft: ObjectiveReviewDraft,
  localKey: string
): ObjectiveReviewDraft {
  if (draft.items.length >= MAX_OBJECTIVE_REQUIREMENTS) return draft;
  const item = draft.omittedItems.find(
    (candidate) => candidate.localKey === localKey
  );
  if (item === undefined || isAlreadyInList(draft.items, item)) return draft;
  return {
    ...draft,
    items: [...draft.items, item],
    omittedItems: draft.omittedItems.filter(
      (candidate) => candidate.localKey !== localKey
    )
  };
}

export function createManualItem(): ReviewItem {
  return {
    localKey: nextLocalKey(),
    candidateId: null,
    text: '',
    originalProposedText: null,
    origin: 'MANUAL',
    wasEverEdited: false,
    primaryExcerpt: null,
    excerptRange: null,
    grounding: null,
    confirmableAsSourceDerived: false,
    sourceSectionLabel: null,
    isExactDuplicate: false
  };
}

/**
 * Aplica una edición de texto y marca la bandera monotónica.
 *
 * La comparación es estricta contra el texto propuesto ORIGINAL. Sin trim, sin
 * normalizar, sin equivalencia semántica: cualquiera de esas transformaciones
 * sería el juicio que el producto evitó a propósito.
 */
export function applyTextEdit(item: ReviewItem, nextText: string): ReviewItem {
  if (nextText === item.text) return item;

  const becameEdited =
    item.wasEverEdited ||
    (item.origin === 'PROPOSED' && nextText !== item.originalProposedText);

  return { ...item, text: nextText, wasEverEdited: becameEdited };
}

// ---------------------------------------------------------------------------
// Procedencia — la regla, en un solo lugar
// ---------------------------------------------------------------------------

export interface MappedRequirement {
  requirementText: string;
  provenanceKind: RequirementProvenanceKind;
  sourceQuote: string | null;
}

/**
 * Decide cómo se confirma UN item.
 *
 * El backend NO puede verificar esto: sólo comprueba que `sourceQuote` sea
 * subcadena literal del texto original, y nunca compara `requirementText`
 * contra la propuesta (no la tiene, es transitoria). La honestidad epistémica
 * depende de esta función.
 *
 * Reordenar NO entra en la decisión: la procedencia viaja con el item y el
 * servidor deriva `order` de la posición final del array.
 */
export function mapReviewItemToRequirement(item: ReviewItem): MappedRequirement {
  const direct: MappedRequirement = {
    requirementText: item.text,
    provenanceKind: 'DIRECT_STRUCTURED_INPUT',
    sourceQuote: null
  };

  if (item.origin === 'MANUAL') return direct;
  if (item.wasEverEdited) return direct;
  if (!item.confirmableAsSourceDerived) return direct;
  if (item.primaryExcerpt === null) return direct;

  return {
    requirementText: item.text,
    provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
    // La cita primaria, literal. NUNCA se concatenan excerpts: el resultado no
    // sería subcadena del original y el backend lo rechazaría.
    sourceQuote: item.primaryExcerpt
  };
}

// ---------------------------------------------------------------------------
// Cuerpos de petición
// ---------------------------------------------------------------------------

export function buildProposalRequestBody(input: {
  objectiveType: AnalyzedObjectiveSnapshot['objectiveType'];
  title: string;
  rawObjectiveText: string;
}): ObjectiveProposalRequestBody {
  return {
    objectiveType: input.objectiveType,
    title: input.title,
    // Verbatim. Sin trim, sin NFC, sin reescribir fines de línea.
    rawObjectiveText: input.rawObjectiveText
  };
}

export function buildCreateObjectiveBody(
  draft: ObjectiveReviewDraft
): CreateObjectiveRequestBody {
  return {
    objectiveType: draft.snapshot.objectiveType,
    title: draft.snapshot.title,
    // El título ya es metadata de fila: duplicarlo acá crearía dos títulos.
    objectiveContext: '',
    source: {
      inputType: 'PASTED_TEXT',
      // Del SNAPSHOT, nunca del campo de entrada: es el texto contra el que se
      // verificaron las citas.
      originalText: draft.snapshot.rawObjectiveText
    },
    requirements: draft.items.map(mapReviewItemToRequirement)
  };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export type IntakeValidationCode =
  | 'OBJECTIVE_TYPE_REQUIRED'
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'TEXT_REQUIRED'
  | 'TEXT_TOO_MANY_CODE_POINTS'
  | 'REQUEST_BODY_TOO_LARGE';

export function validateIntake(input: {
  objectiveType: AnalyzedObjectiveSnapshot['objectiveType'] | null;
  title: string;
  rawObjectiveText: string;
}): IntakeValidationCode | null {
  if (input.objectiveType === null) return 'OBJECTIVE_TYPE_REQUIRED';
  if (input.title.trim().length === 0) return 'TITLE_REQUIRED';
  if (countCodePoints(input.title) > MAX_TITLE_LENGTH) return 'TITLE_TOO_LONG';
  if (input.rawObjectiveText.trim().length === 0) return 'TEXT_REQUIRED';
  if (countCodePoints(input.rawObjectiveText) > MAX_OBJECTIVE_CODE_POINTS) {
    return 'TEXT_TOO_MANY_CODE_POINTS';
  }

  // El límite de transporte se mide sobre el cuerpo REAL que se va a enviar, no
  // sobre el texto suelto: las comillas, el escapado JSON y los otros campos
  // también ocupan.
  const body = buildProposalRequestBody({
    objectiveType: input.objectiveType,
    title: input.title,
    rawObjectiveText: input.rawObjectiveText
  });

  if (serializedByteLength(body) > MAX_REQUEST_BODY_BYTES) {
    return 'REQUEST_BODY_TOO_LARGE';
  }

  return null;
}

export type ConfirmValidationCode =
  | 'NO_REQUIREMENTS'
  | 'TOO_MANY_REQUIREMENTS'
  | 'BLANK_REQUIREMENT'
  | 'REQUEST_BODY_TOO_LARGE';

/**
 * Tope de requisitos de un objetivo. Es el MISMO que aplica el servidor
 * (`MAX_OBJECTIVE_REQUIREMENTS` en la API): el razonamiento hace una llamada al
 * modelo por requisito, en serie, y sin tope un aviso largo producia analisis de
 * mas de 10 minutos. Es un tope, no una meta.
 */
export const MAX_OBJECTIVE_REQUIREMENTS = 15;

/**
 * Cuerpo de un objetivo NUEVO con un subconjunto de los requisitos de otro.
 *
 * Para objetivos guardados antes del tope de 15. Cada requisito viaja EXACTO
 * (texto, procedencia y cita) en el orden del original, junto con el mismo
 * texto original, así las citas siguen siendo subcadena literal.
 */
export function buildSubsetObjectiveBody(
  objective: ObjectiveDetailVM,
  selectedRequirementIds: readonly string[]
): CreateObjectiveRequestBody {
  const chosen = new Set(selectedRequirementIds);
  return {
    objectiveType: objective.objectiveType,
    title: objective.title,
    objectiveContext: objective.objectiveContext,
    source: {
      inputType:
        objective.sourceInputType === 'DIRECT_STRUCTURED_INPUT'
          ? 'DIRECT_STRUCTURED_INPUT'
          : 'PASTED_TEXT',
      originalText: objective.sourceOriginalText
    },
    requirements: objective.requirements
      .filter((requirement) => chosen.has(requirement.requirementId))
      .map((requirement) => ({
        requirementText: requirement.requirementText,
        provenanceKind: requirement.provenanceKind,
        sourceQuote: requirement.sourceQuote
      }))
  };
}

export interface ConfirmValidationResult {
  code: ConfirmValidationCode;
  /** Item que hay que enfocar, cuando aplica. */
  localKey?: string;
}

export function validateConfirm(
  draft: ObjectiveReviewDraft
): ConfirmValidationResult | null {
  if (draft.items.length === 0) return { code: 'NO_REQUIREMENTS' };
  if (draft.items.length > MAX_OBJECTIVE_REQUIREMENTS) {
    return { code: 'TOO_MANY_REQUIREMENTS' };
  }

  const blank = draft.items.find((item) => item.text.trim().length === 0);
  if (blank) return { code: 'BLANK_REQUIREMENT', localKey: blank.localKey };

  // Se mide el cuerpo REAL de creación, que lleva el texto original completo MÁS
  // cada requirementText MÁS cada sourceQuote. Puede pasarse aunque el objetivo
  // solo sí entrara.
  if (
    serializedByteLength(buildCreateObjectiveBody(draft)) >
    MAX_REQUEST_BODY_BYTES
  ) {
    return { code: 'REQUEST_BODY_TOO_LARGE' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/**
 * Limpia el encabezado markdown para mostrarlo.
 *
 * SÓLO presentación: `sourceSectionLabel` no viaja al backend, así que
 * limpiarlo no tiene consecuencia epistémica.
 */
export function formatSectionLabel(label: string | null): string | null {
  if (label === null) return null;
  const cleaned = label.replace(/^#+\s*/, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function summarizeReview(
  draft: ObjectiveReviewDraft,
  proposedCount: number
): string {
  const remaining = draft.items.length;
  const manual = draft.items.filter((item) => item.origin === 'MANUAL').length;
  // Los omitidos que se usaron cuentan aparte: no son de los propuestos, y
  // contarlos como tales escondería las eliminaciones.
  const usedStillPresent = draft.items.filter(
    (item) =>
      item.candidateId !== null &&
      draft.originallyOmittedIds.includes(item.candidateId)
  ).length;
  const removed = proposedCount - (remaining - manual - usedStillPresent);

  const parts = [`${proposedCount} propuestos`, `${remaining} quedan`];
  if (removed > 0) parts.push(`${removed} eliminados`);
  if (usedStillPresent > 0) {
    parts.push(`${usedStillPresent} sumados de los omitidos`);
  }
  if (manual > 0) parts.push(`${manual} agregados`);
  return parts.join(' · ');
}

/**
 * Aviso de selección, o `null` si no hubo. Sin puntajes ni ranking: la
 * selección es una propuesta más, que la persona puede cambiar.
 */
export function describeSelection(
  draft: ObjectiveReviewDraft,
  proposedCount: number
): string | null {
  if (draft.identifiedCount <= proposedCount) return null;
  return `Scope identificó ${draft.identifiedCount} requisitos y seleccionó los ${proposedCount} más relevantes para el análisis, que admite hasta ${MAX_OBJECTIVE_REQUIREMENTS}. Podés cambiar cualquiera por uno de los que quedaron afuera.`;
}
