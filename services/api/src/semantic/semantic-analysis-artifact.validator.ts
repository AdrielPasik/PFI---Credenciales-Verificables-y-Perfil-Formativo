import { BadRequestException } from '@nestjs/common';

import {
  SEMANTIC_ANALYSIS_CONFIDENCE_METHODS,
  SEMANTIC_ANALYSIS_SCHEMA_VERSION,
  SEMANTIC_ANALYSIS_SOURCE_TYPES,
  SEMANTIC_ANALYSIS_STATUSES,
  type SemanticAnalysisArtifact,
  type SemanticAnalysisArtifactConfidence,
  type SemanticAnalysisArtifactDescriptor,
  type SemanticAnalysisArtifactHoursDistributionEntry,
  type SemanticAnalysisArtifactSourceRefs
} from './semantic-analysis-artifact.types';

export function validateSemanticAnalysisArtifact(
  input: unknown
): SemanticAnalysisArtifact {
  const artifact = expectPlainObject(input, 'artifact');

  if (!('schemaVersion' in artifact)) {
    throw new BadRequestException(
      'semantic_analysis artifact must include schemaVersion'
    );
  }

  const schemaVersion = expectString(artifact.schemaVersion, 'schemaVersion');
  if (schemaVersion !== SEMANTIC_ANALYSIS_SCHEMA_VERSION) {
    throw new BadRequestException(
      `unsupported semantic analysis schemaVersion: ${schemaVersion}`
    );
  }

  const pipelineVersion = expectNonEmptyString(
    artifact.pipelineVersion,
    'pipelineVersion'
  );
  const taxonomyVersion = expectNonEmptyString(
    artifact.taxonomyVersion,
    'taxonomyVersion'
  );
  const status = expectOneOf(
    artifact.status,
    'status',
    SEMANTIC_ANALYSIS_STATUSES
  );
  const sourceType = expectOneOf(
    artifact.sourceType,
    'sourceType',
    SEMANTIC_ANALYSIS_SOURCE_TYPES
  );
  const sourceRefs = expectPlainObject(
    artifact.sourceRefs,
    'sourceRefs'
  ) as SemanticAnalysisArtifactSourceRefs;
  const areas = expectDescriptorArray(artifact.areas, 'areas');
  const skills = expectDescriptorArray(artifact.skills, 'skills');
  const concepts = expectDescriptorArray(artifact.concepts, 'concepts');
  const hoursDistribution = expectHoursDistributionArray(
    artifact.hoursDistribution,
    'hoursDistribution'
  );
  const evidenceMap = expectPlainObject(
    artifact.evidenceMap,
    'evidenceMap'
  ) as Record<string, unknown>;
  const confidence = expectConfidenceObject(
    artifact.confidence,
    'confidence'
  );
  const qualityFlags = expectStringArray(artifact.qualityFlags, 'qualityFlags');
  const textForEmbedding = expectString(
    artifact.textForEmbedding,
    'textForEmbedding'
  );
  const warnings = expectStringArray(artifact.warnings, 'warnings');
  const partialReasons = expectStringArray(
    artifact.partialReasons,
    'partialReasons'
  );

  return {
    schemaVersion: SEMANTIC_ANALYSIS_SCHEMA_VERSION,
    pipelineVersion,
    taxonomyVersion,
    status,
    sourceType,
    sourceRefs,
    areas,
    skills,
    concepts,
    hoursDistribution,
    evidenceMap,
    confidence,
    qualityFlags,
    textForEmbedding,
    warnings,
    partialReasons
  };
}

function expectPlainObject(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
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

function expectNullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new BadRequestException(`${path} must be a finite number or null`);
  }

  return value;
}

function expectOptionalConfidenceMethod(
  value: unknown,
  path: string
) {
  if (value === undefined) {
    return undefined;
  }

  return expectOneOf(value, path, SEMANTIC_ANALYSIS_CONFIDENCE_METHODS);
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

function expectDescriptorArray(
  value: unknown,
  path: string
): SemanticAnalysisArtifactDescriptor[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }

  return value.map((entry, index) =>
    expectDescriptor(entry, `${path}[${index}]`)
  );
}

function expectDescriptor(
  value: unknown,
  path: string
): SemanticAnalysisArtifactDescriptor {
  const descriptor = expectPlainObject(value, path);

  return {
    ...descriptor,
    id: expectNonEmptyString(descriptor.id, `${path}.id`),
    label: expectNonEmptyString(descriptor.label, `${path}.label`),
    confidence: expectNullableNumber(
      descriptor.confidence,
      `${path}.confidence`
    ),
    confidenceMethod: expectOptionalConfidenceMethod(
      descriptor.confidenceMethod,
      `${path}.confidenceMethod`
    ),
    source:
      descriptor.source === undefined
        ? undefined
        : expectNonEmptyString(descriptor.source, `${path}.source`)
  };
}

function expectHoursDistributionArray(
  value: unknown,
  path: string
): SemanticAnalysisArtifactHoursDistributionEntry[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array`);
  }

  return value.map((entry, index) => {
    const distributionEntry = expectPlainObject(entry, `${path}[${index}]`);
    return {
      areaId: expectNonEmptyString(
        distributionEntry.areaId,
        `${path}[${index}].areaId`
      ),
      hours: expectFiniteNumber(
        distributionEntry.hours,
        `${path}[${index}].hours`
      )
    };
  });
}

function expectConfidenceObject(
  value: unknown,
  path: string
): SemanticAnalysisArtifactConfidence {
  const confidence = expectPlainObject(value, path);

  return {
    ...confidence,
    global: expectNullableNumber(confidence.global, `${path}.global`),
    globalMethod: expectOptionalConfidenceMethod(
      confidence.globalMethod,
      `${path}.globalMethod`
    ),
    coverage:
      confidence.coverage === undefined
        ? undefined
        : expectNullableNumber(confidence.coverage, `${path}.coverage`),
    coverageMethod: expectOptionalConfidenceMethod(
      confidence.coverageMethod,
      `${path}.coverageMethod`
    )
  };
}

function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new BadRequestException(`${path} must be a finite number`);
  }

  return value;
}
