/**
 * Derivación independiente de la segmentación canónica.
 *
 * Verificar cada segmento por separado —dirección válida, id derivado de la
 * dirección, alineamiento exacto, orden canónico— NO alcanza. Un artifact puede
 * duplicar un segmento, omitir uno, o agregar un subspan alineado dentro de otro,
 * y seguir pasando todas esas comprobaciones: cada segmento individual apunta a
 * texto real. Lo que faltaba verificar es la MEMBRESÍA: que `segments[]` sea
 * exactamente la segmentación que el texto canónico implica.
 *
 * Este módulo reimplementa la política congelada y compara. No importa Python, no
 * llama a FastAPI, y no toma `artifact.segments` como entrada de la derivación:
 * si lo hiciera, estaría verificando el artifact contra sí mismo.
 *
 * POLÍTICA CONGELADA, tal como la implementa
 * `services/ai-service/src/source_extraction/segmentation.py::segment_blocks`::
 *
 *     cursor = 0
 *     para cada bloque de text.split("\n\n"):
 *         start = cursor
 *         end   = start + largo_en_code_points(bloque)
 *         si el bloque NO es solo whitespace: emitir (start, end)
 *         cursor = end + 2
 *
 * Tres detalles del algoritmo que NO son "párrafo" en sentido intuitivo, y que se
 * reproducen literalmente porque son los que producen los artifacts congelados:
 *
 *   - El separador es exactamente `"\n\n"`. Con un número IMPAR de saltos, el
 *     salto sobrante queda DENTRO del bloque siguiente y el `exactExcerpt` lo
 *     incluye: `"A\n\n\nB"` da los bloques `"A"` y `"\nB"`. Recortarlo rompería
 *     el invariante de alineamiento.
 *   - Los offsets salen de aritmética sobre el cursor, nunca de buscar el bloque
 *     en el texto: con bloques repetidos, buscar re-encontraría la posición
 *     equivocada, y acá la dirección ES la identidad.
 *   - El cursor avanza `end + 2` SIEMPRE, también cuando el bloque se descarta
 *     por ser solo whitespace. Descartar un bloque no corre las direcciones de
 *     los que siguen.
 */

import { codePointLength, sliceByUnicodeCodePoints } from './code-points';
import {
  PAGE_JOIN,
  type ExtractionSegment,
  type SourceExtractionArtifact
} from './source-extraction-artifact.types';

const BLOCK_SEPARATOR = PAGE_JOIN;

/**
 * Conjunto de whitespace de `str.strip()` de PYTHON, no de
 * `String.prototype.trim` de ECMAScript.
 *
 * El productor decide si un bloque se descarta con `block.strip() != ""`, así que
 * la contraparte TypeScript debe reproducir la semántica de Python. Los dos
 * conjuntos difieren EN AMBAS DIRECCIONES, medido::
 *
 *     U+001C..U+001F, U+0085   Python SÍ los considera whitespace, ECMAScript NO
 *     U+FEFF                   ECMAScript SÍ, Python NO
 *
 * Es la imagen espejo del problema que F0.3 resolvió en la otra dirección, donde
 * hacía falta el trim de ECMAScript dentro de Python. Usar `.trim()` acá haría
 * que un bloque compuesto solo por U+FEFF se descartara en TypeScript y se
 * emitiera en Python — divergencia silenciosa en la membresía de segmentos.
 *
 * Se declara explícito, no derivado de una propiedad Unicode, porque es un
 * contrato congelado; un test lo cruza contra la categoría `Zs` vigente.
 */
export const PYTHON_WHITESPACE_CODE_POINTS: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d,
  0x001c, 0x001d, 0x001e, 0x001f,
  0x0020, 0x0085, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000
]);

/** `block.strip() == ""` de Python. */
export function isPythonWhitespaceOnly(block: string): boolean {
  for (const character of block) {
    if (!PYTHON_WHITESPACE_CODE_POINTS.has(character.codePointAt(0) as number)) {
      return false;
    }
  }
  return true;
}

/** Spans `(charStart, charEnd)` de los bloques canónicos de un contenedor. */
export function deriveBlockSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;

  for (const block of text.split(BLOCK_SEPARATOR)) {
    const start = cursor;
    const end = start + codePointLength(block);
    if (!isPythonWhitespaceOnly(block)) {
      spans.push({ start, end });
    }
    // Avanza siempre, incluso si el bloque se descartó.
    cursor = end + codePointLength(BLOCK_SEPARATOR);
  }

  return spans;
}

/**
 * Segmentación canónica implicada por el texto canónico del artifact.
 *
 * La entrada es exclusivamente el texto —`pages[].canonicalText` para PDF,
 * `documentCanonicalText` para TEXT—. `artifact.segments` NO participa.
 */
export function deriveCanonicalSegments(
  artifact: SourceExtractionArtifact
): ExtractionSegment[] {
  if (artifact.sourceType === 'TEXT') {
    const document = artifact.documentCanonicalText;
    return deriveBlockSpans(document).map(({ start, end }) => ({
      segmentId: `d:${start}-${end}`,
      pageIndex: null,
      charStart: start,
      charEnd: end,
      exactExcerpt: sliceByUnicodeCodePoints(document, start, end)
    }));
  }

  const segments: ExtractionSegment[] = [];
  for (const page of artifact.pages) {
    for (const { start, end } of deriveBlockSpans(page.canonicalText)) {
      segments.push({
        segmentId: `p${page.pageIndex}:${start}-${end}`,
        pageIndex: page.pageIndex,
        charStart: start,
        charEnd: end,
        exactExcerpt: sliceByUnicodeCodePoints(page.canonicalText, start, end)
      });
    }
  }
  return segments;
}

export function segmentAddress(segment: ExtractionSegment): string {
  return `${segment.pageIndex ?? 'd'}:${segment.charStart}-${segment.charEnd}`;
}
