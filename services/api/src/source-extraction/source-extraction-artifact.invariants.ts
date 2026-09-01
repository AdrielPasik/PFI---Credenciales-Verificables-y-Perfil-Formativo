/**
 * Invariantes derivados que JSON Schema no puede expresar.
 *
 * Reimplementados de forma independiente contra el contrato escrito. El punto de
 * F0.4 es eliminar la dependencia de "Python confiando en Python": si esto
 * llamara al productor o portara su codigo, no probaria nada.
 *
 * Todo el direccionamiento usa code points Unicode. `String.prototype.slice` y
 * `string.length` no aparecen en ningun calculo de offsets.
 */

import { canonicalJson, CanonicalJsonError } from './canonical-json';
import { deriveCanonicalSegments, segmentAddress } from './canonical-segmentation';
import { codePointLength, CodePointRangeError, sliceByUnicodeCodePoints } from './code-points';
import {
  DIAGNOSTIC_TABLE,
  PAGE_JOIN,
  SOURCE_DIAGNOSTIC_ORDER,
  type CoverageStatus,
  type ExtractionSegment,
  type PageObservationStatus,
  type SourceExtractionArtifact
} from './source-extraction-artifact.types';
import { fail } from './source-extraction-verification.errors';

import { createHash } from 'node:crypto';

const OBSERVED: readonly PageObservationStatus[] = ['EXTRACTED', 'OBSERVED_EMPTY'];
const DEGRADED: readonly PageObservationStatus[] = [
  'UNOBSERVED_OR_UNEXTRACTABLE',
  'FAILED'
];

/**
 * Coverage de PDF. SOLO de PDF.
 *
 * Aplicar esta regla a una fuente TEXT —que siempre tiene `pages: []`— daria
 * `FAILED` para todo TextEvidence, exactamente al reves del contrato. Por eso
 * son dos funciones separadas y no una con un flag, igual que en el productor.
 */
export function derivePdfCoverage(statuses: readonly PageObservationStatus[]): CoverageStatus {
  if (statuses.length === 0) {
    return 'FAILED';
  }
  if (statuses.every((status) => OBSERVED.includes(status))) {
    return 'FULL';
  }
  const hasSubstantive = statuses.some((status) => status === 'EXTRACTED');
  const anyDegraded = statuses.some((status) => DEGRADED.includes(status));
  if (hasSubstantive && anyDegraded) {
    return 'PARTIAL';
  }
  return 'FAILED';
}

/**
 * Coverage de TEXT. Siempre `FULL`, incluido el contenido vacio.
 *
 * Una fuente TEXT leida por completo esta completamente observada, y eso no
 * depende de cuanto texto haya: coverage mide completitud de observacion, no
 * volumen.
 */
export function deriveTextCoverage(): CoverageStatus {
  return 'FULL';
}

/** Material projection congelada. `detail` y los campos derivados quedan afuera. */
export function materialProjection(artifact: SourceExtractionArtifact): unknown {
  return {
    sourceSha256: artifact.source.sourceSha256,
    sourceNormalizationApplied: artifact.sourceNormalizationApplied,
    extractionIdentity: { ...artifact.extractionIdentity },
    offsetUnit: artifact.offsetUnit,
    coverageStatus: artifact.coverageStatus,
    pages: artifact.pages.map((page) => ({
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      canonicalText: page.canonicalText,
      pageObservationStatus: page.pageObservationStatus
    })),
    segments: artifact.segments.map((segment) => ({
      segmentId: segment.segmentId,
      pageIndex: segment.pageIndex,
      charStart: segment.charStart,
      charEnd: segment.charEnd
    })),
    diagnostics: artifact.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      scope: diagnostic.scope,
      pageIndex: diagnostic.pageIndex,
      affectsCoverage: diagnostic.affectsCoverage
    }))
  };
}

export function computeArtifactFingerprint(artifact: SourceExtractionArtifact): string {
  let preimage: string;
  try {
    preimage = canonicalJson(materialProjection(artifact));
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      fail('CANONICALIZATION_INVALID', {
        path: 'artifact',
        invariant: error.reason
      });
    }
    throw error;
  }
  return createHash('sha256').update(Buffer.from(preimage, 'utf8')).digest('hex');
}

