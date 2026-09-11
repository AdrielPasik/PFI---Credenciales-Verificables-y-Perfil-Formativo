/**
 * Verificación SOURCE-ADDRESSABLE de las EvidenceUnits — slice F3.4.
 *
 * F3.1 verificó lo que podía verificar sin el artifact de extracción delante:
 * que cada `sourceId` referenciado fuera una fuente INCLUIDA y que su SHA
 * coincidiera con el congelado. Deliberadamente NO verificó las coordenadas,
 * porque para eso hace falta el `source_extraction_v1` seleccionado — y ése es
 * exactamente el material que este slice carga.
 *
 * Acá se cierra ese diferimiento:
 *
 *     el excerpt persistido ES la rebanada del canónico en [charStart, charEnd)
 *     el span cae dentro del texto y no está invertido
 *     el segmento declarado existe en ESA fuente y contiene el span
 *     la página declarada es la que corresponde al offset
 *     `exactQuote` y `sourceTrace.exactExcerpt` dicen lo mismo
 *
 * POR QUÉ SE VUELVE A HACER SI PYTHON YA LO HIZO. Porque NestJS no puede confiar
 * en que lo hizo. Un `200` significa "el servicio respondió", no "el grounding es
 * correcto", y la única forma de que una coordenada manipulada no se persista es
 * recomputarla contra el artifact que ESTE proceso verificó. Misma disciplina que
 * F0.4: quien persiste, comprueba.
 *
 * Función PURA: recibe lo ya verificado, no toca la base y no llama a nadie.
 *
 * PRIVACIDAD: `observed` lleva ids, offsets y longitudes. NUNCA el excerpt ni el
 * texto canónico — un error termina en un log.
 */

import { failArtifact } from './reasoning-run-artifact.errors';
import { type VerifiedEvidenceUnits } from './reasoning-run-artifact.types';
import { type VerifiedSourceExtractionArtifact } from '../source-extraction/source-extraction-artifact.types';

/**
 * El artifact de extracción verificado de cada fuente INCLUIDA, indexado por su
 * `runLocalSourceId`.
 *
 * Se recibe ya resuelto para que el verificador quede puro: quien lo arma es el
 * servicio, que es el que tiene autoridad para leer persistencia.
 */
export type VerifiedExtractionsByRunLocalSourceId = ReadonlyMap<
  string,
  VerifiedSourceExtractionArtifact
>;

export function verifyEvidenceUnitsAgainstSourceExtractions(
  evidenceUnits: VerifiedEvidenceUnits,
  extractions: VerifiedExtractionsByRunLocalSourceId
): void {
  // El texto canonico descompuesto en PUNTOS DE CODIGO, una vez por fuente. Se
  // cachea porque descomponerlo por cada unidad seria cuadratico sobre
  // documentos largos, y la verificacion corre en el camino de escritura.
  const pointsBySource = new Map<string, readonly string[]>();

  for (const [index, unit] of evidenceUnits.evidenceUnits.entries()) {
    const path = `evidenceUnits.evidenceUnits[${index}]`;
    const trace = unit.sourceTrace;
    const artifact = extractions.get(trace.sourceId);

    if (!artifact) {
      // No debería llegar acá —el verificador de inventario corre antes— pero
      // este verificador es puro y recibe datos de afuera: si falta la fuente se
      // falla en vez de asumir.
      failArtifact('SOURCE_REFERENCE_NOT_GROUNDED', {
        invariant: 'evidence_unit_source_must_have_a_verified_extraction',
        path: `${path}.sourceTrace.sourceId`,
        observed: trace.sourceId
      });
    }

    let points = pointsBySource.get(trace.sourceId);
    if (points === undefined) {
      points = [...artifact.documentCanonicalText];
      pointsBySource.set(trace.sourceId, points);
    }

    const { charStart, charEnd } = trace;

    if (
      !Number.isInteger(charStart) ||
      !Number.isInteger(charEnd) ||
      charStart < 0 ||
      charEnd < charStart ||
      charEnd > points.length
    ) {
      failArtifact('SPAN_INVALID', {
        invariant: 'evidence_unit_span_must_be_inside_the_canonical_text',
        path: `${path}.sourceTrace`,
        observed: `${charStart}:${charEnd}/${points.length}`
      });
    }

    // EL CORAZÓN DE LA VERIFICACIÓN. Si el excerpt persistido no es exactamente
    // la rebanada del canónico, la unidad no está anclada: da igual cuán
    // plausible se lea.
    const slice = points.slice(charStart, charEnd).join('');
    if (trace.exactExcerpt !== slice) {
      failArtifact('SPAN_INVALID', {
        invariant: 'exact_excerpt_must_equal_the_canonical_slice',
        path: `${path}.sourceTrace.exactExcerpt`,
        observed: `len=${[...trace.exactExcerpt].length};expected=${charEnd - charStart}`
      });
    }

    if (unit.exactQuote !== trace.exactExcerpt) {
      failArtifact('SPAN_INVALID', {
        invariant: 'exact_quote_must_equal_the_traced_excerpt',
        path: `${path}.exactQuote`,
        observed: `len=${unit.exactQuote.length}`
      });
    }

    verifySegment(artifact, unit.sourceTrace.segmentId, charStart, charEnd, path);
    verifyPage(artifact, unit.sourceTrace.pageNumber, charStart, path);
  }
}

