/**
 * Validacion estructural de `source_extraction_v1` sobre input NO confiable.
 *
 * Sigue la convencion establecida del repo (`semantic-analysis-artifact.validator.ts`):
 * helpers `expect*` que verifican y devuelven, sin motor de JSON Schema en runtime.
 * El repo no tiene ninguno y F0.4 tiene prohibido agregar una dependencia nueva en
 * silencio; la fidelidad al schema congelado se demuestra por test contra el corpus
 * `valid/` e `invalid-schema/` de F0.1.
 *
 * NO MUTA EL INPUT. Construye un objeto nuevo campo por campo a partir de lo que
 * validó. Nada de coercion, nada de defaults, nada de borrar propiedades
 * sobrantes para que el objeto pase: un input invalido se rechaza, jamas se
 * repara. `additionalProperties: false` del schema se hace cumplir rechazando
 * claves desconocidas, no descartandolas.
 */

import {
  COVERAGE_STATUSES,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_DETAIL_MAX_LENGTH,
  DIAGNOSTIC_SCOPES,
  DIAGNOSTIC_SEVERITIES,
  OFFSET_UNIT,
  PAGE_OBSERVATION_STATUSES,
  PDF_PARSER_PROFILES,
  SOURCE_EXTRACTION_SCHEMA_VERSION,
  SOURCE_TYPES,
  TEXT_PARSER_PROFILE,
  type CoverageStatus,
  type DiagnosticCode,
  type DiagnosticScope,
  type DiagnosticSeverity,
  type ExtractionDiagnostic,
  type ExtractionPage,
  type ExtractionSegment,
  type PageObservationStatus,
  type PdfParserProfile,
  type SourceExtractionArtifact
} from './source-extraction-artifact.types';
import { fail } from './source-extraction-verification.errors';

const SHA256_HEX = /^[a-f0-9]{64}$/;

const ARTIFACT_KEYS = new Set([
  'schemaVersion',
  'sourceType',
  'source',
  'extractionIdentity',
  'sourceNormalizationApplied',
  'offsetUnit',
  'coverageStatus',
  'pages',
  'documentCanonicalText',
  'segments',
  'diagnostics',
  'artifactContentFingerprint'
]);

const PAGE_KEYS = new Set([
  'pageIndex',
  'pageNumber',
  'canonicalText',
  'pageOffsetStart',
  'pageOffsetEnd',
  'pageObservationStatus'
]);

const SEGMENT_KEYS = new Set([
  'segmentId',
  'pageIndex',
  'charStart',
  'charEnd',
  'exactExcerpt'
]);

const DIAGNOSTIC_KEYS = new Set([
  'code',
  'severity',
  'scope',
  'pageIndex',
  'affectsCoverage',
  'detail'
]);

function schemaFail(path: string, invariant: string): never {
  return fail('SCHEMA_INVALID', { path, invariant });
}

function expectPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    schemaFail(path, 'must_be_object');
  }
  return value as Record<string, unknown>;
}

function expectNoUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      // `additionalProperties: false`. Se rechaza, no se descarta: descartar
      // convertiria un artifact invalido en uno valido en silencio.
      schemaFail(`${path}.${key}`, 'unknown_property');
    }
  }
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    schemaFail(path, 'must_be_string');
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (text.length === 0) {
    schemaFail(path, 'must_be_non_empty');
  }
  return text;
}

function expectSha256Hex(value: unknown, path: string): string {
  const text = expectString(value, path);
  if (!SHA256_HEX.test(text)) {
    schemaFail(path, 'must_be_lowercase_sha256_hex');
  }
  return text;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    schemaFail(path, 'must_be_non_negative_integer');
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    schemaFail(path, 'must_be_boolean');
  }
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    schemaFail(path, 'must_be_array');
  }
  return value;
}

function expectOneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[]
): T {
  const text = expectString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    schemaFail(path, 'must_be_one_of_enum');
  }
  return text as T;
}

function expectConst<T extends string>(value: unknown, path: string, expected: T): T {
  const text = expectString(value, path);
  if (text !== expected) {
    schemaFail(path, 'must_equal_frozen_constant');
  }
  return expected;
}

