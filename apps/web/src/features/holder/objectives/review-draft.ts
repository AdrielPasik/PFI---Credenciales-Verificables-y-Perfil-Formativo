/**
 * Nucleo puro de la revision de Objetivos — P2.3.
 *
 * Aca vive la UNICA regla de procedencia del frontend. Ningun componente la
 * reimplementa: si estuviera en dos lugares, se desincronizarian y el resultado
 * seria afirmar un respaldo documental que nadie verifico.
 *
 * Tambien viven aca las DOS fronteras de tamano, que son distintas y ambas
 * reales:
 *
 *   1. SEMANTICA   60.000 code points de `rawObjectiveText` (limite de P2.2:
 *                  lo que entra en una sola llamada al proveedor)
 *   2. TRANSPORTE  102.400 bytes del cuerpo HTTP serializado (limite por
 *                  defecto de body-parser en el backend)
 *
 * La segunda importa sobre todo al CONFIRMAR: el cuerpo de creacion lleva el
 * texto original COMPLETO mas cada `requirementText` mas cada `sourceQuote`, asi
 * que puede superar el limite aunque el objetivo por si solo entrara.
 *
 * Nada de esto trunca, normaliza ni comprime. Si no entra, no se envia y se le
 * dice a la persona.
 */

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
} from '@/models/objectives';

/** Limite semantico de P2.2, medido en code points Unicode. */
export const MAX_OBJECTIVE_CODE_POINTS = 60_000;

/**
 * Limite de transporte del backend.
 *
 * `services/api/src/main.ts` no configura `bodyParser`, asi que rige el default
 * de Express: 100 KiB. Auditado, no supuesto.
 */
export const MAX_REQUEST_BODY_BYTES = 102_400;

/**
 * Cuenta CODE POINTS, no unidades UTF-16.
 *
 * `"ab".length` y `Array.from("ab").length` coinciden para texto ASCII, pero un
 * emoji fuera del BMP pesa 2 unidades UTF-16 y 1 code point. El backend cuenta
 * code points; usar `.length` rechazaria textos que si entran.
 */
export function countCodePoints(text: string): number {
  // El iterador de string recorre code points; se consume sin materializar un
  // array intermedio, que para 60.000 caracteres seria una copia entera.
  let count = 0;
  const iterator = text[Symbol.iterator]();
  while (!iterator.next().done) count += 1;
  return count;
}

/** Tamano real del cuerpo HTTP que se va a enviar, en bytes UTF-8. */
export function serializedByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

/** Corta por code points. `slice` desplazaria todo tras un caracter astral. */
export function sliceByCodePoints(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join('');
}

/**
 * Parte el texto en tres para resaltar un rango, en code points.
 *
 * Se recorre una sola vez: para un objetivo de 60.000 code points, tres
 * `Array.from` separados serian tres copias completas.
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
// Construccion del borrador
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
    // Un omitido es un candidato de la MISMA propuesta, anclado igual: si se usa
    // sin editar, conserva la procedencia derivada como cualquier otro.
    omittedItems: proposal.omittedCandidates.map(proposedItem),
    identifiedCount: proposal.candidates.length + proposal.omittedCandidates.length,
    originallyOmittedIds: proposal.omittedCandidates.map((candidate) => candidate.candidateId),
    nonFormativeConditions: proposal.nonFormativeConditions,
    unresolvedPassageCount: proposal.unresolvedPassageCount
  };
}

/** Igualdad de texto sin distinguir mayusculas, acentos ni espacios. Solo compara. */
function sameText(left: string, right: string): boolean {
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  return collapse(left).localeCompare(collapse(right), 'es', { sensitivity: 'base' }) === 0;
}

/**
 * Si `candidate` ya esta en `items`: mismo texto (sin distinguir mayusculas,
 * acentos ni espacios) o misma cita en el original. Evita que un reemplazo deje
 * dos veces el mismo requisito.
 */
export function isAlreadyInList(items: readonly ReviewItem[], candidate: ReviewItem): boolean {
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
 * Pasa un requisito omitido a la lista de revision, al final.
 *
 * Respeta el tope: con la lista llena no hace nada --la persona tiene que
 * eliminar uno primero--. Nunca reemplaza en silencio a otro requisito.
 */
export function takeOmittedItem(
  draft: ObjectiveReviewDraft,
  localKey: string
): ObjectiveReviewDraft {
  if (draft.items.length >= MAX_OBJECTIVE_REQUIREMENTS) return draft;
  const item = draft.omittedItems.find((candidate) => candidate.localKey === localKey);
  if (item === undefined || isAlreadyInList(draft.items, item)) return draft;
  return {
    ...draft,
    items: [...draft.items, item],
    omittedItems: draft.omittedItems.filter((candidate) => candidate.localKey !== localKey)
  };
}

/**
 * Reemplaza un requisito de la lista por uno omitido, en la MISMA posicion.
 *
 * La cantidad no cambia, asi que funciona con la lista llena. El que sale vuelve
 * a los omitidos (salvo que este en blanco), con sus ediciones: no se pierde y
 * se puede volver a usar. El que entra conserva su cita y su procedencia.
 */
export function replaceWithOmittedItem(
  draft: ObjectiveReviewDraft,
  omittedKey: string,
  targetKey: string
): ObjectiveReviewDraft {
  const incoming = draft.omittedItems.find((candidate) => candidate.localKey === omittedKey);
  const index = draft.items.findIndex((item) => item.localKey === targetKey);
  if (incoming === undefined || index === -1) return draft;
  const others = draft.items.filter((_, position) => position !== index);
  if (isAlreadyInList(others, incoming)) return draft;

  const outgoing = draft.items[index];
  const items = [...draft.items];
  items[index] = incoming;
  const omittedItems = draft.omittedItems.filter((candidate) => candidate.localKey !== omittedKey);
  if (outgoing.text.trim().length > 0) omittedItems.push(outgoing);
  return { ...draft, items, omittedItems };
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
 * Aplica una edicion de texto y marca la bandera monotonica.
 *
 * La comparacion es estricta contra el texto propuesto ORIGINAL. Sin trim, sin
 * normalizar, sin equivalencia semantica: cualquiera de esas transformaciones
 * seria el juicio que P2.0 evito a proposito.
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
 * Decide como se confirma UN item.
 *
 * Replica `objective-requirement-proposal.f2-handoff.ts` del backend, que ya
 * esta probado alli. El backend NO puede verificar esto: solo comprueba que
 * `sourceQuote` sea subcadena literal del texto original, y nunca compara
 * `requirementText` contra la propuesta (no la tiene, es transitoria). La
 * honestidad epistemica depende de esta funcion.
 *
 * Reordenar NO entra en la decision: la procedencia viaja con el item y el
 * servidor deriva `order` de la posicion final del array.
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
    // seria subcadena del original y el backend lo rechazaria.
    sourceQuote: item.primaryExcerpt
  };
}