function assertPdfPages(artifact: SourceExtractionArtifact): void {
  let offset = 0;

  artifact.pages.forEach((page, position) => {
    const path = `artifact.pages[${position}]`;

    if (page.pageIndex !== position) {
      fail('ADDRESS_INVALID', {
        path: `${path}.pageIndex`,
        invariant: 'page_index_not_sequential',
        pageIndex: page.pageIndex
      });
    }
    if (page.pageNumber !== page.pageIndex + 1) {
      fail('ADDRESS_INVALID', {
        path: `${path}.pageNumber`,
        invariant: 'page_number_relation',
        pageIndex: page.pageIndex
      });
    }
    if (page.pageOffsetStart !== offset) {
      fail('ADDRESS_INVALID', {
        path: `${path}.pageOffsetStart`,
        invariant: 'page_offset_start',
        pageIndex: page.pageIndex
      });
    }

    const expectedEnd = offset + codePointLength(page.canonicalText);
    if (page.pageOffsetEnd !== expectedEnd) {
      fail('ADDRESS_INVALID', {
        path: `${path}.pageOffsetEnd`,
        invariant: 'page_offset_end',
        pageIndex: page.pageIndex
      });
    }

    offset = expectedEnd + codePointLength(PAGE_JOIN);
  });

  const expectedDocument = artifact.pages.map((page) => page.canonicalText).join(PAGE_JOIN);
  if (artifact.documentCanonicalText !== expectedDocument) {
    fail('ADDRESS_INVALID', {
      path: 'artifact.documentCanonicalText',
      invariant: 'document_canonical_text_does_not_match_pages'
    });
  }
}

function assertTextShape(artifact: SourceExtractionArtifact): void {
  if (artifact.pages.length !== 0) {
    fail('SOURCE_TYPE_INCONSISTENT', {
      path: 'artifact.pages',
      invariant: 'text_source_must_have_no_pages'
    });
  }

  const empty = artifact.documentCanonicalText === '';
  const declaresEmpty = artifact.diagnostics.some((entry) => entry.code === 'EMPTY_SOURCE_TEXT');

  if (empty && !declaresEmpty) {
    fail('DIAGNOSTIC_INCONSISTENT', {
      path: 'artifact.diagnostics',
      invariant: 'empty_text_source_must_declare_EMPTY_SOURCE_TEXT'
    });
  }
  if (declaresEmpty && !empty) {
    fail('DIAGNOSTIC_INCONSISTENT', {
      path: 'artifact.diagnostics',
      invariant: 'EMPTY_SOURCE_TEXT_declared_on_non_empty_source'
    });
  }
  if (empty && artifact.segments.length > 0) {
    fail('ADDRESS_INVALID', {
      path: 'artifact.segments',
      invariant: 'empty_text_source_must_have_no_segments'
    });
  }
}

