import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  abbreviateIntegrityReference,
  formatBlockchainEvidenceStatus,
  formatBlockchainNetwork,
  formatIntegrityDate
} from '@/lib/formatters/credential-integrity';
import { formatDisplayValue } from '@/lib/formatters/display-value';
import { formatHolderQualityFlag } from '@/lib/formatters/holder-quality-flags';
import type {
  HolderCredentialDetailVM,
  HolderCredentialListItemVM,
  HolderProfileProvenanceVM,
  HolderProfileVM
} from '@/models/holder';

const credentialStatuses = ['issued', 'revoked'] as const;
const credentialTypes = [
  'academic_subject',
  'course',
  'certification',
  'degree'
] as const;
const semanticStatuses = ['completed', 'partial'] as const;
const semanticLabelFields = {
  area: ['area', 'name', 'label', 'area_label', 'areaLabel'],
  skill: ['skill', 'name', 'label', 'skill_label', 'skillLabel'],
  concept: ['concept', 'name', 'label', 'concept_label', 'conceptLabel']
} as const;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
// Los tres arrays declarativos comparten el contrato actual de escritura del
// backend: hasta 30 entradas normalizadas de 500 caracteres. Las etiquetas
// semánticas conservan su límite independiente de 160 caracteres.
const DECLARED_ARRAY_MAX_ITEMS = 30;
const DECLARED_ARRAY_ITEM_MAX_LENGTH = 500;
const typeLabels: Record<string, string> = {
  academic_subject: 'Asignatura académica',
  course: 'Curso',
  certification: 'Certificación',
  degree: 'Título académico'
};

export function adaptMyCredentials(payload: unknown): HolderCredentialListItemVM[] {
  return array(payload, 'credentials').map((value, index) =>
    adaptCredentialListItem(value, `credentials[${index}]`)
  );
}

