/**
 * Direccionamiento por code point Unicode.
 *
 * El contrato declara `offsetUnit = "UNICODE_CODE_POINT"`, es decir un indice de
 * `str` de Python. JavaScript indexa por code unit UTF-16, asi que para cualquier
 * caracter fuera del BMP —un emoji, algunas extensiones CJK, algunos simbolos
 * matematicos— un code point son DOS code units y `String.prototype.slice(a, b)`
 * NO equivale a `text[a:b]` de Python.
 *
 * Ese desalineamiento no produce un error: produce un excerpt silenciosamente
 * equivocado, que es peor. Por eso el slicing por code points es una primitiva
 * explicita y `.slice()` no se usa en ningun punto de la verificacion.
 */

/** Un surrogate aislado no es texto Unicode bien formado y no puede codificarse
 * a UTF-8. Aceptarlo haria divergir el preimage entre runtimes, asi que es
 * entrada invalida por contrato en vez de ambigua. */
export function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }

    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

/**
 * Largo en code points Unicode.
 *
 * NO es `text.length`, que cuenta code units UTF-16.
 */
export function codePointLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
    }
    count += 1;
  }
  return count;
}

export class CodePointRangeError extends Error {
  public readonly reason: string;

  public constructor(reason: string) {
    super(`code_point_range_invalid: ${reason}`);
    this.name = 'CodePointRangeError';
    this.reason = reason;
  }
}

/**
 * Equivalente exacto de `text[start:end]` de Python, con `start`/`end` en code
 * points.
 *
 * A diferencia de `String.prototype.slice`, rechaza en vez de recortar en
 * silencio: un rango invertido, negativo o fuera de rango es un defecto del
 * artifact, no algo que corresponda saturar a los limites.
 */
export function sliceByUnicodeCodePoints(
  text: string,
  start: number,
  end: number
): string {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new CodePointRangeError('offsets must be integers');
  }
  if (start < 0 || end < 0) {
    throw new CodePointRangeError('offsets must be non-negative');
  }
  if (end < start) {
    throw new CodePointRangeError('end before start');
  }
  if (hasLoneSurrogate(text)) {
    throw new CodePointRangeError('container contains a lone surrogate');
  }

  const characters = Array.from(text);
  if (end > characters.length) {
    throw new CodePointRangeError('span exceeds container length');
  }

  return characters.slice(start, end).join('');
}
