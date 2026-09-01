/**
 * Tipos congelados de `source_extraction_v1`.
 *
 * Reflejan literalmente `packages/schemas/source_extraction_v1.schema.json`,
 * incluidas sus dos formas discriminadas. El repo no tiene motor de JSON Schema
 * en runtime —la convencion establecida es el validador estructural escrito a
 * mano, ver `semantic/semantic-analysis-artifact.validator.ts`— asi que la
 * fidelidad al schema se demuestra por test contra el corpus congelado de F0.1,
 * no por construccion. Ver el registro de F0.4.
 */

export const SOURCE_EXTRACTION_SCHEMA_VERSION = 'source_extraction_v1';

export const SOURCE_TYPES = ['PDF_DOCUMENT', 'TEXT'] as const;
export type SourceExtractionSourceType = typeof SOURCE_TYPES[number];

export const OFFSET_UNIT = 'UNICODE_CODE_POINT';

export const SOURCE_NORMALIZATIONS = [
  'NONE',
  'PRODUCT_NFC_LINEENDINGS_TRIM'
] as const;
export type SourceNormalization = typeof SOURCE_NORMALIZATIONS[number];

export const PDF_PARSER_PROFILES = ['PDFPLUMBER', 'PYPDF'] as const;
export type PdfParserProfile = typeof PDF_PARSER_PROFILES[number];

export const TEXT_PARSER_PROFILE = 'TEXT_DIRECT';

export const COVERAGE_STATUSES = ['FULL', 'PARTIAL', 'FAILED'] as const;
export type CoverageStatus = typeof COVERAGE_STATUSES[number];

export const PAGE_OBSERVATION_STATUSES = [
  'EXTRACTED',
  'OBSERVED_EMPTY',
  'UNOBSERVED_OR_UNEXTRACTABLE',
  'FAILED'
] as const;
export type PageObservationStatus = typeof PAGE_OBSERVATION_STATUSES[number];

export const DIAGNOSTIC_CODES = [
  'PAGE_OBSERVED_EMPTY',
  'PAGE_UNOBSERVED_OR_UNEXTRACTABLE',
  'PAGE_EXTRACTION_FAILED',
  'SOURCE_NO_EXTRACTABLE_TEXT',
  'ENCRYPTED_PDF',
  'UNSUPPORTED_SOURCE',
  'SOURCE_UNREADABLE',
  'PRIMARY_PARSER_FAILED_FELL_BACK',
  'EMPTY_SOURCE_TEXT'
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];

export const DIAGNOSTIC_SEVERITIES = ['INFO', 'WARNING', 'ERROR'] as const;
export type DiagnosticSeverity = typeof DIAGNOSTIC_SEVERITIES[number];

export const DIAGNOSTIC_SCOPES = ['SOURCE', 'PAGE'] as const;
export type DiagnosticScope = typeof DIAGNOSTIC_SCOPES[number];

export const DIAGNOSTIC_DETAIL_MAX_LENGTH = 200;

/** Dos code points entre paginas: la convencion de union congelada. */
export const PAGE_JOIN = '\n\n';

/**
 * Tabla independiente de combinaciones validas, congelada por el diseño §9.
 *
 * Se declara aca de nuevo y no se importa de ningun lado: el punto de F0.4 es
 * que dos implementaciones coincidan partiendo del mismo contrato escrito, no
 * que compartan una fuente de verdad que podria estar mal en las dos.
 */
export const DIAGNOSTIC_TABLE: ReadonlyMap<
  DiagnosticCode,
  { severity: DiagnosticSeverity; scope: DiagnosticScope; affectsCoverage: boolean }