export function adaptMyCredential(payload: unknown): HolderCredentialDetailVM {
  const credential = record(payload, 'credential');
  const blockchainRecords = array(
    credential.blockchainRecords,
    'credential.blockchainRecords'
  );
  const analysis = optionalNullableRecord(
    credential.latestSemanticAnalysis,
    'credential.latestSemanticAnalysis'
  );
  const issuer = record(credential.issuer, 'credential.issuer');
  const listItem = adaptCredentialListItem({
    ...credential,
    issuerName: issuer.name,
    hasIntegrityEvidence: blockchainRecords.length > 0,
    hasAnalysis: analysis !== null
  }, 'credential');
  const subject = record(credential.subject, 'credential.subject');
  const credentialSubject = record(
    credential.credentialSubject,
    'credential.credentialSubject'
  );
  const documentEvidence = optionalNullableRecord(
    credential.documentEvidence,
    'credential.documentEvidence'
  );
  const textEvidence = optionalNullableRecord(
    credential.textEvidence,
    'credential.textEvidence'
  );
  const canonicalHash = nullableHash(
    credential.canonicalHash,
    'credential.canonicalHash'
  );

  return {
    ...listItem,
    description: nullableString(credential.description, 'credential.description'),
    hoursLabel: nullableNumber(credential.hours, 'credential.hours') === null
      ? null
      : `${formatDisplayValue(nullableNumber(credential.hours, 'credential.hours'))} horas`,
    issuerDid: nullableString(issuer.did, 'credential.issuer.did'),
    // A1.1: displayLabel ya combina displayName/firstName/lastName con
    // fallback a email (mismo helper que issuer-credential-read.mapper.ts
    // usa para la vista del issuer de esta misma credencial).
    holderLabel: nullableString(subject.displayLabel, 'credential.subject.displayLabel'),
    holderEmail: nullableString(subject.email, 'credential.subject.email')?.toLowerCase() ?? null,
    holderDid: nullableString(subject.did, 'credential.subject.did'),
    revokedAtLabel: nullableDateLabel(credential.revokedAt, 'credential.revokedAt'),
    revocationReason: nullableString(credential.revocationReason, 'credential.revocationReason'),
    subject: {
      achievementName: nullableSubjectString(credentialSubject, 'achievementName', 'achievement_name'),
      institutionName: nullableSubjectString(credentialSubject, 'institutionName', 'institution_name'),
      completionDate: nullableSubjectString(credentialSubject, 'completionDate', 'completion_date'),
      academicPeriod: nullableSubjectString(credentialSubject, 'academicPeriod', 'academic_period'),
      programName: nullableSubjectString(credentialSubject, 'programName', 'program_name'),
      grade: nullableSubjectString(credentialSubject, 'grade'),
      providerName: nullableSubjectString(credentialSubject, 'providerName', 'provider_name'),
      platformName: nullableSubjectString(credentialSubject, 'platformName', 'platform_name'),
      modality: nullableSubjectString(credentialSubject, 'modality'),
      level: nullableSubjectString(credentialSubject, 'level'),
      externalUrl: nullableExternalUrl(
        aliasedValue(credentialSubject, 'externalUrl', 'external_url'),
        'credential.credentialSubject.externalUrl'
      ),
      skills:
        listItem.type === 'course'
          ? []
          : optionalStringArray(
              credentialSubject.skills,
              'credential.credentialSubject.skills'
            ),
      competencies: optionalStringArray(
        credentialSubject.competencies,
        'credential.credentialSubject.competencies'
      ),
      learningOutcomes: optionalStringArray(
        aliasedValue(credentialSubject, 'learningOutcomes', 'learning_outcomes'),
        'credential.credentialSubject.learningOutcomes'
      )
    },
    documentEvidence: documentEvidence ? {
      originalFileName: requiredString(documentEvidence.originalFileName, 'credential.documentEvidence.originalFileName'),
      mimeType: requiredString(documentEvidence.mimeType, 'credential.documentEvidence.mimeType'),
      sizeLabel: formatBytes(nonNegativeInteger(documentEvidence.sizeBytes, 'credential.documentEvidence.sizeBytes')),
      sha256Short: shortDigest(documentEvidence.sha256, 'credential.documentEvidence.sha256'),
      uploadedAtLabel: dateLabel(documentEvidence.uploadedAt, 'credential.documentEvidence.uploadedAt')
    } : null,
    textEvidence: textEvidence ? {
      label: nullableString(textEvidence.label, 'credential.textEvidence.label'),
      preview: requiredString(textEvidence.preview, 'credential.textEvidence.preview'),
      characterCount: nonNegativeInteger(textEvidence.characterCount, 'credential.textEvidence.characterCount'),
      sha256Short: shortDigest(textEvidence.sha256, 'credential.textEvidence.sha256'),
      submittedAtLabel: dateLabel(textEvidence.submittedAt, 'credential.textEvidence.submittedAt')
    } : null,
    integrity: {
      canonicalHash,
      canonicalHashShort: canonicalHash
        ? abbreviateIntegrityReference(canonicalHash)
        : null,
      canonicalizationVersion: nullableString(credential.canonicalizationVersion, 'credential.canonicalizationVersion'),
      records: blockchainRecords.map((value, index) => {
        const path = `credential.blockchainRecords[${index}]`;
        const item = record(value, path);
        return {
          networkLabel: formatBlockchainNetwork(requiredString(item.network, `${path}.network`)),
          chainId: nonNegativeInteger(item.chainId, `${path}.chainId`),
          txHashShort: shortHash(item.txHash, `${path}.txHash`),
          statusLabel: formatBlockchainEvidenceStatus(requiredString(item.status, `${path}.status`)),
          registeredAtLabel: dateLabel(item.registeredAt, `${path}.registeredAt`)
        };
      })
    },
    analysis: analysis ? {
      status: enumValue(analysis.status, semanticStatuses, 'credential.latestSemanticAnalysis.status'),
      statusLabel: enumValue(analysis.status, semanticStatuses, 'credential.latestSemanticAnalysis.status') === 'partial'
        ? 'Análisis parcial'
        : 'Análisis completado',
      confidenceLabel: nullableConfidenceLabel(analysis.confidence, 'credential.latestSemanticAnalysis.confidence'),
      areas: semanticLabelArray(analysis.areas, semanticLabelFields.area, 'credential.latestSemanticAnalysis.areas'),
      skills: semanticLabelArray(analysis.skills, semanticLabelFields.skill, 'credential.latestSemanticAnalysis.skills'),
      concepts: semanticLabelArray(analysis.concepts, semanticLabelFields.concept, 'credential.latestSemanticAnalysis.concepts'),
      qualityFlags: qualityFlags(analysis.qualityFlags, 'credential.latestSemanticAnalysis.qualityFlags'),
      analyzedAtLabel: dateLabel(analysis.analyzedAt, 'credential.latestSemanticAnalysis.analyzedAt')
    } : null
  };
}

