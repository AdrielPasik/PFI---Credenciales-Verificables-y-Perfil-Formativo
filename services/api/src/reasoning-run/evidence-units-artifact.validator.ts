/**
 * Validador estructural de `evidence_units_v1` — slice F3.1.
 *
 * Verifica la FORMA del catalogo y de la capa determinista de preparacion.
 *
 * LO QUE NO HACE, y hay que decirlo porque es tentador: NO comprueba que
 * `exactExcerpt` sea realmente el texto entre `charStart` y `charEnd` del
 * `documentCanonicalText`, ni que el span caiga dentro de su segmento. Esa
 * verificacion profunda contra `source_extraction_v1` necesita el artifact de
 * extraccion y pertenece a F3.4. Aca se verifica forma; la pertenencia al
 * grounding congelado la verifica `verifyEvidenceUnitsAgainstRunInventory`.
 */

import {
  assertExactKeys,
  assertUnique,
  deepFreeze,
  expectArray,
  expectEnum,
  expectIdentifier,
  expectIdentifierArray,
  expectNonBlankString,
  expectNonNegativeInteger,
  expectNullableNonBlankString,
  expectNullableNonNegativeInteger,
  expectObject,
  expectPossiblyEmptyString,
  expectString,
  expectStringArray
} from './reasoning-run-artifact.primitives';
import { failArtifact } from './reasoning-run-artifact.errors';
import { verifyStageValidations } from './objective-analysis-artifact.validator';
import {
  CLAIM_TYPES,
  COVERAGE_STATUS_TOKENS,
  EVIDENCE_UNITS_SCHEMA_VERSION,
  EVIDENCE_UNIT_ID_PATTERN,
  INTERPRETATION_PROVENANCE_TOKENS,
  RUN_LOCAL_SOURCE_ID_PATTERN,
  SOURCE_PROVENANCE_TOKENS,
  type EvidenceUnitSemanticQualifier,
  type EvidenceUnitSourceTrace,
  type EvidenceUnitV1,
  type EvidenceUnitsPreparation,
  type EvidenceUnitsSource,
  type SourceObservabilityFact,
  type VerifiedEvidenceUnits
} from './reasoning-run-artifact.types';

const ROOT_KEYS = new Set([
  'schemaVersion',
  'sources',
  'evidenceUnits',
  'preparation',
  'validations'
]);
const SOURCE_KEYS = new Set(['sourceId', 'sourceProvenance']);
const UNIT_KEYS = new Set([
  'evidenceUnitId',
  'normalizedProposition',
  'claimType',
  'semanticQualifiers',
  'exactQuote',
  'contextBefore',
  'contextAfter',
  'sectionLabel',
  'sourceTrace',
  'interpretationProvenance',
  'extractionQuality'
]);
const SEMANTIC_QUALIFIER_KEYS = new Set(['kind', 'value']);
const SOURCE_TRACE_KEYS = new Set([
  'sourceId',
  'sourceSha256',
  'segmentId',
  'pageNumber',
  'charStart',
  'charEnd',
  'exactExcerpt'
]);
const PREPARATION_KEYS = new Set([
  'mode',
  'evidenceUnitIds',
  'exactRedundancyGroups',
  'sourceObservabilityFacts',
  'discardedEvidenceProposalCount'
]);
const OBSERVABILITY_FACT_KEYS = new Set([
  'sourceId',
  'coverageStatus',
  'observedEvidenceUnitIds',
  'extractionDiagnostics'
]);

const SHA256_HEX = /^[a-f0-9]{64}$/;

function verifySemanticQualifier(
  raw: unknown,
  path: string
): EvidenceUnitSemanticQualifier {
  const value = expectObject(raw, path);
  assertExactKeys(value, SEMANTIC_QUALIFIER_KEYS, path);
  return Object.freeze({
    kind: expectNonBlankString(value.kind, `${path}.kind`),
    value: expectNonBlankString(value.value, `${path}.value`)
  });
}

