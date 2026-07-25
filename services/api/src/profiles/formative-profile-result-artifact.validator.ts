import { BadRequestException } from '@nestjs/common';

import {
  FORMATIVE_PROFILE_CONFIDENCE_BANDS,
  FORMATIVE_PROFILE_RESULT_VERSION,
  FORMATIVE_PROFILE_SCORE_METHODS,
  FORMATIVE_PROFILE_SKILL_SOURCES,
  FORMATIVE_PROFILE_SOURCE_TYPES,
  type FormativeProfileArea,
  type FormativeProfileAudit,
  type FormativeProfileConcept,
  type FormativeProfileEvidence,
  type FormativeProfileResultArtifact,
  type FormativeProfileSkill,
  type FormativeProfileSourceRef,
  type FormativeProfileSourceType
} from './formative-profile-result-artifact.types';

const TOP_LEVEL_FIELDS = [
  'profileVersion',
  'generatedFrom',
  'summary',
  'confidence',
  'areas',
  'skills',
  'concepts',
  'strengths',
  'possibleDirections',
  'limitations',
  'warnings',
  'evidence',
  'audit'
] as const;

const EVIDENCE_OVERVIEW_FIELDS = [
  'artifacts_with_area_evidence',
  'artifacts_with_skill_evidence',
  'artifacts_with_concept_evidence',
  'total_area_evidence_entries',
  'total_skill_evidence_entries',
  'total_concept_evidence_entries'
] as const;

export function validateFormativeProfileResultArtifact(
  input: unknown
): FormativeProfileResultArtifact {
  const artifact = expectPlainObject(input, 'artifact');
  expectExactFields(artifact, TOP_LEVEL_FIELDS, 'artifact');

  const profileVersion = expectString(
    artifact.profileVersion,
    'profileVersion'
  );
  if (profileVersion !== FORMATIVE_PROFILE_RESULT_VERSION) {
    throw new BadRequestException(
      `unsupported formative profile version: ${profileVersion}`
    );
  }

  const generatedFrom = expectPlainObject(
    artifact.generatedFrom,
    'generatedFrom'
  );
  expectExactFields(
    generatedFrom,
    [
      'artifactSchema',
      'artifactCount',
      'sourceTypes',
      'pipelineVersions',
      'taxonomyVersions'
    ],
    'generatedFrom'
  );
  if (generatedFrom.artifactSchema !== 'semantic_analysis_v1') {
    throw new BadRequestException(
      'generatedFrom.artifactSchema must be semantic_analysis_v1'
    );
  }

  const summary = expectPlainObject(artifact.summary, 'summary');
  expectExactFields(summary, ['text', 'language', 'style'], 'summary');
  if (summary.language !== 'es') {
    throw new BadRequestException('summary.language must be es');
  }
  if (summary.style !== 'cautious_explanatory') {
    throw new BadRequestException(
      'summary.style must be cautious_explanatory'
    );
  }

  const confidence = expectPlainObject(artifact.confidence, 'confidence');
  expectExactFields(
    confidence,
    [
      'band',
      'score',
      'scoreMethod',
      'explanation',
      'drivers',
      'limitations'
    ],
    'confidence'
  );
  if (confidence.score !== null) {
    throw new BadRequestException(
      'confidence.score must be null for formative_profile_result_v0'
    );
  }

  return {
    profileVersion: FORMATIVE_PROFILE_RESULT_VERSION,
    generatedFrom: validateGeneratedFrom(artifact.generatedFrom),
    summary: validateSummary(artifact.summary),
    confidence: validateConfidence(artifact.confidence),
    areas: validateDescriptorArray(
      artifact.areas,
      'area'
    ) as FormativeProfileArea[],
    skills: validateDescriptorArray(
      artifact.skills,
      'skill'
    ) as FormativeProfileSkill[],
    concepts: validateDescriptorArray(
      artifact.concepts,
      'concept'
    ) as FormativeProfileConcept[],
    strengths: expectStringArray(artifact.strengths, 'strengths'),
    possibleDirections: expectStringArray(
      artifact.possibleDirections,
      'possibleDirections'
    ),
    limitations: expectStringArray(artifact.limitations, 'limitations'),
    warnings: expectStringArray(artifact.warnings, 'warnings'),
    evidence: validateEvidence(artifact.evidence),
    audit: validateAudit(artifact.audit)
  };
}

function validateGeneratedFrom(value: unknown) {
  const generatedFrom = expectPlainObject(value, 'generatedFrom');
  return {
    artifactSchema: 'semantic_analysis_v1' as const,
    artifactCount: expectNonNegativeInteger(
      generatedFrom.artifactCount,
      'generatedFrom.artifactCount'
    ),
    sourceTypes: expectSourceTypeCounts(
      generatedFrom.sourceTypes,
      'generatedFrom.sourceTypes'
    ),
    pipelineVersions: expectNonEmptyStringArray(
      generatedFrom.pipelineVersions,
      'generatedFrom.pipelineVersions'
    ),
    taxonomyVersions: expectNonEmptyStringArray(
      generatedFrom.taxonomyVersions,
      'generatedFrom.taxonomyVersions'
    )
  };
}