/**
 * El segmento declarado tiene que existir en ESA fuente y contener el span.
 *
 * `null` es válido: el artifact de F0 puede no tener un segmento que cubra el
 * offset, y forzar uno sería inventar una identidad estructural.
 */
function verifySegment(
  artifact: VerifiedSourceExtractionArtifact,
  segmentId: string | null,
  charStart: number,
  charEnd: number,
  path: string
): void {
  if (segmentId === null) return;

  const segment = artifact.segments.find((item) => item.segmentId === segmentId);
  if (!segment) {
    failArtifact('SPAN_INVALID', {
      invariant: 'segment_must_belong_to_the_referenced_source',
      path: `${path}.sourceTrace.segmentId`,
      observed: segmentId
    });
  }

  if (charStart < segment.charStart || charEnd > segment.charEnd) {
    // Un span que se sale de su segmento cruzaría un límite estructural que la
    // fuente no tiene: el segmento dejaría de describir dónde está la cita.
    failArtifact('SPAN_INVALID', {
      invariant: 'span_must_be_contained_in_its_declared_segment',
      path: `${path}.sourceTrace.segmentId`,
      observed: `${charStart}:${charEnd}!⊆${segment.charStart}:${segment.charEnd}`
    });
  }
}

/**
 * La página declarada tiene que ser la del offset.
 *
 * Sin páginas —una fuente TEXT— el único valor válido es `null`. Declarar una
 * página en una fuente que no las tiene sería una coordenada imposible.
 */
function verifyPage(
  artifact: VerifiedSourceExtractionArtifact,
  pageNumber: number | null,
  charStart: number,
  path: string
): void {
  const page = artifact.pages.find(
    (item) => item.pageOffsetStart <= charStart && charStart <= item.pageOffsetEnd
  );
  const expected = page ? page.pageNumber : null;

  if (pageNumber !== expected) {
    failArtifact('SPAN_INVALID', {
      invariant: 'page_number_must_match_the_page_that_contains_the_span',
      path: `${path}.sourceTrace.pageNumber`,
      observed: `${pageNumber}!=${expected}`
    });
  }
}

/**
 * NOTA SOBRE OFFSETS, que es la razón por la que este archivo descompone el texto.
 *
 * `String.prototype.slice` y `.length` cuentan unidades UTF-16; Python cuenta
 * PUNTOS DE CÓDIGO, y ésa es la convención congelada por F0
 * (`offsetUnit: UNICODE_CODE_POINT`). Con cualquier carácter fuera del BMP —un
 * emoji, por ejemplo— las dos formas dan números distintos, y la verificación
 * cruzada dejaría de verificar: rechazaría anclajes correctos y, peor, podría
 * aceptar coordenadas que Python nunca produjo. Por eso se compara siempre sobre
 * el array de puntos de código.
 */