function verifySourceTrace(raw: unknown, path: string): EvidenceUnitSourceTrace {
  const value = expectObject(raw, path);
  assertExactKeys(value, SOURCE_TRACE_KEYS, path);

  const sourceSha256 = expectString(value.sourceSha256, `${path}.sourceSha256`);
  if (!SHA256_HEX.test(sourceSha256)) {
    failArtifact('SCHEMA_INVALID', {
      invariant: 'source_sha256_must_be_lowercase_hex_of_64_chars',
      path: `${path}.sourceSha256`
    });
  }

  const charStart = expectNonNegativeInteger(
    value.charStart,
    `${path}.charStart`
  );
  const charEnd = expectNonNegativeInteger(value.charEnd, `${path}.charEnd`);
  // Un span vacio no es una cita: el aligner congelado nunca produce charEnd
  // igual a charStart, porque un EvidenceUnit sin texto no ancla nada.
  if (charEnd <= charStart) {
    failArtifact('SPAN_INVALID', {
      invariant: 'char_end_must_be_strictly_greater_than_char_start',
      path: `${path}.charEnd`
    });
  }

  return Object.freeze({
    sourceId: expectIdentifier(
      value.sourceId,
      RUN_LOCAL_SOURCE_ID_PATTERN,
      `${path}.sourceId`
    ),
    sourceSha256,
    segmentId: expectNullableNonBlankString(
      value.segmentId,
      `${path}.segmentId`
    ),
    pageNumber: expectNullableNonNegativeInteger(
      value.pageNumber,
      `${path}.pageNumber`
    ),
    charStart,
    charEnd,
    exactExcerpt: expectNonBlankString(
      value.exactExcerpt,
      `${path}.exactExcerpt`
    )
  });
}

function verifyEvidenceUnit(raw: unknown, path: string): EvidenceUnitV1 {
  const value = expectObject(raw, path);
  assertExactKeys(value, UNIT_KEYS, path);

  return Object.freeze({
    evidenceUnitId: expectIdentifier(
      value.evidenceUnitId,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.evidenceUnitId`
    ),
    normalizedProposition: expectNonBlankString(
      value.normalizedProposition,
      `${path}.normalizedProposition`
    ),
    claimType: expectEnum(value.claimType, CLAIM_TYPES, `${path}.claimType`),
    semanticQualifiers: Object.freeze(
      expectArray(
        value.semanticQualifiers,
        `${path}.semanticQualifiers`
      ).map((item, index) =>
        verifySemanticQualifier(item, `${path}.semanticQualifiers[${index}]`)
      )
    ),
    exactQuote: expectNonBlankString(value.exactQuote, `${path}.exactQuote`),
    // Vacios legitimos: una cita al principio o al final de la fuente.
    contextBefore: expectPossiblyEmptyString(
      value.contextBefore,
      `${path}.contextBefore`
    ),
    contextAfter: expectPossiblyEmptyString(
      value.contextAfter,
      `${path}.contextAfter`
    ),
    sectionLabel: expectNullableNonBlankString(
      value.sectionLabel,
      `${path}.sectionLabel`
    ),
    sourceTrace: verifySourceTrace(value.sourceTrace, `${path}.sourceTrace`),
    interpretationProvenance: expectEnum(
      value.interpretationProvenance,
      INTERPRETATION_PROVENANCE_TOKENS,
      `${path}.interpretationProvenance`
    ),
    extractionQuality: expectEnum(
      value.extractionQuality,
      COVERAGE_STATUS_TOKENS,
      `${path}.extractionQuality`
    )
  });
}

/**
 * Una declaracion de fuente. `sourceProvenance` es AUTORIDAD DE ASERCION y su
 * vocabulario tiene UN solo miembro, asi que se rechaza con codigo propio en vez
 * del generico de enum: `INSTITUTIONALLY_DECLARED`, `SYSTEM_GENERATED` o
 * `issuer_declared` no son "un token mas que falta", son otra semantica.
 */
function verifySourceDeclaration(raw: unknown, path: string): EvidenceUnitsSource {
  const value = expectObject(raw, path);
  assertExactKeys(value, SOURCE_KEYS, path);

  const provenance = value.sourceProvenance;
  if (
    typeof provenance !== 'string' ||
    !(SOURCE_PROVENANCE_TOKENS as readonly string[]).includes(provenance)
  ) {
    failArtifact('SOURCE_PROVENANCE_INVALID', {
      invariant: 'source_provenance_is_the_single_frozen_assertion_authority_token',
      path: `${path}.sourceProvenance`,
      observed:
        typeof provenance === 'string' ? provenance.slice(0, 64) : typeof provenance
    });
  }

  return Object.freeze({
    sourceId: expectIdentifier(
      value.sourceId,
      RUN_LOCAL_SOURCE_ID_PATTERN,
      `${path}.sourceId`
    ),
    sourceProvenance: provenance as EvidenceUnitsSource['sourceProvenance']
  });
}

function verifyObservabilityFact(
  raw: unknown,
  path: string
): SourceObservabilityFact {
  const value = expectObject(raw, path);
  assertExactKeys(value, OBSERVABILITY_FACT_KEYS, path);
  return Object.freeze({
    sourceId: expectIdentifier(
      value.sourceId,
      RUN_LOCAL_SOURCE_ID_PATTERN,
      `${path}.sourceId`
    ),
    coverageStatus: expectEnum(
      value.coverageStatus,
      COVERAGE_STATUS_TOKENS,
      `${path}.coverageStatus`
    ),
    observedEvidenceUnitIds: expectIdentifierArray(
      value.observedEvidenceUnitIds,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.observedEvidenceUnitIds`
    ),
    extractionDiagnostics: expectStringArray(
      value.extractionDiagnostics,
      `${path}.extractionDiagnostics`
    )
  });
}