function validatePage(value: unknown, path: string): ExtractionPage {
  const record = expectPlainObject(value, path);
  expectNoUnknownKeys(record, PAGE_KEYS, path);

  const pageNumber = expectNonNegativeInteger(record.pageNumber, `${path}.pageNumber`);
  if (pageNumber < 1) {
    schemaFail(`${path}.pageNumber`, 'must_be_at_least_one');
  }

  return {
    pageIndex: expectNonNegativeInteger(record.pageIndex, `${path}.pageIndex`),
    pageNumber,
    canonicalText: expectString(record.canonicalText, `${path}.canonicalText`),
    pageOffsetStart: expectNonNegativeInteger(record.pageOffsetStart, `${path}.pageOffsetStart`),
    pageOffsetEnd: expectNonNegativeInteger(record.pageOffsetEnd, `${path}.pageOffsetEnd`),
    pageObservationStatus: expectOneOf<PageObservationStatus>(
      record.pageObservationStatus,
      `${path}.pageObservationStatus`,
      PAGE_OBSERVATION_STATUSES
    )
  };
}

function validateSegment(value: unknown, path: string): ExtractionSegment {
  const record = expectPlainObject(value, path);
  expectNoUnknownKeys(record, SEGMENT_KEYS, path);

  let pageIndex: number | null = null;
  if (record.pageIndex !== null) {
    pageIndex = expectNonNegativeInteger(record.pageIndex, `${path}.pageIndex`);
  }

  return {
    segmentId: expectNonEmptyString(record.segmentId, `${path}.segmentId`),
    pageIndex,
    charStart: expectNonNegativeInteger(record.charStart, `${path}.charStart`),
    charEnd: expectNonNegativeInteger(record.charEnd, `${path}.charEnd`),
    exactExcerpt: expectString(record.exactExcerpt, `${path}.exactExcerpt`)
  };
}

function validateDiagnostic(value: unknown, path: string): ExtractionDiagnostic {
  const record = expectPlainObject(value, path);
  expectNoUnknownKeys(record, DIAGNOSTIC_KEYS, path);

  let pageIndex: number | null = null;
  if (record.pageIndex !== null) {
    pageIndex = expectNonNegativeInteger(record.pageIndex, `${path}.pageIndex`);
  }

  const diagnostic: ExtractionDiagnostic = {
    code: expectOneOf<DiagnosticCode>(record.code, `${path}.code`, DIAGNOSTIC_CODES),
    severity: expectOneOf<DiagnosticSeverity>(
      record.severity,
      `${path}.severity`,
      DIAGNOSTIC_SEVERITIES
    ),
    scope: expectOneOf<DiagnosticScope>(record.scope, `${path}.scope`, DIAGNOSTIC_SCOPES),
    pageIndex,
    affectsCoverage: expectBoolean(record.affectsCoverage, `${path}.affectsCoverage`)
  };

  if (record.detail !== undefined) {
    const detail = expectString(record.detail, `${path}.detail`);
    if (detail.length > DIAGNOSTIC_DETAIL_MAX_LENGTH) {
      schemaFail(`${path}.detail`, 'exceeds_max_length');
    }
    diagnostic.detail = detail;
  }

  return diagnostic;
}

/**
 * Valida la forma estructural y devuelve una COPIA construida campo por campo.
 *
 * El objeto devuelto no comparte referencia con el input en ningun nivel, de
 * modo que mutar el input despues no puede alterar lo que se verificó.
 */