function validateSummary(value: unknown) {
  const summary = expectPlainObject(value, 'summary');
  return {
    text: expectString(summary.text, 'summary.text'),
    language: 'es' as const,
    style: 'cautious_explanatory' as const
  };
}

function validateConfidence(value: unknown) {
  const confidence = expectPlainObject(value, 'confidence');
  return {
    band: expectOneOf(
      confidence.band,
      'confidence.band',
      FORMATIVE_PROFILE_CONFIDENCE_BANDS
    ),
    score: null,
    scoreMethod: expectOneOf(
      confidence.scoreMethod,
      'confidence.scoreMethod',
      FORMATIVE_PROFILE_SCORE_METHODS
    ),
    explanation: expectString(
      confidence.explanation,
      'confidence.explanation'
    ),
    drivers: expectStringArray(confidence.drivers, 'confidence.drivers'),
    limitations: expectStringArray(
      confidence.limitations,
      'confidence.limitations'
    )
  };
}

function validateDescriptorArray(
  value: unknown,
  kind: 'area' | 'skill' | 'concept'
): Array<FormativeProfileArea | FormativeProfileSkill | FormativeProfileConcept> {
  const path = `${kind}s`;
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }

  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const descriptor = expectPlainObject(entry, entryPath);
    const common = {
      id: expectNonEmptyString(descriptor.id, `${entryPath}.id`),
      label: expectNonEmptyString(descriptor.label, `${entryPath}.label`),
      evidenceCount: expectPositiveInteger(
        descriptor.evidenceCount,
        `${entryPath}.evidenceCount`
      ),
      confidence: expectNullableConfidence(
        descriptor.confidence,
        `${entryPath}.confidence`
      ),
      sourceTypes: expectSourceTypeArray(
        descriptor.sourceTypes,
        `${entryPath}.sourceTypes`
      ),
      sourceRefs: expectSourceRefArray(
        descriptor.sourceRefs,
        `${entryPath}.sourceRefs`
      )
    };

    if (kind === 'area') {
      expectExactFields(
        descriptor,
        [
          'id',
          'label',
          'evidenceCount',
          'hours',
          'confidence',
          'sourceTypes',
          'sourceRefs'
        ],
        entryPath
      );
      return {
        ...common,
        hours: expectNullableNonNegativeNumber(
          descriptor.hours,
          `${entryPath}.hours`
        )
      };
    }

    if (kind === 'skill') {
      expectExactFields(
        descriptor,
        [
          'id',
          'label',
          'evidenceCount',
          'confidence',
          'source',
          'sourceTypes',
          'sourceRefs'
        ],
        entryPath
      );
      return {
        ...common,
        source: expectOneOf(
          descriptor.source,
          `${entryPath}.source`,
          FORMATIVE_PROFILE_SKILL_SOURCES
        )
      };
    }

    expectExactFields(
      descriptor,
      [
        'id',
        'label',
        'evidenceCount',
        'confidence',
        'sourceTypes',
        'sourceRefs'
      ],
      entryPath
    );
    return common;
  });
}

function validateEvidence(value: unknown): FormativeProfileEvidence {
  const evidence = expectPlainObject(value, 'evidence');
  expectExactFields(
    evidence,
    ['sourceCoverage', 'evidenceOverview', 'sourceRefs'],
    'evidence'
  );

  const sourceCoverage = expectPlainObject(
    evidence.sourceCoverage,
    'evidence.sourceCoverage'
  );
  expectExactFields(
    sourceCoverage,
    ['sourceArtifactsCount', 'bySourceType', 'sourceRefs', 'note'],
    'evidence.sourceCoverage'
  );

  const evidenceOverview = expectPlainObject(
    evidence.evidenceOverview,
    'evidence.evidenceOverview'
  );
  expectExactFields(
    evidenceOverview,
    EVIDENCE_OVERVIEW_FIELDS,
    'evidence.evidenceOverview'
  );

  return {
    sourceCoverage: {
      sourceArtifactsCount: expectNonNegativeInteger(
        sourceCoverage.sourceArtifactsCount,
        'evidence.sourceCoverage.sourceArtifactsCount'
      ),
      bySourceType: expectSourceTypeCounts(
        sourceCoverage.bySourceType,
        'evidence.sourceCoverage.bySourceType'
      ),
      sourceRefs: expectSourceRefArray(
        sourceCoverage.sourceRefs,
        'evidence.sourceCoverage.sourceRefs'
      ),
      note: expectString(sourceCoverage.note, 'evidence.sourceCoverage.note')
    },
    evidenceOverview: Object.fromEntries(
      EVIDENCE_OVERVIEW_FIELDS.map((field) => [
        field,
        expectNonNegativeInteger(
          evidenceOverview[field],
          `evidence.evidenceOverview.${field}`
        )
      ])
    ) as unknown as FormativeProfileEvidence['evidenceOverview'],
    sourceRefs: expectSourceRefArray(
      evidence.sourceRefs,
      'evidence.sourceRefs'
    )
  };
}

