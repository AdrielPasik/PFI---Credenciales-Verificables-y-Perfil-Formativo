import type {
  CurrentProfileResponseDto,
  HolderCurrentProfileResponseDto
} from './dto/current-profile-response.dto';

const LABEL_FIELDS = {
  area: ['area', 'name', 'label', 'area_label', 'areaLabel'],
  skill: ['skill', 'name', 'label', 'skill_label', 'skillLabel'],
  concept: ['concept', 'name', 'label', 'concept_label', 'conceptLabel']
} as const;

export function mapHolderCurrentProfileResponse(
  response: CurrentProfileResponseDto
): HolderCurrentProfileResponseDto {
  const profile = response.currentProfile;
  if (!profile) {
    return { currentProfile: null };
  }

  return {
    currentProfile: {
      profileVersion: profile.profileVersion,
      credentialsCount: profile.credentialsCount,
      totalHours: profile.totalHours,
      areas: areas(profile.areasSummary),
      skills: skills(profile.skillsSummary),
      concepts: concepts(profile.profileJson),
      emittedSkills: emittedLabels(profile.profileJson, 'emittedSkills'),
      emittedCompetencies: emittedLabels(
        profile.profileJson,
        'emittedCompetencies'
      ),
      emittedLearningOutcomes: emittedLabels(
        profile.profileJson,
        'emittedLearningOutcomes'
      ),
      confidence: confidence(profile.profileJson),
      qualityFlags: strings(profile.qualityFlags, 120),
      generatedAt: profile.generatedAt
    }
  };
}

function areas(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = labelFrom(entry, LABEL_FIELDS.area);
    if (!label) return [];
    return [{ label, estimatedHours: number(entry.estimatedHours) }];
  });
}

function skills(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = labelFrom(entry, LABEL_FIELDS.skill);
    if (!label) return [];
    return [{ label, confidence: confidenceNumber(entry.confidence) }];
  });
}

function concepts(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.concepts)) return [];
  return value.concepts.flatMap((entry) => {
    if (typeof entry === 'string') return normalize(entry) ? [normalize(entry)!] : [];
    return isRecord(entry) && labelFrom(entry, LABEL_FIELDS.concept)
      ? [labelFrom(entry, LABEL_FIELDS.concept)!]
      : [];
  });
}

function emittedLabels(
  value: unknown,
  field: 'emittedSkills' | 'emittedCompetencies' | 'emittedLearningOutcomes'
) {
  if (!isRecord(value) || !Array.isArray(value[field])) return [];
  return value[field].flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = normalize(entry.label);
    return label ? [label] : [];
  });
}

function confidence(value: unknown) {
  return isRecord(value) && isRecord(value.confidence)
    ? confidenceNumber(value.confidence.score)
    : null;
}

function strings(value: unknown, maxLength: number) {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === 'string' && normalize(entry) && entry.length <= maxLength ? [normalize(entry)!] : [])
    : [];
}

function labelFrom(value: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const label = normalize(value[field]);
    if (label) return label;
  }
  return null;
}

function normalize(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ') || null
    : null;
}

function number(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function confidenceNumber(value: unknown) {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