function verifyPreparation(
  raw: unknown,
  path: string,
  catalogIds: readonly string[]
): EvidenceUnitsPreparation {
  const value = expectObject(raw, path);
  assertExactKeys(value, PREPARATION_KEYS, path);

  if (value.mode !== 'FULL_SCAN') {
    failArtifact('ENUM_TOKEN_UNSUPPORTED', {
      invariant: 'evidence_preparation_mode_is_full_scan_in_v1',
      path: `${path}.mode`,
      observed: typeof value.mode === 'string' ? value.mode.slice(0, 64) : typeof value.mode
    });
  }

  const evidenceUnitIds = expectIdentifierArray(
    value.evidenceUnitIds,
    EVIDENCE_UNIT_ID_PATTERN,
    `${path}.evidenceUnitIds`
  );

  // `preparation.evidenceUnitIds` es el indice del propio catalogo del artifact.
  // Si no coincide exactamente, uno de los dos miente sobre que se preparo.
  const catalog = new Set(catalogIds);
  if (
    evidenceUnitIds.length !== catalogIds.length ||
    evidenceUnitIds.some((id) => !catalog.has(id))
  ) {
    failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
      invariant: 'preparation_index_must_match_the_catalog_exactly',
      path: `${path}.evidenceUnitIds`,
      observed: `prepared=${evidenceUnitIds.length};catalog=${catalogIds.length}`
    });
  }

  const groups = expectArray(
    value.exactRedundancyGroups,
    `${path}.exactRedundancyGroups`
  ).map((group, index) =>
    expectIdentifierArray(
      group,
      EVIDENCE_UNIT_ID_PATTERN,
      `${path}.exactRedundancyGroups[${index}]`
    )
  );

  for (const [index, group] of groups.entries()) {
    for (const [position, id] of group.entries()) {
      if (!catalog.has(id)) {
        failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
          invariant: 'redundancy_groups_reference_catalog_units_only',
          path: `${path}.exactRedundancyGroups[${index}][${position}]`,
          observed: id
        });
      }
    }
  }

  const facts = expectArray(
    value.sourceObservabilityFacts,
    `${path}.sourceObservabilityFacts`
  ).map((item, index) =>
    verifyObservabilityFact(item, `${path}.sourceObservabilityFacts[${index}]`)
  );

  assertUnique(
    facts.map((fact) => fact.sourceId),
    'IDENTIFIER_DUPLICATED',
    'one_observability_fact_per_source',
    `${path}.sourceObservabilityFacts`
  );

  for (const [index, fact] of facts.entries()) {
    for (const [position, id] of fact.observedEvidenceUnitIds.entries()) {
      if (!catalog.has(id)) {
        failArtifact('EVIDENCE_UNIT_REFERENCE_UNKNOWN', {
          invariant: 'observed_evidence_unit_ids_reference_catalog_units_only',
          path: `${path}.sourceObservabilityFacts[${index}].observedEvidenceUnitIds[${position}]`,
          observed: id
        });
      }
    }
  }

  return Object.freeze({
    mode: 'FULL_SCAN' as const,
    evidenceUnitIds,
    exactRedundancyGroups: Object.freeze(groups),
    sourceObservabilityFacts: Object.freeze(facts),
    discardedEvidenceProposalCount: expectNonNegativeInteger(
      value.discardedEvidenceProposalCount,
      `${path}.discardedEvidenceProposalCount`
    )
  });
}

