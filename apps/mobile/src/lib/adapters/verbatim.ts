import { invalid, record } from '@/lib/adapters/contract';

/**
 * Primitivas VERBATIM para material anclado a una fuente.
 *
 * `contract.ts` normaliza con `trim()` + colapso de espacios, y para etiquetas
 * de perfil está bien. Acá NO se puede: `exactExcerpt`, `originalText` y
 * `excerpt` son material anclado. El backend exige que `sourceQuote` sea
 * subcadena LITERAL del texto original, así que colapsar un espacio convertiría
 * una cita válida en una que el servidor rechaza — y en el caso de la evidencia
 * de un análisis, cambiaría la cita que la persona lee respecto de la que el
 * razonador usó.
 *
 * Estas funciones validan el TIPO y no tocan el contenido.
 */

export { array, invalid, record } from '@/lib/adapters/contract';

/** String tal cual viene. Sin trim, sin colapsar espacios, sin normalizar. */
export function verbatimString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'string', value);
  return value;
}

export function nullableVerbatimString(
  value: unknown,
  path: string
): string | null {
  if (value === null || value === undefined) return null;
  return verbatimString(value, path);
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean', value);
  return value;
}

export function nonNegativeIntegerValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

/**
 * Página OPCIONAL y positiva.
 *
 * `null` es una respuesta legítima y frecuente —toda fuente de texto la tiene
 * así—, y no se sustituye por 1 ni por "desconocida".
 */
export function nullablePageNumber(
  value: unknown,
  path: string
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalid(path, 'positive integer or null', value);
  }
  return value;
}

export function enumValueOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  const text = verbatimString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    invalid(path, `one of ${allowed.join(', ')}`, value);
  }
  return text as T;
}

export function stringArrayOf(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value.map((item, index) => verbatimString(item, `${path}[${index}]`));
}

/** Fecha larga es-AR. Misma presentación que Holder Web para estos modelos. */
export function isoDateLabel(value: unknown, path: string): string {
  const text = verbatimString(value, path);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) invalid(path, 'ISO date string', value);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(parsed);
}

export function nullableIsoDateLabel(
  value: unknown,
  path: string
): string | null {
  if (value === null || value === undefined) return null;
  return isoDateLabel(value, path);
}

/** Sub-objeto opcional: `null` y ausente colapsan a `null`. */
export function optionalRecordOf(
  value: unknown,
  path: string
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return record(value, path);
}