export function validateSourceExtractionArtifactShape(
  input: unknown
): SourceExtractionArtifact {
  const record = expectPlainObject(input, 'artifact');
  expectNoUnknownKeys(record, ARTIFACT_KEYS, 'artifact');

  for (const required of ARTIFACT_KEYS) {
    if (required !== 'detail' && !(required in record)) {
      schemaFail(`artifact.${required}`, 'required_property_missing');
    }
  }

  expectConst(record.schemaVersion, 'artifact.schemaVersion', SOURCE_EXTRACTION_SCHEMA_VERSION);
  expectConst(record.offsetUnit, 'artifact.offsetUnit', OFFSET_UNIT);

  const sourceType = expectOneOf(record.sourceType, 'artifact.sourceType', SOURCE_TYPES);
  const coverageStatus = expectOneOf<CoverageStatus>(
    record.coverageStatus,
    'artifact.coverageStatus',
    COVERAGE_STATUSES
  );

  const pages = expectArray(record.pages, 'artifact.pages').map((page, index) =>
    validatePage(page, `artifact.pages[${index}]`)
  );
  const segments = expectArray(record.segments, 'artifact.segments').map((segment, index) =>
    validateSegment(segment, `artifact.segments[${index}]`)
  );
  const diagnostics = expectArray(record.diagnostics, 'artifact.diagnostics').map(
    (diagnostic, index) => validateDiagnostic(diagnostic, `artifact.diagnostics[${index}]`)
  );

  const common = {
    schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION,
    offsetUnit: OFFSET_UNIT,
    coverageStatus,
    pages,
    documentCanonicalText: expectString(
      record.documentCanonicalText,
      'artifact.documentCanonicalText'
    ),
    segments,
    diagnostics,
    artifactContentFingerprint: expectSha256Hex(
      record.artifactContentFingerprint,
      'artifact.artifactContentFingerprint'
    )
  } as const;

  const identity = expectPlainObject(record.extractionIdentity, 'artifact.extractionIdentity');
  expectConst(
    identity.schemaVersion,
    'artifact.extractionIdentity.schemaVersion',
    SOURCE_EXTRACTION_SCHEMA_VERSION
  );
  const implementationVersion = expectNonEmptyString(
    identity.implementationVersion,
    'artifact.extractionIdentity.implementationVersion'
  );

  const source = expectPlainObject(record.source, 'artifact.source');

  if (sourceType === 'PDF_DOCUMENT') {
    expectNoUnknownKeys(
      identity,
      new Set(['schemaVersion', 'implementationVersion', 'parserProfile', 'dependencyFingerprint']),
      'artifact.extractionIdentity'
    );
    expectNoUnknownKeys(
      source,
      new Set(['documentEvidenceId', 'sourceSha256', 'storageKey']),
      'artifact.source'
    );

    return {
      ...common,
      sourceType: 'PDF_DOCUMENT',
      source: {
        documentEvidenceId: expectNonEmptyString(
          source.documentEvidenceId,
          'artifact.source.documentEvidenceId'
        ),
        sourceSha256: expectSha256Hex(source.sourceSha256, 'artifact.source.sourceSha256'),
        storageKey: expectNonEmptyString(source.storageKey, 'artifact.source.storageKey')
      },
      extractionIdentity: {
        schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION,
        implementationVersion,
        parserProfile: expectOneOf<PdfParserProfile>(
          identity.parserProfile,
          'artifact.extractionIdentity.parserProfile',
          PDF_PARSER_PROFILES
        ),
        dependencyFingerprint: expectSha256Hex(
          identity.dependencyFingerprint,
          'artifact.extractionIdentity.dependencyFingerprint'
        )
      },
      sourceNormalizationApplied: expectConst(
        record.sourceNormalizationApplied,
        'artifact.sourceNormalizationApplied',
        'NONE'
      )
    };
  }

  // TEXT. `dependencyFingerprint` esta ESTRUCTURALMENTE PROHIBIDO: no declarado
  // y `additionalProperties: false`, asi que su presencia es un error de forma
  // y no una convencion documentada. No se acepta ni siquiera en `null`.
  expectNoUnknownKeys(
    identity,
    new Set(['schemaVersion', 'implementationVersion', 'parserProfile']),
    'artifact.extractionIdentity'
  );
  expectNoUnknownKeys(source, new Set(['textEvidenceId', 'sourceSha256']), 'artifact.source');

  if (pages.length > 0) {
    schemaFail('artifact.pages', 'text_source_must_have_zero_pages');
  }

  return {
    ...common,
    sourceType: 'TEXT',
    pages: [],
    source: {
      textEvidenceId: expectNonEmptyString(
        source.textEvidenceId,
        'artifact.source.textEvidenceId'
      ),
      sourceSha256: expectSha256Hex(source.sourceSha256, 'artifact.source.sourceSha256')
    },
    extractionIdentity: {
      schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION,
      implementationVersion,
      parserProfile: expectConst(
        identity.parserProfile,
        'artifact.extractionIdentity.parserProfile',
        TEXT_PARSER_PROFILE
      )
    },
    sourceNormalizationApplied: expectConst(
      record.sourceNormalizationApplied,
      'artifact.sourceNormalizationApplied',
      'PRODUCT_NFC_LINEENDINGS_TRIM'
    )
  };
}
