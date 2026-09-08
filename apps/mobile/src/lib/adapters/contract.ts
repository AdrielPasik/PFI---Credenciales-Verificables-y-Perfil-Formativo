import {
  describeActualCategory,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';

/**
 * Primitivas de lectura defensiva de payloads.
 *
 * La respuesta del API es dato NO CONFIABLE hasta que pasa por acá: ninguna
 * pantalla recibe `unknown` ni castea una respuesta cruda.
 *
 * Las reglas replican las compatibilidades que Holder Web ya tuvo que
 * incorporar tras incidentes reales de contrato (sección 128 del encargo):
 *
 *  - etiquetas semánticas que pueden llegar como string o como objeto
 *    descriptor (area / name / label / area_label / areaLabel);
 *  - alias camelCase / snake_case en credentialSubject;
 *  - evidencia documental y textual opcionales (ausentes o null);
 *  - arrays declarativos de hasta 30 entradas de 500 caracteres;
 *  - contadores de cobertura ausentes en perfiles generados antes de C2c.
 */

export function invalid(
  path: string,
  expected: string,
  value: unknown,
  message = 'La respuesta del servicio no cumple el contrato esperado.'
): never {
  throw new IncompatiblePayloadError(message, {
    path,
    expected,
    actualCategory: describeActualCategory(value)
  });
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'object', value);
  }

  return value as Record<string, unknown>;
}

/** `undefined` y `null` colapsan a `null`. Cualquier otra cosa se valida. */
export function optionalRecord(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value, path);
}

/** Sólo `null` colapsa: un campo ausente sigue siendo un incumplimiento. */
export function nullableRecord(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  return value === null ? null : record(value, path);
}

export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value;
}

export function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(path, 'string or null', value);
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

export function requiredString(value: unknown, path: string): string {
  const normalized = nullableString(value, path);
  if (!normalized) invalid(path, 'non-empty string', value);
  return normalized;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Cadena acotada y sin caracteres de control. El límite protege el layout,
 * pero NUNCA trunca: un valor fuera de contrato se rechaza, no se recorta en
 * silencio.
 */
export function safeString(
  value: unknown,
  maxLength: number,
  path: string
): string {
  const normalized = requiredString(value, path);

  if (normalized.length > maxLength || CONTROL_CHARACTERS.test(normalized)) {
    invalid(path, `safe string up to ${maxLength} characters`, value);
  }

  return normalized;
}

export function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean', value);
  return value;
}

export function nullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(path, 'finite number or null', value);
  }
  return value;
}

export function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

export function optionalNonNegativeInteger(
  value: unknown,
  path: string
): number | null {
  if (value === undefined || value === null) return null;
  return nonNegativeInteger(value, path);
}

export function nullableConfidence(
  value: unknown,
  path: string
): number | null {
  const confidence = nullableNumber(value, path);
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    invalid(path, 'number from 0 to 1 or null', value);
  }
  return confidence;
}

export function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string
): T[number] {
  const normalized = requiredString(value, path);
  if (!allowed.includes(normalized)) {
    invalid(path, `one of: ${allowed.join(', ')}`, value);
  }
  return normalized as T[number];
}

/**
 * Lee un campo con alias: primero el nombre vigente y, sólo si está ausente
 * (`undefined`, nunca `null`), cae al histórico. Un `null` explícito significa
 * "el backend sabe que no hay valor" y no debe activar el alias.
 */
export function aliasedValue(
  source: Record<string, unknown>,
  current: string,
  legacy?: string
): unknown {
  return source[current] === undefined && legacy
    ? source[legacy]
    : source[current];
}

/** Nombres bajo los que puede venir la etiqueta de un descriptor semántico. */
export const semanticLabelFields = {
  area: ['area', 'name', 'label', 'area_label', 'areaLabel'],
  skill: ['skill', 'name', 'label', 'skill_label', 'skillLabel'],
  concept: ['concept', 'name', 'label', 'concept_label', 'conceptLabel']
} as const;

export const SEMANTIC_LABEL_MAX_LENGTH = 160;
export const DECLARED_ARRAY_MAX_ITEMS = 30;
export const DECLARED_ARRAY_ITEM_MAX_LENGTH = 500;

export function descriptorLabel(
  value: Record<string, unknown>,
  labelFields: readonly string[],
  path: string
): string {
  for (const field of labelFields) {
    if (value[field] !== undefined) {
      return safeString(
        value[field],
        SEMANTIC_LABEL_MAX_LENGTH,
        `${path}.${field}`
      );
    }
  }

  return invalid(path, `object with one of: ${labelFields.join(', ')}`, value);
}

/** Acepta indistintamente `["Redes"]` y `[{ area: "Redes" }]`. */
export function semanticLabelArray(
  value: unknown,
  labelFields: readonly string[],
  path: string
): string[] {
  return array(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof entry === 'string') {
      return safeString(entry, SEMANTIC_LABEL_MAX_LENGTH, itemPath);
    }
    return descriptorLabel(record(entry, itemPath), labelFields, itemPath);
  });
}

/** Contenido declarado por el emisor: textos largos, hasta 500 caracteres. */
export function declaredStringArray(value: unknown, path: string): string[] {
  const entries = array(value, path);

  if (entries.length > DECLARED_ARRAY_MAX_ITEMS) {
    invalid(
      path,
      `array with at most ${DECLARED_ARRAY_MAX_ITEMS} entries`,
      value
    );
  }

  return entries.map((entry, index) =>
    safeString(entry, DECLARED_ARRAY_ITEM_MAX_LENGTH, `${path}[${index}]`)
  );
}

export function optionalDeclaredStringArray(
  value: unknown,
  path: string
): string[] {
  return value === undefined || value === null
    ? []
    : declaredStringArray(value, path);
}

/**
 * Igual que `declaredStringArray` pero además acepta descriptores
 * `{ label }`: es la forma en que el perfil agregado puede emitir las
 * competencias declaradas.
 */
export function optionalEmittedLabelArray(
  value: unknown,
  path: string
): string[] {
  if (value === undefined || value === null) return [];

  return array(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;

    if (typeof entry === 'string') {
      return safeString(entry, DECLARED_ARRAY_ITEM_MAX_LENGTH, itemPath);
    }

    const descriptor = record(entry, itemPath);

    if (descriptor.label === undefined) {
      invalid(itemPath, 'string or object with label', entry);
    }

    return safeString(
      descriptor.label,
      DECLARED_ARRAY_ITEM_MAX_LENGTH,
      `${itemPath}.label`
    );
  });
}
