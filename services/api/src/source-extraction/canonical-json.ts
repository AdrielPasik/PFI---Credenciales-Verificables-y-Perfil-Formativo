/**
 * `MINIMAL_DETERMINISTIC_JSON_V1` — implementacion TypeScript independiente.
 *
 * Escrita contra la especificacion textual congelada en `packages/schemas/README.md`,
 * no portando el codigo Python: si las dos implementaciones derivaran de la misma
 * fuente, la igualdad byte a byte entre ellas no probaria nada. El criterio de
 * aceptacion es reproducir exactamente el golden vector congelado en F0.1.
 *
 * Reglas::
 *
 *   claves de objeto   orden ascendente por CODE POINT Unicode
 *   arrays             orden preservado
 *   whitespace         ninguno
 *   enteros            decimal, sin ceros a la izquierda, sin exponente
 *   floats             invalidos
 *   booleanos / null   literales JSON
 *   encoding final     UTF-8
 *
 * Escaping de strings::
 *
 *   U+0022 -> \"      U+005C -> \\      U+0008 -> \b      U+0009 -> \t
 *   U+000A -> \n      U+000C -> \f      U+000D -> \r
 *   todo otro U+0000..U+001F -> \u00xx  con digitos hex en MINUSCULA
 *   U+007F                   -> literal, no escapado
 *   cualquier no-ASCII       -> literal, UTF-8 al serializar, nunca \uXXXX
 *   surrogate UTF-16 aislado -> ENTRADA INVALIDA
 *
 * ORDEN DE CLAVES: la trampa concreta.
 *
 * `Array.prototype.sort()` ordena strings por code unit UTF-16, NO por code
 * point, y los dos ordenes DIFIEREN. Un caracter astral empieza por un high
 * surrogate (0xD800..0xDBFF), que es numericamente MENOR que cualquier caracter
 * en U+E000..U+FFFF. Asi que para las claves U+FFFD y U+1F9EA::
 *
 *   por code point   (Python)  ->  U+FFFD  antes que  U+1F9EA
 *   por code unit    (sort())  ->  U+1F9EA antes que  U+FFFD
 *
 * Es decir: exactamente al reves. Por eso el comparador es explicito y hay un
 * test con clave astral que lo demuestra en vez de dejarlo como nota teorica.
 */

const QUOTE = String.fromCharCode(0x22);
const BACKSLASH = String.fromCharCode(0x5c);

const SHORT_ESCAPES = new Map<number, string>([
  [0x22, `${BACKSLASH}${QUOTE}`],
  [0x5c, `${BACKSLASH}${BACKSLASH}`],
  [0x08, `${BACKSLASH}b`],
  [0x09, `${BACKSLASH}t`],
  [0x0a, `${BACKSLASH}n`],
  [0x0c, `${BACKSLASH}f`],
  [0x0d, `${BACKSLASH}r`]
]);

export class CanonicalJsonError extends Error {
  public readonly reason: string;

  public constructor(reason: string) {
    super(`canonicalization_invalid: ${reason}`);
    this.name = 'CanonicalJsonError';
    this.reason = reason;
  }
}

/**
 * Comparador por code point Unicode, la semantica de `sorted()` de Python.
 *
 * No se usa `localeCompare` (dependiente de locale ni siquiera estable entre
 * plataformas) ni el orden por defecto de `sort()` (code units UTF-16).
 */
export function compareByCodePoint(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < shared; index += 1) {
    const a = leftPoints[index].codePointAt(0) as number;
    const b = rightPoints[index].codePointAt(0) as number;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }

  if (leftPoints.length === rightPoints.length) {
    return 0;
  }
  return leftPoints.length < rightPoints.length ? -1 : 1;
}

function encodeString(value: string): string {
  let out = QUOTE;

  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;

    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new CanonicalJsonError(
        `lone_surrogate: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
      );
    }

    const short = SHORT_ESCAPES.get(codePoint);
    if (short !== undefined) {
      out += short;
      continue;
    }

    if (codePoint < 0x20) {
      // Forma larga, hex en MINUSCULA. `\u001F` seria el mismo JSON
      // semanticamente y un preimage distinto, o sea otro fingerprint.
      out += `${BACKSLASH}u${codePoint.toString(16).padStart(4, '0')}`;
      continue;
    }

    out += character;
  }

  return out + QUOTE;
}

function encode(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  if (typeof value === 'string') {
    return encodeString(value);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      // La material projection no contiene floats por construccion. La
      // serializacion de numeros de punto flotante es justamente la parte de
      // JCS que esta canonicalizacion evita tener que definir.
      throw new CanonicalJsonError('float_not_representable');
    }
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalJsonError('integer_out_of_safe_range');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareByCodePoint);
    const members = keys.map((key) => `${encodeString(key)}:${encode(record[key])}`);
    return `{${members.join(',')}}`;
  }

  throw new CanonicalJsonError(`unsupported_type: ${typeof value}`);
}

/** Serializa bajo `MINIMAL_DETERMINISTIC_JSON_V1`. */
export function canonicalJson(payload: unknown): string {
  return encode(payload);
}

/** Bytes UTF-8 del preimage canonico. */
export function canonicalPreimage(payload: unknown): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}