function assertSegments(artifact: SourceExtractionArtifact): void {
  const isText = artifact.sourceType === 'TEXT';
  const pagesByIndex = new Map(artifact.pages.map((page) => [page.pageIndex, page]));

  artifact.segments.forEach((segment, position) => {
    const path = `artifact.segments[${position}]`;
    const { charStart, charEnd, segmentId } = segment;

    if (charEnd <= charStart) {
      fail('ADDRESS_INVALID', {
        path: `${path}.charEnd`,
        invariant: charEnd < charStart ? 'reversed_span' : 'empty_segment',
        segmentId
      });
    }

    let container: string;
    let expectedId: string;

    if (isText) {
      if (segment.pageIndex !== null) {
        fail('SOURCE_TYPE_INCONSISTENT', {
          path: `${path}.pageIndex`,
          invariant: 'text_segment_must_have_null_page_index',
          segmentId
        });
      }
      container = artifact.documentCanonicalText;
      expectedId = `d:${charStart}-${charEnd}`;
    } else {
      if (segment.pageIndex === null) {
        fail('SOURCE_TYPE_INCONSISTENT', {
          path: `${path}.pageIndex`,
          invariant: 'pdf_segment_must_reference_a_page',
          segmentId
        });
      }
      const page = pagesByIndex.get(segment.pageIndex);
      if (page === undefined) {
        fail('ADDRESS_INVALID', {
          path: `${path}.pageIndex`,
          invariant: 'segment_references_unknown_page',
          pageIndex: segment.pageIndex,
          segmentId
        });
      }
      container = page.canonicalText;
      expectedId = `p${segment.pageIndex}:${charStart}-${charEnd}`;
    }

    if (segmentId !== expectedId) {
      // El id deriva de la direccion, nunca de un ordinal: un `seg-N` re-apunta
      // en silencio si cambia la segmentacion.
      fail('ADDRESS_INVALID', {
        path: `${path}.segmentId`,
        invariant: 'segment_id_not_address_derived',
        segmentId
      });
    }

    let slice: string;
    try {
      slice = sliceByUnicodeCodePoints(container, charStart, charEnd);
    } catch (error) {
      if (error instanceof CodePointRangeError) {
        fail('ADDRESS_INVALID', {
          path,
          invariant: error.reason.replace(/ /g, '_'),
          segmentId
        });
      }
      throw error;
    }

    if (slice !== segment.exactExcerpt) {
      // Se rechaza; no se realinea. F0.4 verifica, no hace el trabajo del aligner.
      fail('ALIGNMENT_MISMATCH', {
        path: `${path}.exactExcerpt`,
        invariant: 'exact_alignment_invariant_violated',
        segmentId
      });
    }
  });

  assertSegmentCanonicalOrder(artifact);
  assertSegmentSetIsCanonical(artifact);
}

/**
 * Orden canonico de `segments[]`, congelado por el cierre de contrato de F0.4.
 *
 *     PDF_DOCUMENT   ASC(pageIndex, charStart, charEnd)
 *     TEXT           ASC(charStart, charEnd)
 *
 * `segments[]` entra en la material projection y los arrays preservan orden bajo
 * MINIMAL_DETERMINISTIC_JSON_V1, asi que el orden es parte de la representacion
 * y no un detalle de presentacion. Sin esta regla, dos artifacts con los MISMOS
 * segmentos permutados podrian ser ambos aceptados —cada uno con su propio
 * fingerprint correctamente recalculado— y una misma extraccion tendria mas de
 * una representacion valida.
 *
 * Es determinismo REPRESENTACIONAL: no cambia que evidencia existe, ni que
 * excerpt fundamenta, ni que significa un segmento.
 *
 * Se comprueba orden no estricto: se rechaza cuando un segmento ordena ANTES que
 * su predecesor. Si dos segmentos compartieran direccion exacta —hoy imposible
 * en la salida de los productores, y con id derivado de la direccion serian el
 * mismo id— eso seria una cuestion de duplicados, que este cierre no congela.
 */
function segmentOrderKey(
  segment: SourceExtractionArtifact['segments'][number],
  isText: boolean
): readonly number[] {
  return isText
    ? [segment.charStart, segment.charEnd]
    : [segment.pageIndex as number, segment.charStart, segment.charEnd];
}

