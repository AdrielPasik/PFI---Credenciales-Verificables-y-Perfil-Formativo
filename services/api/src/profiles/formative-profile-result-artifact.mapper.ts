import {
  FORMATIVE_PROFILE_AI_GENERATION_METHOD,
  type FormativeProfileResultArtifact,
  type FormativeProfileResultArtifactMapping
} from './formative-profile-result-artifact.types';
import { validateFormativeProfileResultArtifact } from './formative-profile-result-artifact.validator';

export function mapFormativeProfileResultArtifact(
  input: unknown
): FormativeProfileResultArtifactMapping {
  const artifact = validateFormativeProfileResultArtifact(input);
  const knownHours = artifact.areas
    .map((area) => area.hours)
    .filter((hours): hours is number => typeof hours === 'number');

  return {
    profileVersion: artifact.profileVersion,
    generationMethod: FORMATIVE_PROFILE_AI_GENERATION_METHOD,
    // artifactCount counts source semantic artifacts, not completed credentials.
    credentialsCount: artifact.generatedFrom.artifactCount,
    totalHours: round(sum(knownHours), 2),
    areasSummary: cloneJsonLike(artifact.areas),
    skillsSummary: cloneJsonLike(artifact.skills),
    evidenceByArea: artifact.areas.map((area) => ({
      areaId: area.id,
      areaLabel: area.label,
      evidenceCount: area.evidenceCount,
      hours: area.hours,
      sourceTypes: cloneJsonLike(area.sourceTypes),
      sourceRefs: cloneJsonLike(area.sourceRefs)
    })),
    qualityFlags: {
      warnings: cloneJsonLike(artifact.warnings),
      limitations: cloneJsonLike(artifact.limitations),
      audit: cloneJsonLike(artifact.audit)
    },
    profileJson: cloneJsonLike(artifact)
  };
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
