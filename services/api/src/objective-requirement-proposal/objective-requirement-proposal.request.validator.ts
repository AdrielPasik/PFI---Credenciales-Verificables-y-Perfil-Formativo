/**
 * Validación del request privado — slice P2.2.
 *
 * SUPERFICIE MÍNIMA Y CERRADA. Sólo tres campos. Cualquier clave extra se rechaza
 * en vez de ignorarse, y ésa es la diferencia entre una promesa y un invariante:
 * un cliente que mande `ownerUserId` recibe un error, no un silencio.
 *
 * EVIDENCE-BLIND POR CONSTRUCCIÓN. La lista de claves prohibidas es explícita para
 * que el mensaje diga POR QUÉ, pero el rechazo no depende de ella: cualquier clave
 * fuera de la allowlist cae igual.
 *
 * `ownerUserId` no se acepta ni se necesita: esta etapa no escribe nada, y la
 * identidad del holder sale del JWT como en todo `/me`.
 */

import { ObjectiveType } from '@prisma/client';

import {
  MAX_OBJECTIVE_CHARACTERS
} from './objective-requirement-proposal.contract';
import { ObjectiveRequirementProposalError } from './objective-requirement-proposal.errors';

export interface ObjectiveRequirementProposalInput {
  readonly objectiveType: ObjectiveType;
  readonly title: string;
  readonly rawObjectiveText: string;
}

const ALLOWED_KEYS = new Set(['objectiveType', 'title', 'rawObjectiveText']);

/** Claves que se nombran explícitamente porque su presencia revela una intención. */
const EXPLICITLY_FORBIDDEN_KEYS = [
  'ownerUserId',
  'userId',
  'holderId',
  'subjectUserId',
  'provider',
  'model',
  'requestedModel',
  'reasoningEffort',
  'promptVersion',
  'candidates',
  'candidateId',
  'credentials',
  'profile',
  'skills',
  'evidenceUnits',
  'reasoningRunId',
  'objectiveId'
];

const MAX_TITLE_LENGTH = 500;

function reject(detail: string): never {
  throw new ObjectiveRequirementProposalError('INVALID_OBJECTIVE_INPUT', detail);
}

export function mapObjectiveRequirementProposalRequest(
  body: unknown
): ObjectiveRequirementProposalInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    reject('body_not_an_object');
  }
  const record = body as Record<string, unknown>;

  for (const key of EXPLICITLY_FORBIDDEN_KEYS) {
    if (key in record) {
      reject(`forbidden_field:${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      reject(`unknown_field:${key}`);
    }
  }

  const objectiveType = record.objectiveType;
  if (
    typeof objectiveType !== 'string' ||
    !Object.values(ObjectiveType).includes(objectiveType as ObjectiveType)
  ) {
    reject('objective_type_invalid');
  }

  // El título puede faltar: es contexto de interpretación, no crea Requirements y
  // un Objective sin título es un caso legítimo.
  const rawTitle = record.title === undefined ? '' : record.title;
  if (typeof rawTitle !== 'string') {
    reject('title_not_a_string');
  }
  if (rawTitle.length > MAX_TITLE_LENGTH) {
    reject('title_too_long');
  }

  const rawObjectiveText = record.rawObjectiveText;
  if (typeof rawObjectiveText !== 'string') {
    reject('raw_objective_text_not_a_string');
  }
  if (rawObjectiveText.trim().length === 0) {
    reject('raw_objective_text_empty');
  }
  // Se mide en code points, que es la unidad congelada de los offsets.
  if (Array.from(rawObjectiveText).length > MAX_OBJECTIVE_CHARACTERS) {
    throw new ObjectiveRequirementProposalError(
      'OBJECTIVE_TOO_LARGE',
      'raw_objective_text_exceeds_single_call_budget'
    );
  }

  return {
    objectiveType: objectiveType as ObjectiveType,
    title: rawTitle,
    // SIN trim y SIN normalizar. El texto enviado es la única autoridad textual y
    // los offsets se calculan sobre él: tocarlo acá desalinearía cada referencia.
    rawObjectiveText
  };
}