function compareSegmentKeys(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

function assertSegmentCanonicalOrder(artifact: SourceExtractionArtifact): void {
  const isText = artifact.sourceType === 'TEXT';

  for (let index = 1; index < artifact.segments.length; index += 1) {
    const previous = segmentOrderKey(artifact.segments[index - 1], isText);
    const current = segmentOrderKey(artifact.segments[index], isText);

    if (compareSegmentKeys(previous, current) > 0) {
      // Se rechaza; NUNCA se reordena. Ordenar el input convertiria en silencio
      // una representacion no canonica en una canonica, que es exactamente lo
      // que este invariante existe para impedir.
      fail('ADDRESS_INVALID', {
        path: `artifact.segments[${index}]`,
        invariant: 'SEGMENT_ORDER_NON_CANONICAL',
        pageIndex: artifact.segments[index].pageIndex,
        segmentId: artifact.segments[index].segmentId
      });
    }
  }
}

/**
 * `segments[]` debe ser EXACTAMENTE la segmentacion canonica del texto.
 *
 * Verificar cada segmento por separado no alcanza: un duplicado, una omision o
 * un subspan alineado dentro de otro segmento pasan todas las comprobaciones
 * individuales, porque cada uno apunta a texto real. Lo que se verifica aca es
 * la membresia del conjunto.
 *
 * La unicidad cae de aca por construccion: la segmentacion canonica no produce
 * dos segmentos con la misma direccion, asi que un duplicado hace que el array
 * difiera de lo esperado. No hace falta —ni conviene— un chequeo aparte de
 * `Set(segmentId)`: seria una regla paralela que podria desincronizarse.
 *
 * Se compara; NUNCA se completa, ni se deduplica, ni se reordena.
 */
function assertSegmentSetIsCanonical(artifact: SourceExtractionArtifact): void {
  const expected = deriveCanonicalSegments(artifact);
  const actual = artifact.segments;

  const expectedAddresses = new Map<string, number>();
  for (const segment of expected) {
    expectedAddresses.set(segmentAddress(segment), (expectedAddresses.get(segmentAddress(segment)) ?? 0) + 1);
  }
  const actualAddresses = new Map<string, number>();
  for (const segment of actual) {
    actualAddresses.set(segmentAddress(segment), (actualAddresses.get(segmentAddress(segment)) ?? 0) + 1);
  }

  // Duplicados primero: con semantica de conjunto un duplicado parece "igual".
  for (const [address, count] of actualAddresses) {
    if (count > 1) {
      const position = actual.findIndex(
        (segment, index) => segmentAddress(segment) === address && index > actual.findIndex((other) => segmentAddress(other) === address)
      );
      fail('ADDRESS_INVALID', {
        path: `artifact.segments[${position}]`,
        invariant: 'SEGMENT_DUPLICATE_ADDRESS',
        segmentId: actual[position].segmentId,
        pageIndex: actual[position].pageIndex
      });
    }
  }

  for (const [address] of actualAddresses) {
    if (!expectedAddresses.has(address)) {
      const position = actual.findIndex((segment) => segmentAddress(segment) === address);
      fail('ADDRESS_INVALID', {
        path: `artifact.segments[${position}]`,
        invariant: 'SEGMENT_EXTRA_NON_CANONICAL',
        segmentId: actual[position].segmentId,
        pageIndex: actual[position].pageIndex
      });
    }
  }

  for (const [address] of expectedAddresses) {
    if (!actualAddresses.has(address)) {
      const missing = expected.find((segment) => segmentAddress(segment) === address) as ExtractionSegment;
      fail('ADDRESS_INVALID', {
        path: 'artifact.segments',
        invariant: 'SEGMENT_MISSING_CANONICAL',
        segmentId: missing.segmentId,
        pageIndex: missing.pageIndex
      });
    }
  }

  // Mismo conjunto de direcciones: quedan diferencias de posicion o de campos.
  if (actual.length !== expected.length) {
    fail('ADDRESS_INVALID', {
      path: 'artifact.segments',
      invariant: 'SEGMENT_SET_NON_CANONICAL'
    });
  }

  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (
      left.segmentId !== right.segmentId ||
      left.pageIndex !== right.pageIndex ||
      left.charStart !== right.charStart ||
      left.charEnd !== right.charEnd ||
      left.exactExcerpt !== right.exactExcerpt
    ) {
      fail('ADDRESS_INVALID', {
        path: `artifact.segments[${index}]`,
        invariant: 'SEGMENT_SET_NON_CANONICAL',
        segmentId: right.segmentId,
        pageIndex: right.pageIndex
      });
    }
  }
}

function assertDiagnostics(artifact: SourceExtractionArtifact): void {
  const pageIndexes = new Set(artifact.pages.map((page) => page.pageIndex));

  artifact.diagnostics.forEach((diagnostic, position) => {
    const path = `artifact.diagnostics[${position}]`;
    const frozen = DIAGNOSTIC_TABLE.get(diagnostic.code);

    if (frozen === undefined) {
      fail('DIAGNOSTIC_INCONSISTENT', { path: `${path}.code`, invariant: 'unknown_code' });
    }
    if (diagnostic.severity !== frozen.severity) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: `${path}.severity`,
        invariant: 'severity_does_not_match_frozen_table'
      });
    }
    if (diagnostic.scope !== frozen.scope) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: `${path}.scope`,
        invariant: 'scope_does_not_match_frozen_table'
      });
    }
    if (diagnostic.affectsCoverage !== frozen.affectsCoverage) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: `${path}.affectsCoverage`,
        invariant: 'affects_coverage_does_not_match_frozen_table'
      });
    }

    if (diagnostic.scope === 'PAGE') {
      if (diagnostic.pageIndex === null || !pageIndexes.has(diagnostic.pageIndex)) {
        fail('DIAGNOSTIC_INCONSISTENT', {
          path: `${path}.pageIndex`,
          invariant: 'page_scoped_diagnostic_must_reference_a_real_page',
          pageIndex: diagnostic.pageIndex
        });
      }
    } else if (diagnostic.pageIndex !== null) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: `${path}.pageIndex`,
        invariant: 'source_scoped_diagnostic_must_have_null_page_index'
      });
    }
  });

  assertDiagnosticCanonicalOrder(artifact);
}

