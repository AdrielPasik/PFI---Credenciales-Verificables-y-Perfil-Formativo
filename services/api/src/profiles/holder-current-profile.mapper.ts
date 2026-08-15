import type {
  CurrentProfileResponseDto,
  HolderCurrentProfileResponseDto,
  HolderProfileProvenanceSummaryDto
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

  const mappedAreas = areas(profile.areasSummary);
  const mappedSkills = skills(profile.skillsSummary);
  const mappedConcepts = concepts(profile.profileJson);
  const officialHours = totalOfficialHours(profile);

  return {
    currentProfile: {
      profileVersion: profile.profileVersion,
      credentialsCount: profile.credentialsCount,
      totalHours: profile.totalHours,
      totalOfficialHours: officialHours,
      credentialsWithoutHours: summaryCounter(
        profile.profileJson,
        'credentialsWithoutHours'
      ),
      credentialsWithoutSemanticCoverage: summaryCounter(
        profile.profileJson,
        'credentialsWithoutSemanticCoverage'
      ),
      credentialsWithReviewedInterpretation: summaryCounter(
        profile.profileJson,
        'credentialsWithReviewedInterpretation'
      ),
      narrative:
        narrative(profile.profileJson) ??
        narrativeFallback({
          areas: mappedAreas,
          skills: mappedSkills,
          concepts: mappedConcepts,
          totalOfficialHours: officialHours
        }),
      areas: mappedAreas,
      skills: mappedSkills,
      concepts: mappedConcepts,
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
    return [
      {
        label,
        estimatedHours: number(entry.estimatedHours),
        provenanceSummary: provenanceSummary(entry)
      }
    ];
  });
}

function skills(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const label = labelFrom(entry, LABEL_FIELDS.skill);
    if (!label) return [];
    return [
      {
        label,
        confidence: confidenceNumber(entry.confidence),
        provenanceSummary: provenanceSummary(entry)
      }
    ];
  });
}

// C5b.2: proyeccion holder-safe y agregada de
// ProfileEvidenceProvenanceSummary (formative-profile.service.ts). Solo
// expone los DOS contadores agregados -- nunca sources[], credentialId,
// reusableInterpretationId ni semanticAnalysisId (esos siguen siendo
// internos de profileJson, nunca alcanzan este mapper). Un perfil legacy
// (pre-C5b.1) no tiene esta forma en absoluto -- su ausencia nunca se
// interpreta como "0 revisados" ni se completa a partir de otro campo
// (evidenceCount, credentialIds, etc.): "no sabemos" es null, nunca un
// valor fabricado.
function provenanceSummary(
  entry: Record<string, unknown>
): HolderProfileProvenanceSummaryDto | null {
  const candidate = entry.provenanceSummary;
  if (!isRecord(candidate)) return null;
  const issuerReviewedCount = nonNegativeInteger(candidate.issuerReviewedCount);
  const aiInferredCount = nonNegativeInteger(candidate.aiInferredCount);
  if (issuerReviewedCount === null || aiInferredCount === null) return null;
  return { issuerReviewedCount, aiInferredCount };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
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
  field:
    | 'credentialsWithoutHours'
    | 'credentialsWithoutSemanticCoverage'
    | 'credentialsWithReviewedInterpretation'
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

// Legacy profiles can predate the persisted C5 narrative. Reading them must
// still be useful, but a GET must never rewrite the historical snapshot.
function narrativeFallback(input: {
  areas: Array<{ label: string }>;
  skills: Array<{ label: string }>;
  concepts: string[];
  totalOfficialHours: number | null;
}): string | null {
  const areas = input.areas.slice(0, 3).map((area) => area.label);
  const topics = [...input.skills.slice(0, 3).map((skill) => skill.label), ...input.concepts.slice(0, 2)]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3);

  if (areas.length === 0 && topics.length === 0 && input.totalOfficialHours === null) {
    return null;
  }

  const sentences: string[] = [];
  if (areas.length > 0) {
    sentences.push(`La trayectoria formativa muestra credenciales vinculadas con ${areas.join(', ')}.`);
  }
  if (topics.length > 0) {
    sentences.push(`Se observan contenidos relacionados con ${topics.join(', ')}.`);
  }
  if (input.totalOfficialHours !== null) {
    sentences.push(`Las horas oficiales declaradas suman ${input.totalOfficialHours}.`);
  }
  return sentences.join(' ');
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