// ---------------------------------------------------------------------------
// Cuerpos de peticion
// ---------------------------------------------------------------------------

export function buildProposalRequestBody(input: {
  objectiveType: AnalyzedObjectiveSnapshot['objectiveType'];
  title: string;
  rawObjectiveText: string;
}): ObjectiveProposalRequestBody {
  return {
    objectiveType: input.objectiveType,
    title: input.title,
    // Verbatim. Sin trim, sin NFC, sin reescribir fines de linea.
    rawObjectiveText: input.rawObjectiveText
  };
}

export function buildCreateObjectiveBody(
  draft: ObjectiveReviewDraft
): CreateObjectiveRequestBody {
  return {
    objectiveType: draft.snapshot.objectiveType,
    title: draft.snapshot.title,
    // El titulo ya es metadata de fila. P2.0 congelo TITLE_AUTHORITY:
    // CONTEXT_ONLY, asi que duplicarlo aca crearia dos titulos.
    objectiveContext: '',
    source: {
      inputType: 'PASTED_TEXT',
      // Del SNAPSHOT, nunca del textarea: es el texto contra el que se
      // verificaron las citas.
      originalText: draft.snapshot.rawObjectiveText
    },
    requirements: draft.items.map(mapReviewItemToRequirement)
  };
}

/**
 * Cuerpo de un objetivo NUEVO con un subconjunto de los requisitos de otro.
 *
 * Para objetivos guardados antes del tope de 15. Cada requisito viaja EXACTO:
 * texto, procedencia y cita, en el orden del original. El texto original
 * tambien viaja igual, asi las citas siguen siendo subcadena literal. Nada se
 * recorta ni se reescribe.
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

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

export type IntakeValidationCode =
  | 'OBJECTIVE_TYPE_REQUIRED'
  | 'TITLE_REQUIRED'
  | 'TITLE_TOO_LONG'
  | 'TEXT_REQUIRED'
  | 'TEXT_TOO_MANY_CODE_POINTS'
  | 'REQUEST_BODY_TOO_LARGE';

export const MAX_TITLE_LENGTH = 500;

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

  // El limite de transporte se mide sobre el cuerpo REAL que se va a enviar, no
  // sobre el texto suelto: las comillas, el escapado JSON y los otros campos
  // tambien ocupan.
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

  // Se mide el cuerpo REAL de creacion, que lleva el texto original completo MAS
  // cada requirementText MAS cada sourceQuote. Puede pasarse aunque el objetivo
  // solo si entrara.
  if (serializedByteLength(buildCreateObjectiveBody(draft)) > MAX_REQUEST_BODY_BYTES) {
    return { code: 'REQUEST_BODY_TOO_LARGE' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presentacion
// ---------------------------------------------------------------------------

/**
 * Limpia el encabezado markdown para mostrarlo.
 *
 * SOLO presentacion: `sourceSectionLabel` no viaja a F2, asi que limpiarlo no
 * tiene consecuencia epistemica. Los valores reales del smoke son
 * "## Requisitos", "## Conocimientos valorados".
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
    (item) => item.candidateId !== null && draft.originallyOmittedIds.includes(item.candidateId)
  ).length;
  const removed = proposedCount - (remaining - manual - usedStillPresent);

  const parts = [`${proposedCount} propuestos`, `${remaining} quedan`];
  if (removed > 0) parts.push(`${removed} eliminados`);
  if (usedStillPresent > 0) parts.push(`${usedStillPresent} sumados de los omitidos`);
  if (manual > 0) parts.push(`${manual} agregados`);
  return parts.join(' · ');
}

/**
 * Aviso de seleccion, o `null` si no hubo.
 *
 * Dice cuantos se identificaron y cuantos se eligieron, sin puntajes ni ranking:
 * la seleccion es una propuesta mas, que la persona puede cambiar.
 */
export function describeSelection(
  draft: ObjectiveReviewDraft,
  proposedCount: number
): string | null {
  if (draft.identifiedCount <= proposedCount) return null;
  return `Scope identificó ${draft.identifiedCount} requisitos y seleccionó los ${proposedCount} más relevantes para el análisis, que admite hasta ${MAX_OBJECTIVE_REQUIREMENTS}. Podés cambiar cualquiera por uno de los que quedaron afuera.`;
}
