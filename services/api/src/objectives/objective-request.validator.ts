/**
 * Validador estricto del request de `/me/objectives` — slice F2.2.
 *
 * POR QUE ESCRITO A MANO, y no un `ValidationPipe`.
 *
 * Auditado: este repo NO tiene `ValidationPipe` global —`main.ts` no registra
 * ninguno— y NO tiene `class-validator` ni `class-transformer` instalados. Su
 * convencion real es validar con funciones propias que rechazan explicitamente
 * los campos que no pertenecen al contrato publico; el precedente directo es
 * `create-credential-draft.validator.ts`, que ya mantiene una lista de campos
 * internos/relacionales prohibidos y un allowlist de los permitidos.
 *
 * Asi que no hacia falta ni cambiar la politica global de la aplicacion ni sumar
 * una dependencia: la solucion acotada y con precedente es esta.
 *
 * LA FRONTERA HTTP ES ESTRICTA. Un campo desconocido se RECHAZA, no se ignora en
 * silencio. Que el builder interno tambien los ignore es defensa en profundidad,
 * no la politica: si el borde fuera permisivo, un cliente podria creer que mando
 * `qualifiers` o `requirementId` y que el servidor los tuvo en cuenta.
 *
 * LO QUE ESTE VALIDADOR NO HACE. No comprueba la semantica profunda —que
 * `sourceQuote` este literalmente contenido en `originalText`, que el orden sea
 * consecutivo, que haya al menos un Requirement—. Esa autoridad es UNA SOLA y
 * vive en F2.1 (`objective-definition.validator.ts`). Duplicarla aqui crearia
 * dos verdades que se pueden desincronizar.
 *
 * Y NO TRANSFORMA NADA. Ni trim, ni NFC, ni fines de linea, ni colapso de
 * espacios: F2.1 preserva estos strings literalmente y la verificacion de citas
 * depende de esa literalidad.
 */

import { BadRequestException } from '@nestjs/common';

import {
  OBJECTIVE_SOURCE_INPUT_TYPES,
  OBJECTIVE_TYPES,
  REQUIREMENT_PROVENANCE_KINDS
} from './objective-definition.types';
import {
  type CreateObjectiveRequestDto,
  type ObjectiveRequirementRequestDto
} from './dto/objective.dto';
import { type ObjectiveDefinitionInput } from './objective-definition.builder';

const ROOT_KEYS = new Set([
  'objectiveType',
  'title',
  'objectiveContext',
  'source',
  'requirements'
]);
const SOURCE_KEYS = new Set(['inputType', 'originalText']);
const REQUIREMENT_KEYS = new Set(['requirementText', 'provenanceKind', 'sourceQuote']);

/**
 * Campos que el SERVIDOR posee y el cliente no puede aportar.
 *
 * Se nombran para poder dar un mensaje util —"esto lo pone el servidor"— en vez
 * del generico de campo desconocido. Se rechazan igual, pero el motivo importa:
 * quien manda `requirementId` no escribio mal una clave, se equivoco de modelo.
 */
const SERVER_OWNED_KEYS = new Set([
  'schemaVersion',
  'requirementId',
  'order',
  'qualifiers',
  'definition',
  'status',
  'supersedesObjectiveId',
  'createdAt',
  'id'
]);

/** Autoridad: sale del token, nunca del request. */
const AUTHORITY_KEYS = new Set([
  'ownerUserId',
  'userId',
  'holderId',
  'subjectUserId',
  'issuerId'
]);

/** Fronteras epistemicas ya congeladas por F2.0/F2.1. */
const FORBIDDEN_DOMAIN_KEYS = new Set([
  'credentialId',
  'credentialIds',
  'evidenceId',
  'evidenceIds',
  'evidenceUnits',
  'analysisRunId',
  'epistemicTarget',
  'epistemicTargetRationale',
  'atomicity',
  'evaluability',
  'objectiveAnalysisStatus',
  'decompositionStatus',
  'facets',
  'requirementFacets'
]);