export function adaptMyCurrentProfile(payload: unknown): HolderProfileVM | null {
  const response = record(payload, 'profile');
  const profile = nullableRecord(response.currentProfile, 'profile.currentProfile');
  if (!profile) return null;

  const profileJson = optionalNullableRecord(
    profile.profileJson,
    'profile.currentProfile.profileJson'
  );
  const areasValue = profile.areas === undefined
    ? profile.areasSummary
    : profile.areas;
  const skillsValue = profile.skills === undefined
    ? profile.skillsSummary
    : profile.skills;
  const conceptsValue = profile.concepts === undefined
    ? profileJson?.concepts
    : profile.concepts;

  // C2c: totalOfficialHours es el campo inequivoco; si el backend todavia
  // no lo manda (deploy skew) cae a totalHours -- mismo dato, nombre viejo.
  const totalOfficialHours = profile.totalOfficialHours === undefined
    ? nullableNumber(profile.totalHours, 'profile.currentProfile.totalHours')
    : nullableNumber(profile.totalOfficialHours, 'profile.currentProfile.totalOfficialHours');
  const credentialsWithoutHours = optionalNonNegativeInteger(profile.credentialsWithoutHours, 'profile.currentProfile.credentialsWithoutHours');
  const credentialsWithoutSemanticCoverage = optionalNonNegativeInteger(profile.credentialsWithoutSemanticCoverage, 'profile.currentProfile.credentialsWithoutSemanticCoverage');
  const credentialsWithReviewedInterpretation = optionalNonNegativeInteger(profile.credentialsWithReviewedInterpretation, 'profile.currentProfile.credentialsWithReviewedInterpretation');

  return {
    profileVersion: requiredString(profile.profileVersion, 'profile.currentProfile.profileVersion'),
    credentialsCount: nonNegativeInteger(profile.credentialsCount, 'profile.currentProfile.credentialsCount'),
    totalOfficialHoursLabel: totalOfficialHours === null
      ? null
      : `${formatDisplayValue(totalOfficialHours)} horas oficiales declaradas`,
    hoursCoverageNoticeLabel: credentialsWithoutHours !== null && credentialsWithoutHours > 0
      ? `${credentialsWithoutHours} ${pluralCredencial(credentialsWithoutHours)} no ${credentialsWithoutHours === 1 ? 'informa' : 'informan'} horas.`
      : null,
    semanticCoverageNoticeLabel: credentialsWithoutSemanticCoverage !== null && credentialsWithoutSemanticCoverage > 0
      ? `${credentialsWithoutSemanticCoverage} ${pluralCredencial(credentialsWithoutSemanticCoverage)} todavía no ${credentialsWithoutSemanticCoverage === 1 ? 'tiene' : 'tienen'} análisis semántico.`
      : null,
    reviewedInterpretationNoticeLabel: credentialsWithReviewedInterpretation !== null && credentialsWithReviewedInterpretation > 0
      ? `${credentialsWithReviewedInterpretation} ${pluralCredencial(credentialsWithReviewedInterpretation)} ${credentialsWithReviewedInterpretation === 1 ? 'cuenta' : 'cuentan'} con una interpretación revisada por el emisor.`
      : null,
    narrative: nullableString(
      profile.narrative === undefined ? profileJson?.narrative : profile.narrative,
      'profile.currentProfile.narrative'
    ),
    areas: array(areasValue, 'profile.currentProfile.areas').map((entry, index) => {
      const path = `profile.currentProfile.areas[${index}]`;
      const area = record(entry, path);
      const estimatedHours = nullableNumber(area.estimatedHours, `${path}.estimatedHours`);
      return {
        label: descriptorLabel(area, semanticLabelFields.area, path),
        estimatedHoursLabel: estimatedHours === null
          ? null
          : `${formatDisplayValue(estimatedHours)} horas estimadas por IA`,
        provenance: provenanceVM(area.provenanceSummary)
      };
    }),
    skills: array(skillsValue, 'profile.currentProfile.skills').map((entry, index) => {
      const path = `profile.currentProfile.skills[${index}]`;
      const skill = record(entry, path);
      const confidence = nullableConfidence(skill.confidence, `${path}.confidence`);
      return {
        label: descriptorLabel(skill, semanticLabelFields.skill, path),
        confidenceLabel: confidence === null
          ? null
          : `${Math.round(confidence * 100)}% de confianza`,
        provenance: provenanceVM(skill.provenanceSummary)
      };
    }),
    concepts: semanticLabelArray(
      conceptsValue,
      semanticLabelFields.concept,
      'profile.currentProfile.concepts'
    ),
    // Compatibilidad temporal: mientras Render API no tenga IA-Q1
    // desplegado, currentProfile puede no traer estos campos todavia.
    // Ausentes (undefined) -> []. Presentes pero invalidos -> rechazo.
    emittedSkills: optionalEmittedLabelArray(
      profile.emittedSkills === undefined ? profileJson?.emittedSkills : profile.emittedSkills,
      'profile.currentProfile.emittedSkills'
    ),
    emittedCompetencies: optionalEmittedLabelArray(
      profile.emittedCompetencies === undefined ? profileJson?.emittedCompetencies : profile.emittedCompetencies,
      'profile.currentProfile.emittedCompetencies'
    ),
    emittedLearningOutcomes: optionalEmittedLabelArray(
      profile.emittedLearningOutcomes === undefined ? profileJson?.emittedLearningOutcomes : profile.emittedLearningOutcomes,
      'profile.currentProfile.emittedLearningOutcomes'
    ),
    confidenceLabel: nullableConfidenceLabel(
      profile.confidence === undefined
        ? profileJsonConfidence(profileJson)
        : profile.confidence,
      'profile.currentProfile.confidence'
    ),
    qualityFlags: qualityFlags(profile.qualityFlags, 'profile.currentProfile.qualityFlags'),
    generatedAtLabel: dateLabel(profile.generatedAt, 'profile.currentProfile.generatedAt')
  };
}