> = new Map([
  ['PAGE_OBSERVED_EMPTY', { severity: 'INFO', scope: 'PAGE', affectsCoverage: false }],
  ['PAGE_UNOBSERVED_OR_UNEXTRACTABLE', { severity: 'WARNING', scope: 'PAGE', affectsCoverage: true }],
  ['PAGE_EXTRACTION_FAILED', { severity: 'ERROR', scope: 'PAGE', affectsCoverage: true }],
  ['SOURCE_NO_EXTRACTABLE_TEXT', { severity: 'ERROR', scope: 'SOURCE', affectsCoverage: true }],
  ['ENCRYPTED_PDF', { severity: 'ERROR', scope: 'SOURCE', affectsCoverage: true }],
  ['UNSUPPORTED_SOURCE', { severity: 'ERROR', scope: 'SOURCE', affectsCoverage: true }],
  ['SOURCE_UNREADABLE', { severity: 'ERROR', scope: 'SOURCE', affectsCoverage: true }],
  ['PRIMARY_PARSER_FAILED_FELL_BACK', { severity: 'WARNING', scope: 'SOURCE', affectsCoverage: false }],
  ['EMPTY_SOURCE_TEXT', { severity: 'INFO', scope: 'SOURCE', affectsCoverage: false }]
] as const);

/**
 * Orden canonico de los diagnosticos de fuente, congelado por F0.2 §10.
 *
 * Los diagnosticos entran en la material projection, asi que su orden es parte
 * del fingerprint. Un artifact podria reordenarlos, recalcular su propio
 * fingerprint y quedar internamente consistente — pero ya no representaria la
 * forma canonica producida bajo esa extractionIdentity.
 */
export const SOURCE_DIAGNOSTIC_ORDER: readonly DiagnosticCode[] = [
  'PRIMARY_PARSER_FAILED_FELL_BACK',
  'SOURCE_NO_EXTRACTABLE_TEXT',
  'ENCRYPTED_PDF',
  'UNSUPPORTED_SOURCE',
  'SOURCE_UNREADABLE'
] as const;

export interface PdfSourceRef {
  documentEvidenceId: string;
  sourceSha256: string;
  storageKey: string;
}

export interface TextSourceRef {
  textEvidenceId: string;
  sourceSha256: string;
}

export interface PdfExtractionIdentity {
  schemaVersion: typeof SOURCE_EXTRACTION_SCHEMA_VERSION;
  implementationVersion: string;
  parserProfile: PdfParserProfile;
  dependencyFingerprint: string;
}

export interface TextExtractionIdentity {
  schemaVersion: typeof SOURCE_EXTRACTION_SCHEMA_VERSION;
  implementationVersion: string;
  parserProfile: typeof TEXT_PARSER_PROFILE;
}

export interface ExtractionPage {
  pageIndex: number;
  pageNumber: number;
  canonicalText: string;
  pageOffsetStart: number;
  pageOffsetEnd: number;
  pageObservationStatus: PageObservationStatus;
}

export interface ExtractionSegment {
  segmentId: string;
  pageIndex: number | null;
  charStart: number;
  charEnd: number;
  exactExcerpt: string;
}

export interface ExtractionDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  scope: DiagnosticScope;
  pageIndex: number | null;
  affectsCoverage: boolean;
  detail?: string;
}

interface ExtractionArtifactBase {
  schemaVersion: typeof SOURCE_EXTRACTION_SCHEMA_VERSION;
  offsetUnit: typeof OFFSET_UNIT;
  coverageStatus: CoverageStatus;
  pages: ExtractionPage[];
  documentCanonicalText: string;
  segments: ExtractionSegment[];
  diagnostics: ExtractionDiagnostic[];
  artifactContentFingerprint: string;
}

export interface PdfExtractionArtifact extends ExtractionArtifactBase {
  sourceType: 'PDF_DOCUMENT';
  source: PdfSourceRef;
  extractionIdentity: PdfExtractionIdentity;
  sourceNormalizationApplied: 'NONE';
}

export interface TextExtractionArtifact extends ExtractionArtifactBase {
  sourceType: 'TEXT';
  source: TextSourceRef;
  extractionIdentity: TextExtractionIdentity;
  sourceNormalizationApplied: 'PRODUCT_NFC_LINEENDINGS_TRIM';
  pages: [];
}

export type SourceExtractionArtifact =
  | PdfExtractionArtifact
  | TextExtractionArtifact;

/** Snapshot verificado: profundamente inmutable y desacoplado del input. */
export type VerifiedSourceExtractionArtifact =
  DeepReadonly<SourceExtractionArtifact>;

export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
