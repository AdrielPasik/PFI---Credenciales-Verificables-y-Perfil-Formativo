export const FORMATIVE_PROFILE_RESULT_VERSION =
  'formative_profile_result_v0';
export const FORMATIVE_PROFILE_AI_GENERATION_METHOD =
  'ai_artifact_ingest_v0';
export const FORMATIVE_PROFILE_SCHEMA_VERSION = 'formative_profile_v1';

export const FORMATIVE_PROFILE_SOURCE_TYPES = [
  'academic_pdf',
  'online_course_catalog'
] as const;
export const FORMATIVE_PROFILE_CONFIDENCE_BANDS = [
  'high',
  'medium',
  'low',
  'unavailable'
] as const;
export const FORMATIVE_PROFILE_SCORE_METHODS = [
  'qualitative_only',
  'unavailable'
] as const;
export const FORMATIVE_PROFILE_SKILL_SOURCES = [
  'explicit',
  'inferred',
  'mixed',
  'unknown'
] as const;

export type FormativeProfileSourceType =
  typeof FORMATIVE_PROFILE_SOURCE_TYPES[number];
export type FormativeProfileConfidenceBand =
  typeof FORMATIVE_PROFILE_CONFIDENCE_BANDS[number];
export type FormativeProfileScoreMethod =
  typeof FORMATIVE_PROFILE_SCORE_METHODS[number];
export type FormativeProfileSkillSource =
  typeof FORMATIVE_PROFILE_SKILL_SOURCES[number];

export interface FormativeProfileSourceRef {
  documentId: string;
  fileName: string | null;
  sourceType: FormativeProfileSourceType;
}

export interface FormativeProfileGeneratedFrom {
  artifactSchema: 'semantic_analysis_v1';
  artifactCount: number;
  sourceTypes: Partial<Record<FormativeProfileSourceType, number>>;
  pipelineVersions: string[];
  taxonomyVersions: string[];
}

export interface FormativeProfileSummary {
  text: string;
  language: 'es';
  style: 'cautious_explanatory';
}

export interface FormativeProfileConfidence {
  band: FormativeProfileConfidenceBand;
  score: null;
  scoreMethod: FormativeProfileScoreMethod;
  explanation: string;
  drivers: string[];
  limitations: string[];
}

interface FormativeProfileDescriptorBase {
  id: string;
  label: string;
  evidenceCount: number;
  confidence: number | null;
  sourceTypes: FormativeProfileSourceType[];
  sourceRefs: FormativeProfileSourceRef[];
}

export interface FormativeProfileArea extends FormativeProfileDescriptorBase {
  hours: number | null;
}

export interface FormativeProfileSkill extends FormativeProfileDescriptorBase {
  source: FormativeProfileSkillSource;
}

export interface FormativeProfileConcept
  extends FormativeProfileDescriptorBase {}

export interface FormativeProfileEvidence {
  sourceCoverage: {
    sourceArtifactsCount: number;
    bySourceType: Partial<Record<FormativeProfileSourceType, number>>;
    sourceRefs: FormativeProfileSourceRef[];
    note: string;
  };
  evidenceOverview: {
    artifacts_with_area_evidence: number;
    artifacts_with_skill_evidence: number;
    artifacts_with_concept_evidence: number;
    total_area_evidence_entries: number;
    total_skill_evidence_entries: number;
    total_concept_evidence_entries: number;
  };
  sourceRefs: FormativeProfileSourceRef[];
}

export interface FormativeProfileAudit {
  qualityFlags: Record<string, number>;
  partialReasons: Record<string, number>;
  rawWarningCodes: string[];
  rawPartialReasonCodes: string[];
}

export interface FormativeProfileResultArtifact {
  profileVersion: typeof FORMATIVE_PROFILE_RESULT_VERSION;
  generatedFrom: FormativeProfileGeneratedFrom;
  summary: FormativeProfileSummary;
  confidence: FormativeProfileConfidence;
  areas: FormativeProfileArea[];
  skills: FormativeProfileSkill[];
  concepts: FormativeProfileConcept[];
  strengths: string[];
  possibleDirections: string[];
  limitations: string[];
  warnings: string[];
  evidence: FormativeProfileEvidence;
  audit: FormativeProfileAudit;
}

export interface FormativeProfileResultArtifactMapping {
  profileVersion: typeof FORMATIVE_PROFILE_RESULT_VERSION;
  generationMethod: typeof FORMATIVE_PROFILE_AI_GENERATION_METHOD;
  credentialsCount: number;
  totalHours: number;
  areasSummary: FormativeProfileArea[];
  skillsSummary: FormativeProfileSkill[];
  evidenceByArea: Array<{
    areaId: string;
    areaLabel: string;
    evidenceCount: number;
    hours: number | null;
    sourceTypes: FormativeProfileSourceType[];
    sourceRefs: FormativeProfileSourceRef[];
  }>;
  qualityFlags: {
    warnings: string[];
    limitations: string[];
    audit: FormativeProfileAudit;
  };
  profileJson: FormativeProfileResultArtifact;
}