export function verifyEvidenceUnitsArtifact(
  input: unknown
): VerifiedEvidenceUnits {
  const root = expectObject(input, 'evidenceUnits');
  assertExactKeys(root, ROOT_KEYS, 'evidenceUnits');

  if (root.schemaVersion !== EVIDENCE_UNITS_SCHEMA_VERSION) {
    failArtifact('SCHEMA_VERSION_UNSUPPORTED', {
      invariant: 'schema_version_must_be_the_single_supported_one',
      path: 'evidenceUnits.schemaVersion',
      observed: typeof root.schemaVersion === 'string'
        ? root.schemaVersion.slice(0, 64)
        : typeof root.schemaVersion
    });
  }

  const sources = expectArray(root.sources, 'evidenceUnits.sources').map(
    (item, index) => verifySourceDeclaration(item, `evidenceUnits.sources[${index}]`)
  );

  assertUnique(
    sources.map((source) => source.sourceId),
    'SOURCE_DECLARATION_DUPLICATE',
    'one_declaration_per_source_within_a_run',
    'evidenceUnits.sources'
  );

  const units = expectArray(
    root.evidenceUnits,
    'evidenceUnits.evidenceUnits'
  ).map((item, index) =>
    verifyEvidenceUnit(item, `evidenceUnits.evidenceUnits[${index}]`)
  );

  const ids = units.map((unit) => unit.evidenceUnitId);
  assertUnique(
    ids,
    'IDENTIFIER_DUPLICATED',
    'evidence_unit_ids_are_unique_within_a_run',
    'evidenceUnits.evidenceUnits'
  );

  // Toda fuente citada tiene que estar declarada: sin eso, una unidad podria
  // apoyarse en material cuya autoridad de asercion el artifact nunca fijo.
  const declared = new Set(sources.map((source) => source.sourceId));
  for (const [index, unit] of units.entries()) {
    if (!declared.has(unit.sourceTrace.sourceId)) {
      failArtifact('SOURCE_DECLARATION_MISSING', {
        invariant: 'every_cited_source_is_declared_with_its_assertion_authority',
        path: `evidenceUnits.evidenceUnits[${index}].sourceTrace.sourceId`,
        observed: unit.sourceTrace.sourceId
      });
    }
  }

  return deepFreeze({
    schemaVersion: EVIDENCE_UNITS_SCHEMA_VERSION,
    sources: Object.freeze(sources),
    evidenceUnits: Object.freeze(units),
    preparation: verifyPreparation(
      root.preparation,
      'evidenceUnits.preparation',
      ids
    ),
    validations: verifyStageValidations(
      root.validations,
      'evidenceUnits.validations'
    )
  } as VerifiedEvidenceUnits);
}