/**
 * Orden canonico de diagnosticos, congelado por F0.2 §10.
 *
 * No alcanza con que los campos sean validos y el fingerprint cierre: un
 * artifact podria reordenar los diagnosticos, recalcular su propio fingerprint y
 * quedar internamente consistente, pero ya no representaria la forma canonica
 * producida bajo esa extractionIdentity.
 */
function assertDiagnosticCanonicalOrder(artifact: SourceExtractionArtifact): void {
  const pageScoped = artifact.diagnostics.filter((entry) => entry.scope === 'PAGE');
  const sourceScoped = artifact.diagnostics.filter((entry) => entry.scope === 'SOURCE');

  const firstSource = artifact.diagnostics.findIndex((entry) => entry.scope === 'SOURCE');
  const lastPage = artifact.diagnostics.reduce(
    (last, entry, index) => (entry.scope === 'PAGE' ? index : last),
    -1
  );
  if (firstSource !== -1 && lastPage > firstSource) {
    fail('DIAGNOSTIC_INCONSISTENT', {
      path: 'artifact.diagnostics',
      invariant: 'page_diagnostics_must_precede_source_diagnostics'
    });
  }

  for (let index = 1; index < pageScoped.length; index += 1) {
    const previous = pageScoped[index - 1].pageIndex as number;
    const current = pageScoped[index].pageIndex as number;
    if (current < previous) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: 'artifact.diagnostics',
        invariant: 'page_diagnostics_must_ascend_by_page_index',
        pageIndex: current
      });
    }
  }

  let lastRank = -1;
  for (const entry of sourceScoped) {
    const rank = SOURCE_DIAGNOSTIC_ORDER.indexOf(entry.code);
    if (rank === -1) {
      // `EMPTY_SOURCE_TEXT` es de fuente pero no participa del orden congelado
      // de F0.2: pertenece a TEXT, donde es el unico diagnostico posible.
      continue;
    }
    if (rank < lastRank) {
      fail('DIAGNOSTIC_INCONSISTENT', {
        path: 'artifact.diagnostics',
        invariant: 'source_diagnostics_out_of_frozen_order'
      });
    }
    lastRank = rank;
  }
}

function assertCoverage(artifact: SourceExtractionArtifact): void {
  const expected =
    artifact.sourceType === 'TEXT'
      ? deriveTextCoverage()
      : derivePdfCoverage(artifact.pages.map((page) => page.pageObservationStatus));

  if (artifact.coverageStatus !== expected) {
    fail('COVERAGE_INCONSISTENT', {
      path: 'artifact.coverageStatus',
      invariant: 'coverage_status_inconsistent'
    });
  }
}

/** Todos los invariantes derivados, incluido el fingerprint. */
export function assertSourceExtractionInvariants(artifact: SourceExtractionArtifact): void {
  if (artifact.sourceType === 'TEXT') {
    assertTextShape(artifact);
  } else {
    assertPdfPages(artifact);
  }

  assertSegments(artifact);
  assertDiagnostics(artifact);
  assertCoverage(artifact);

  const recomputed = computeArtifactFingerprint(artifact);
  if (recomputed !== artifact.artifactContentFingerprint) {
    // Sin warning y sin reparacion: un fingerprint que no cierra significa que
    // el artifact no es el que dice ser.
    fail('FINGERPRINT_MISMATCH', {
      path: 'artifact.artifactContentFingerprint',
      invariant: 'recomputed_fingerprint_does_not_match'
    });
  }
}