function fail(message: string): never {
  throw new BadRequestException(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rechaza toda clave que no pertenezca al contrato, dando el motivo real.
 *
 * El orden de los chequeos importa: `qualifiers` tambien es "desconocida", pero
 * decirlo asi perderia la explicacion de por que no puede mandarse.
 */
function assertOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (SERVER_OWNED_KEYS.has(key)) {
      fail(`${path}.${key} lo establece el servidor y no puede enviarse.`);
    }
    if (AUTHORITY_KEYS.has(key)) {
      fail(`${path}.${key} no puede enviarse: la identidad sale del token.`);
    }
    if (FORBIDDEN_DOMAIN_KEYS.has(key)) {
      fail(`${path}.${key} no forma parte del contrato de un Objective.`);
    }
    if (!allowed.has(key)) {
      fail(`${path}.${key} no forma parte del contrato publico.`);
    }
  }
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(`${path} debe ser un string.`);
  }
  return value;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const text = expectString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    fail(`${path} debe ser uno de: ${allowed.join(', ')}.`);
  }
  return text as T;
}

/**
 * Valida la forma del request y lo mapea al input del builder de F2.1.
 *
 * Devuelve `{ title, definition }`, listo para
 * `ObjectivesService.createForUser` / `createRevisionForUser`. El controller no
 * construye ni valida artifacts: eso sigue siendo de F2.1.
 */
export function mapCreateObjectiveRequest(
  payload: unknown
): { title: string; definition: ObjectiveDefinitionInput } {
  if (!isPlainObject(payload)) {
    fail('El cuerpo de la peticion debe ser un objeto.');
  }
  assertOnlyAllowedKeys(payload, ROOT_KEYS, 'body');

  const dto = payload as unknown as CreateObjectiveRequestDto;

  const objectiveType = expectEnum(dto.objectiveType, OBJECTIVE_TYPES, 'body.objectiveType');
  // Se preserva EXACTAMENTE: sin trim. Si esta en blanco lo rechaza el service,
  // que es donde vive la regla del titulo.
  const title = expectString(dto.title, 'body.title');
  const objectiveContext = expectString(dto.objectiveContext, 'body.objectiveContext');

  if (!isPlainObject(dto.source)) {
    fail('body.source debe ser un objeto.');
  }
  assertOnlyAllowedKeys(dto.source as Record<string, unknown>, SOURCE_KEYS, 'body.source');

  const inputType = expectEnum(
    dto.source.inputType,
    OBJECTIVE_SOURCE_INPUT_TYPES,
    'body.source.inputType'
  );
  const originalText = dto.source.originalText;
  if (originalText !== null && typeof originalText !== 'string') {
    fail('body.source.originalText debe ser un string o null.');
  }

  if (!Array.isArray(dto.requirements)) {
    fail('body.requirements debe ser un array.');
  }

  const requirements = dto.requirements.map((item, index) => {
    const path = `body.requirements[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${path} debe ser un objeto.`);
    }
    assertOnlyAllowedKeys(item as Record<string, unknown>, REQUIREMENT_KEYS, path);

    const requirement = item as unknown as ObjectiveRequirementRequestDto;
    const sourceQuote = requirement.sourceQuote ?? null;
    if (sourceQuote !== null && typeof sourceQuote !== 'string') {
      fail(`${path}.sourceQuote debe ser un string o null.`);
    }

    return {
      requirementText: expectString(requirement.requirementText, `${path}.requirementText`),
      provenanceKind: expectEnum(
        requirement.provenanceKind,
        REQUIREMENT_PROVENANCE_KINDS,
        `${path}.provenanceKind`
      ),
      sourceQuote
    };
  });

  return {
    title,
    definition: {
      objectiveType,
      objectiveContext,
      sourceInputType: inputType,
      sourceOriginalText: originalText,
      requirements
      // `qualifiers` no se mapea porque no existe en el input del builder:
      // `objective_definition_v1` exige `[]` y lo emite el servidor.
    }
  };
}
