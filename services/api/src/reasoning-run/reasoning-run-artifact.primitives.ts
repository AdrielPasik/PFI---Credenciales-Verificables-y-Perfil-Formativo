/**
 * Primitivas compartidas por los tres validadores de artifact — slice F3.1.
 *
 * Escritas a mano, siguiendo la convencion del repo
 * (`source-extraction-artifact.validator.ts`,
 * `objective-definition.validator.ts`). Sin Ajv, sin Zod, sin dependencias
 * nuevas, aunque existan los JSON Schema en `packages/schemas/`: esos son el
 * contrato compartido con el futuro servicio de reasoning; estos son la puerta
 * de entrada a la persistencia.
 *
 * Cada `expect*` COPIA el valor, asi que el resultado que arma el llamante queda
 * desacoplado del input: mutar el input despues no puede afectar a lo verificado.
 */

import {
  failArtifact,
  type ReasoningRunArtifactCode
} from './reasoning-run-artifact.errors';

/**
 * Deliberacion interna del modelo. Prohibida en cualquier nivel de cualquier
 * artifact.
 *
 * La lista sale de los nombres que el prompt congelado ya prohibe emitir, mas
 * sus sinonimos habituales: el punto no es adivinar todos los nombres posibles
 * sino que los evidentes fallen con un error que diga POR QUE.
 */
const CHAIN_OF_THOUGHT_KEYS = new Set([
  'chainOfThought',
  'chain_of_thought',
  'scratchpad',
  'hiddenReasoning',
  'internalDeliberation',
  'modelThoughts',
  'thoughts',
  'reasoningTrace',
  'deliberation'
]);

/** Score global del Objective. Excluido explicitamente por la spec congelada. */
const GLOBAL_SCORE_KEYS = new Set([
  'globalScore',
  'objectiveScore',
  'score',
  'fitPercentage',
  'fitScore',
  'matchPercentage',
  'compatibilityScore',
  'rank',
  'ranking',
  'objectiveFinalState'
]);

/**
 * Campos que el contrato productivo retiro a proposito, cada uno con su razon en
 * `reasoning-run-artifact.types.ts`.
 */
const EXPERIMENTAL_ONLY_KEYS = new Set([
  'decompositionStatus',
  'candidateSegments',
  'ambiguityRationale',
  'requirementQuote',
  'objectiveContext',
  'originalObjective',
  'lineageId',
  'technicallyVerified',
  'continuityCore',
  'evaluationRole'
]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rechaza claves desconocidas y, ANTES, las cuatro familias prohibidas.
 *
 * El orden importa: `chainOfThought` tambien es "desconocida", pero informarlo
 * asi perderia la razon real del rechazo.
 */
export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (CHAIN_OF_THOUGHT_KEYS.has(key)) {
      failArtifact('CHAIN_OF_THOUGHT_FIELD_NOT_ALLOWED', {
        invariant: 'internal_model_deliberation_is_never_persisted',
        path: `${path}.${key}`,
        observed: key
      });
    }
    if (GLOBAL_SCORE_KEYS.has(key)) {
      failArtifact('GLOBAL_SCORE_FIELD_NOT_ALLOWED', {
        invariant: 'no_global_objective_score_or_percentage_exists',
        path: `${path}.${key}`,
        observed: key
      });
    }
    if (EXPERIMENTAL_ONLY_KEYS.has(key)) {
      failArtifact('EXPERIMENTAL_FIELD_NOT_ALLOWED', {
        invariant: 'field_belongs_to_the_experiment_not_to_the_product_contract',
        path: `${path}.${key}`,
        observed: key
      });
    }
    if (!allowed.has(key)) {
      failArtifact('UNKNOWN_PROPERTY', {
        invariant: 'artifact_declares_every_property_it_accepts',
        path: `${path}.${key}`,
        observed: key
      });
    }
  }
}

export function expectObject(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'value_must_be_a_plain_object',
      path
    });
  }
  return value;
}

export function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    failArtifact('SCHEMA_INVALID', { invariant: 'value_must_be_an_array', path });
  }
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    failArtifact('SCHEMA_INVALID', { invariant: 'value_must_be_a_string', path });
  }
  return value;
}

export function expectNonBlankString(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (text.trim().length === 0) {
    failArtifact('TEXT_EMPTY', {
      invariant: 'required_text_must_not_be_blank',
      path
    });
  }
  return text;
}

/** Texto que puede ser legitimamente vacio: `contextBefore` al inicio de una fuente. */
export function expectPossiblyEmptyString(value: unknown, path: string): string {
  return expectString(value, path);
}

export function expectNullableNonBlankString(
  value: unknown,
  path: string
): string | null {
  if (value === null) return null;
  return expectNonBlankString(value, path);
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'value_must_be_a_boolean',
      path
    });
  }
  return value;
}

export function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    failArtifact('SPAN_INVALID', {
      invariant: 'value_must_be_a_non_negative_safe_integer',
      path
    });
  }
  return value;
}

export function expectNullableNonNegativeInteger(
  value: unknown,
  path: string
): number | null {
  if (value === null) return null;
  return expectNonNegativeInteger(value, path);
}

export function expectEnum<T extends string>(
  value: unknown,
  tokens: readonly T[],
  path: string
): T {
  const text = expectString(value, path);
  if (!(tokens as readonly string[]).includes(text)) {
    failArtifact('ENUM_TOKEN_UNSUPPORTED', {
      invariant: 'token_must_belong_to_the_frozen_vocabulary',
      path,
      // Seguro: es un token de un enum cerrado o basura corta. Se acota para que
      // un string enorme no termine en un log por la puerta de atras.
      observed: text.slice(0, 64)
    });
  }
  return text as T;
}

export function expectIdentifier(
  value: unknown,
  pattern: RegExp,
  path: string
): string {
  const text = expectString(value, path);
  if (!pattern.test(text)) {
    failArtifact('IDENTIFIER_FORMAT_INVALID', {
      invariant: 'identifier_must_match_the_frozen_format',
      path,
      observed: text.slice(0, 64)
    });
  }
  return text;
}

export function expectStringArray(
  value: unknown,
  path: string
): readonly string[] {
  const items = expectArray(value, path);
  return Object.freeze(
    items.map((item, index) => expectString(item, `${path}[${index}]`))
  );
}

export function expectIdentifierArray(
  value: unknown,
  pattern: RegExp,
  path: string
): readonly string[] {
  const items = expectArray(value, path);
  return Object.freeze(
    items.map((item, index) =>
      expectIdentifier(item, pattern, `${path}[${index}]`)
    )
  );
}

export function assertUnique(
  values: readonly string[],
  code: ReasoningRunArtifactCode,
  invariant: string,
  path: string
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      failArtifact(code, {
        invariant,
        path: `${path}[${index}]`,
        observed: value.slice(0, 64)
      });
    }
    seen.add(value);
  }
}

/**
 * Congelamiento PROFUNDO del resultado verificado, igual que F0.4 y F2.1: quien
 * lo recibe no puede mutarlo, y por lo tanto no puede convertir un artifact
 * verificado en uno que ya no lo esta.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