function adaptCredentialListItem(value: unknown, path: string): HolderCredentialListItemVM {
  const credential = record(value, path);
  const status = enumValue(credential.status, credentialStatuses, `${path}.status`);
  const type = enumValue(credential.type, credentialTypes, `${path}.type`);

  return {
    credentialReference: requiredString(credential.id, `${path}.id`),
    title: requiredString(credential.title, `${path}.title`),
    type,
    typeLabel: typeLabels[type],
    status,
    statusLabel: status === 'issued' ? 'Emitida' : 'Revocada',
    issuerName: requiredString(credential.issuerName, `${path}.issuerName`),
    issuedAtLabel: nullableDateLabel(credential.issuedAt, `${path}.issuedAt`),
    hasIntegrityEvidence: requiredBoolean(credential.hasIntegrityEvidence, `${path}.hasIntegrityEvidence`),
    hasAnalysis: requiredBoolean(credential.hasAnalysis, `${path}.hasAnalysis`)
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'object', value);
  return value as Record<string, unknown>;
}
function optionalNullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  return value === null || value === undefined ? null : record(value, path);
}
function nullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  return value === null ? null : record(value, path);
}
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) invalid(path, 'array', value); return value; }
function requiredString(value: unknown, path: string): string { const normalized = nullableString(value, path); if (!normalized) invalid(path, 'non-empty string', value); return normalized; }
function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(path, 'string or null', value);
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
function stringArray(value: unknown, path: string): string[] {
  const entries = array(value, path);
  if (entries.length > DECLARED_ARRAY_MAX_ITEMS) {
    invalid(path, `array with at most ${DECLARED_ARRAY_MAX_ITEMS} entries`, value);
  }
  return entries.map((entry, index) => safeString(entry, DECLARED_ARRAY_ITEM_MAX_LENGTH, `${path}[${index}]`));
}
function semanticLabelArray(value: unknown, labelFields: readonly string[], path: string): string[] {
  return array(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof entry === 'string') return safeString(entry, 160, itemPath);

    return descriptorLabel(record(entry, itemPath), labelFields, itemPath);
  });
}
function descriptorLabel(value: Record<string, unknown>, labelFields: readonly string[], path: string): string {
  for (const field of labelFields) {
    if (value[field] !== undefined) return safeString(value[field], 160, `${path}.${field}`);
  }
  return invalid(path, `object with one of: ${labelFields.join(', ')}`, value);
}
function optionalStringArray(value: unknown, path: string): string[] { return value === undefined || value === null ? [] : stringArray(value, path); }
function optionalEmittedLabelArray(value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  return array(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof entry === 'string') return safeString(entry, DECLARED_ARRAY_ITEM_MAX_LENGTH, itemPath);
    const descriptor = record(entry, itemPath);
    if (descriptor.label === undefined) invalid(itemPath, 'string or object with label', entry);
    return safeString(descriptor.label, DECLARED_ARRAY_ITEM_MAX_LENGTH, `${itemPath}.label`);
  });
}
function qualityFlags(value: unknown, path: string): string[] { return array(value, path).map((entry, index) => formatHolderQualityFlag(safeString(entry, 120, `${path}[${index}]`))); }
function safeString(value: unknown, maxLength: number, path: string): string { const normalized = requiredString(value, path); if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) invalid(path, `safe string up to ${maxLength} characters`, value); return normalized; }
function nonNegativeInteger(value: unknown, path: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid(path, 'non-negative integer', value); return value; }
function nullableNumber(value: unknown, path: string): number | null { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'finite number or null', value); return value; }
// C2c: contadores de cobertura ausentes (perfil pre-C2c) o null (backend ya
// los declaro no disponibles) -> null. Presentes pero invalidos -> rechazo,
// igual criterio que el resto de los campos numericos de este adapter.
function optionalNonNegativeInteger(value: unknown, path: string): number | null { if (value === undefined || value === null) return null; return nonNegativeInteger(value, path); }
function pluralCredencial(count: number): string { return count === 1 ? 'credencial' : 'credenciales'; }
// C5b.2: a diferencia del resto de este adapter (que rechaza el payload
// completo ante un campo invalido), provenanceSummary es un dato secundario
// -- un shape malformado (deploy skew, bug de backend) nunca debe tirar
// abajo el perfil entero. Degrada a "sin provenance para mostrar" (null),
// nunca fabrica un conteo ni lanza IncompatiblePayloadError. Labels en
// lenguaje de producto, nunca enums tecnicos (issuer_reviewed/ai_inferred/
// provenance/source/snapshot/SemanticAnalysis) ni la palabra "verificado"
// (ya tiene otro significado en Traza: autenticidad/integridad).
function provenanceVM(value: unknown): HolderProfileProvenanceVM | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value as Record<string, unknown>;
  const issuerReviewedCount = nonNegativeIntegerOrNull(summary.issuerReviewedCount);
  const aiInferredCount = nonNegativeIntegerOrNull(summary.aiInferredCount);
  if (issuerReviewedCount === null || aiInferredCount === null) return null;
  if (issuerReviewedCount === 0 && aiInferredCount === 0) return null;
  return {
    issuerReviewedLabel: issuerReviewedCount === 0
      ? null
      : issuerReviewedCount === 1
        ? 'Revisado por el emisor'
        : `${issuerReviewedCount} aportes revisados por el emisor`,
    aiInferredLabel: aiInferredCount === 0
      ? null
      : aiInferredCount === 1
        ? 'Interpretado con IA'
        : `${aiInferredCount} aportes interpretados con IA`
  };
}
function nonNegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
function nullableConfidence(value: unknown, path: string): number | null { const confidence = nullableNumber(value, path); if (confidence !== null && (confidence < 0 || confidence > 1)) invalid(path, 'number from 0 to 1 or null', value); return confidence; }
function requiredBoolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path, 'boolean', value); return value; }
function enumValue<T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] { const normalized = requiredString(value, path); if (!allowed.includes(normalized)) invalid(path, `one of: ${allowed.join(', ')}`, value); return normalized as T[number]; }
function dateLabel(value: unknown, path: string): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(path, 'ISO date string', value); return formatIntegrityDate(value); }
function nullableDateLabel(value: unknown, path: string): string | null { return value === null || value === undefined ? null : dateLabel(value, path); }
function nullableHash(value: unknown, path: string): string | null { if (value === null || value === undefined) return null; const hash = requiredString(value, path); if (!hashPattern.test(hash)) invalid(path, '0x-prefixed 32-byte hash or null', value); return hash; }
function nullableExternalUrl(value: unknown, path: string): string | null {
  const url = nullableString(value, path);
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid(path, 'HTTP(S) URL or null', value);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') invalid(path, 'HTTP(S) URL or null', value);
  return url;
}
function shortHash(value: unknown, path: string): string { return abbreviateIntegrityReference(nullableHash(value, path) ?? requiredString(value, path)); }
function shortDigest(value: unknown, path: string): string { const digest = requiredString(value, path); if (!/^[a-fA-F0-9]{64}$/.test(digest)) invalid(path, '64-character hexadecimal digest', value); return abbreviateIntegrityReference(digest); }
function nullableConfidenceLabel(value: unknown, path: string): string | null { const confidence = nullableConfidence(value, path); return confidence === null ? null : `${Math.round(confidence * 100)}% de confianza`; }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`; }
function aliasedValue(value: Record<string, unknown>, current: string, legacy?: string): unknown {
  return value[current] === undefined && legacy ? value[legacy] : value[current];
}
function nullableSubjectString(value: Record<string, unknown>, current: string, legacy?: string): string | null {
  return nullableString(
    aliasedValue(value, current, legacy),
    `credential.credentialSubject.${current}`
  );
}
function profileJsonConfidence(value: Record<string, unknown> | null): unknown {
  if (!value || value.confidence === undefined) return undefined;
  if (typeof value.confidence === 'number' || value.confidence === null) return value.confidence;
  const confidence = record(value.confidence, 'profile.currentProfile.profileJson.confidence');
  return confidence.score;
}
function actualCategory(value: unknown) {
  if (value === undefined) return 'missing' as const;
  if (value === null) return 'null' as const;
  if (Array.isArray(value)) return 'array' as const;
  if (typeof value === 'string') return 'string' as const;
  if (typeof value === 'number') return 'number' as const;
  if (typeof value === 'boolean') return 'boolean' as const;
  return 'object' as const;
}
function invalid(path: string, expected: string, value: unknown): never {
  throw new IncompatiblePayloadError(
    'La respuesta de la wallet no cumple el contrato esperado.',
    { path, expected, actualCategory: actualCategory(value) }
  );
}