function validateAudit(value: unknown): FormativeProfileAudit {
  const audit = expectPlainObject(value, 'audit');
  expectExactFields(
    audit,
    [
      'qualityFlags',
      'partialReasons',
      'rawWarningCodes',
      'rawPartialReasonCodes'
    ],
    'audit'
  );

  return {
    qualityFlags: expectPositiveIntegerMap(
      audit.qualityFlags,
      'audit.qualityFlags'
    ),
    partialReasons: expectPositiveIntegerMap(
      audit.partialReasons,
      'audit.partialReasons'
    ),
    rawWarningCodes: expectStringArray(
      audit.rawWarningCodes,
      'audit.rawWarningCodes'
    ),
    rawPartialReasonCodes: expectStringArray(
      audit.rawPartialReasonCodes,
      'audit.rawPartialReasonCodes'
    )
  };
}

function expectSourceRefArray(
  value: unknown,
  path: string
): FormativeProfileSourceRef[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }

  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const sourceRef = expectPlainObject(entry, entryPath);
    expectExactFields(
      sourceRef,
      ['documentId', 'fileName', 'sourceType'],
      entryPath
    );
    return {
      documentId: expectNonEmptyString(
        sourceRef.documentId,
        `${entryPath}.documentId`
      ),
      fileName:
        sourceRef.fileName === null
          ? null
          : expectString(sourceRef.fileName, `${entryPath}.fileName`),
      sourceType: expectOneOf(
        sourceRef.sourceType,
        `${entryPath}.sourceType`,
        FORMATIVE_PROFILE_SOURCE_TYPES
      )
    };
  });
}

function expectSourceTypeArray(
  value: unknown,
  path: string
): FormativeProfileSourceType[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }

  return value.map((entry, index) =>
    expectOneOf(entry, `${path}[${index}]`, FORMATIVE_PROFILE_SOURCE_TYPES)
  );
}

function expectSourceTypeCounts(
  value: unknown,
  path: string
): Partial<Record<FormativeProfileSourceType, number>> {
  const counts = expectPlainObject(value, path);
  const result: Partial<Record<FormativeProfileSourceType, number>> = {};

  for (const [key, count] of Object.entries(counts)) {
    const sourceType = expectOneOf(
      key,
      `${path} key`,
      FORMATIVE_PROFILE_SOURCE_TYPES
    );
    result[sourceType] = expectPositiveInteger(count, `${path}.${key}`);
  }

  return result;
}

function expectPositiveIntegerMap(
  value: unknown,
  path: string
): Record<string, number> {
  const counts = expectPlainObject(value, path);
  return Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [
      expectNonEmptyString(key, `${path} key`),
      expectPositiveInteger(count, `${path}.${key}`)
    ])
  );
}

function expectExactFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
  path: string
) {
  const expected = new Set(expectedFields);
  for (const field of expectedFields) {
    if (!(field in value)) {
      throw new BadRequestException(`${path}.${field} is required`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) {
      throw new BadRequestException(`${path}.${field} is not allowed`);
    }
  }
}

function expectPlainObject(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${path} must be a string`);
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  const stringValue = expectString(value, path).trim();
  if (stringValue.length === 0) {
    throw new BadRequestException(`${path} must be a non-empty string`);
  }
  return stringValue;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }
  return value.map((entry, index) =>
    expectString(entry, `${path}[${index}]`)
  );
}

function expectNonEmptyStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }
  return value.map((entry, index) =>
    expectNonEmptyString(entry, `${path}[${index}]`)
  );
}

function expectOneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowedValues: T
): T[number] {
  const stringValue = expectString(value, path);
  if (!(allowedValues as readonly string[]).includes(stringValue)) {
    throw new BadRequestException(
      `${path} must be one of: ${allowedValues.join(', ')}`
    );
  }
  return stringValue as T[number];
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException(`${path} must be a positive integer`);
  }
  return value as number;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BadRequestException(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function expectNullableConfidence(
  value: unknown,
  path: string
): number | null {
  if (value === null) {
    return null;
  }
  const numberValue = expectFiniteNumber(value, path);
  if (numberValue < 0 || numberValue > 1) {
    throw new BadRequestException(`${path} must be between 0 and 1`);
  }
  return numberValue;
}

function expectNullableNonNegativeNumber(
  value: unknown,
  path: string
): number | null {
  if (value === null) {
    return null;
  }
  const numberValue = expectFiniteNumber(value, path);
  if (numberValue < 0) {
    throw new BadRequestException(`${path} must be greater than or equal to 0`);
  }
  return numberValue;
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  ) {
    throw new BadRequestException(`${path} must be a finite number`);
  }
  return value;
}
