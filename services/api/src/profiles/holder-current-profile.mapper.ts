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
      totalOfficialHours: totalOfficialHours(profile),
      credentialsWithoutHours: summaryCounter(
        profile.profileJson,
        'credentialsWithoutHours'
      ),
      credentialsWithoutSemanticCoverage: summaryCounter(
        profile.profileJson,
        'credentialsWithoutSemanticCoverage'
      ),
      narrative: narrative(profile.profileJson),
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

// C2c: totalOfficialHours es el mismo dato que totalHours (suma de
// Credential.hours declarado, nunca IA), solo con un nombre inequivoco.
// Si el perfil persistido es anterior a C2c y no tiene
// profileJson.summary.totalOfficialHours, cae al totalHours ya calculado
// por FormativeProfileService.toCurrentProfileResponse (columna DB o
// profileJson.summary.totalHours -- misma cadena de fallback existente).
function totalOfficialHours(profile: {
  totalHours: number | null;
  profileJson: unknown;
}) {
  const summary = summaryRecord(profile.profileJson);
  if (summary && 'totalOfficialHours' in summary) {
    return number(summary.totalOfficialHours);
  }
  return profile.totalHours;
}

// Contadores de cobertura (C2c). Ausentes en perfiles pre-C2c -> null, no 0:
// "no sabemos" es distinto de "cero credenciales sin cobertura".
function summaryCounter(
  profileJsonValue: unknown,
  field: 'credentialsWithoutHours' | 'credentialsWithoutSemanticCoverage'
) {
  const summary = summaryRecord(profileJsonValue);
  if (!summary || !(field in summary)) return null;
  const value = summary[field];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function summaryRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value.summary) ? value.summary : null;
}

function narrative(value: unknown): string | null {
  const candidate = isRecord(value) ? value.narrative : undefined;
  if (typeof candidate !== 'string') return null;
  const normalized = normalize(candidate);
  return normalized && normalized.length <= 1200 ? normalized : null;
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
