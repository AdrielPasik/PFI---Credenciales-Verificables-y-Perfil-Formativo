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
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const typeLabels: Record<string, string> = {
  academic_subject: 'Asignatura académica',
  course: 'Curso',
  certification: 'Certificación',
  degree: 'Título académico'
};

export function adaptMyCredentials(payload: unknown): HolderCredentialListItemVM[] {
  if (!Array.isArray(payload)) invalid();
  return payload.map(adaptCredentialListItem);
}

export function adaptMyCredential(payload: unknown): HolderCredentialDetailVM {
  const credential = record(payload);
  const blockchainRecords = array(credential.blockchainRecords);
  const analysis = nullableRecord(credential.latestSemanticAnalysis);
  const issuer = record(credential.issuer);
  const listItem = adaptCredentialListItem({
    ...credential,
    issuerName: issuer.name,
    hasIntegrityEvidence: blockchainRecords.length > 0,
    hasAnalysis: analysis !== null
  });
  const subject = record(credential.subject);
  const credentialSubject = record(credential.credentialSubject);
  const documentEvidence = nullableRecord(credential.documentEvidence);
  const textEvidence = nullableRecord(credential.textEvidence);

  return {
    ...listItem,
    description: nullableString(credential.description),
    hoursLabel: nullableNumber(credential.hours) === null
      ? null
      : `${formatDisplayValue(nullableNumber(credential.hours))} horas`,
    issuerDid: nullableString(issuer.did),
    holderLabel: nullableString(subject.displayName),
    holderEmail: nullableString(subject.email)?.toLowerCase() ?? null,
    holderDid: nullableString(subject.did),
    revokedAtLabel: nullableDateLabel(credential.revokedAt),
    revocationReason: nullableString(credential.revocationReason),
    subject: {
      achievementName: nullableString(credentialSubject.achievementName),
      institutionName: nullableString(credentialSubject.institutionName),
      completionDate: nullableString(credentialSubject.completionDate),
      academicPeriod: nullableString(credentialSubject.academicPeriod),
      programName: nullableString(credentialSubject.programName),
      grade: nullableString(credentialSubject.grade),
      providerName: nullableString(credentialSubject.providerName),
      platformName: nullableString(credentialSubject.platformName),
      modality: nullableString(credentialSubject.modality),
      level: nullableString(credentialSubject.level),
      externalUrl: nullableExternalUrl(credentialSubject.externalUrl),
      skills: stringArray(credentialSubject.skills),
      competencies: stringArray(credentialSubject.competencies),
      learningOutcomes: stringArray(credentialSubject.learningOutcomes)
    },
    documentEvidence: documentEvidence ? {
      originalFileName: requiredString(documentEvidence.originalFileName),
      mimeType: requiredString(documentEvidence.mimeType),
      sizeLabel: formatBytes(nonNegativeInteger(documentEvidence.sizeBytes)),
      sha256Short: shortDigest(documentEvidence.sha256),
      uploadedAtLabel: dateLabel(documentEvidence.uploadedAt)
    } : null,
    textEvidence: textEvidence ? {
      label: nullableString(textEvidence.label),
      preview: requiredString(textEvidence.preview),
      characterCount: nonNegativeInteger(textEvidence.characterCount),
      sha256Short: shortDigest(textEvidence.sha256),
      submittedAtLabel: dateLabel(textEvidence.submittedAt)
    } : null,
    integrity: {
      canonicalHash: nullableHash(credential.canonicalHash),
      canonicalHashShort: nullableHash(credential.canonicalHash)
        ? abbreviateIntegrityReference(nullableHash(credential.canonicalHash)!)
        : null,
      canonicalizationVersion: nullableString(credential.canonicalizationVersion),
      records: blockchainRecords.map((value) => {
        const item = record(value);
        return {
          networkLabel: formatBlockchainNetwork(requiredString(item.network)),
          chainId: nonNegativeInteger(item.chainId),
          txHashShort: shortHash(item.txHash),
          statusLabel: formatBlockchainEvidenceStatus(requiredString(item.status)),
          registeredAtLabel: dateLabel(item.registeredAt)
        };
      })
    },
    analysis: analysis ? {
      status: enumValue(analysis.status, semanticStatuses),
      statusLabel: enumValue(analysis.status, semanticStatuses) === 'partial'
        ? 'Análisis parcial'
        : 'Análisis completado',
      confidenceLabel: nullableConfidenceLabel(analysis.confidence),
      areas: stringArray(analysis.areas),
      skills: stringArray(analysis.skills),
      concepts: stringArray(analysis.concepts),
      qualityFlags: qualityFlags(analysis.qualityFlags),
      analyzedAtLabel: dateLabel(analysis.analyzedAt)
    } : null
  };
}

export function adaptMyCurrentProfile(payload: unknown): HolderProfileVM | null {
  const response = record(payload);
  const profile = nullableRecord(response.currentProfile);
  if (!profile) return null;

  return {
    profileVersion: requiredString(profile.profileVersion),
    credentialsCount: nonNegativeInteger(profile.credentialsCount),
    totalHoursLabel: nullableNumber(profile.totalHours) === null
      ? null
      : `${formatDisplayValue(nullableNumber(profile.totalHours))} horas`,
    areas: array(profile.areas).map((entry) => {
      const area = record(entry);
      const estimatedHours = nullableNumber(area.estimatedHours);
      return {
        label: requiredString(area.label),
        estimatedHoursLabel: estimatedHours === null
          ? null
          : `${formatDisplayValue(estimatedHours)} horas estimadas`
      };
    }),
    skills: array(profile.skills).map((entry) => {
      const skill = record(entry);
      const confidence = nullableConfidence(skill.confidence);
      return {
        label: requiredString(skill.label),
        confidenceLabel: confidence === null
          ? null
          : `${Math.round(confidence * 100)}% de confianza`
      };
    }),
    concepts: stringArray(profile.concepts),
    // Compatibilidad temporal: mientras Render API no tenga IA-Q1
    // desplegado, currentProfile puede no traer estos campos todavia.
    // Ausentes (undefined) -> []. Presentes pero invalidos -> rechazo.
    emittedSkills: optionalStringArray(profile.emittedSkills),
    emittedCompetencies: optionalStringArray(profile.emittedCompetencies),
    emittedLearningOutcomes: optionalStringArray(profile.emittedLearningOutcomes),
    confidenceLabel: nullableConfidenceLabel(profile.confidence),
    qualityFlags: qualityFlags(profile.qualityFlags),
    generatedAtLabel: dateLabel(profile.generatedAt)
  };
}

function adaptCredentialListItem(value: unknown): HolderCredentialListItemVM {
  const credential = record(value);
  const status = enumValue(credential.status, credentialStatuses);
  const type = enumValue(credential.type, credentialTypes);

  return {
    credentialReference: requiredString(credential.id),
    title: requiredString(credential.title),
    type,
    typeLabel: typeLabels[type],
    status,
    statusLabel: status === 'issued' ? 'Emitida' : 'Revocada',
    issuerName: requiredString(credential.issuerName),
    issuedAtLabel: nullableDateLabel(credential.issuedAt),
    hasIntegrityEvidence: requiredBoolean(credential.hasIntegrityEvidence),
    hasAnalysis: requiredBoolean(credential.hasAnalysis)
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === null ? null : record(value);
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function requiredString(value: unknown): string { const normalized = nullableString(value); if (!normalized) invalid(); return normalized; }
function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid();
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
function stringArray(value: unknown): string[] { return array(value).map((entry) => safeString(entry, 160)); }
function optionalStringArray(value: unknown): string[] { return value === undefined ? [] : stringArray(value); }
function qualityFlags(value: unknown): string[] { return array(value).map((entry) => formatHolderQualityFlag(safeString(entry, 120))); }
function safeString(value: unknown, maxLength: number): string { const normalized = requiredString(value); if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) invalid(); return normalized; }
function nonNegativeInteger(value: unknown): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid(); return value; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value)) invalid(); return value; }
function nullableConfidence(value: unknown): number | null { const confidence = nullableNumber(value); if (confidence !== null && (confidence < 0 || confidence > 1)) invalid(); return confidence; }
function requiredBoolean(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value; }
function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] { const normalized = requiredString(value); if (!allowed.includes(normalized)) invalid(); return normalized as T[number]; }
function dateLabel(value: unknown): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(); return formatIntegrityDate(value); }
function nullableDateLabel(value: unknown): string | null { return value === null ? null : dateLabel(value); }
function nullableHash(value: unknown): string | null { if (value === null) return null; const hash = requiredString(value); if (!hashPattern.test(hash)) invalid(); return hash; }
function nullableExternalUrl(value: unknown): string | null {
  const url = nullableString(value);
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') invalid();
  return url;
}
function shortHash(value: unknown): string { return abbreviateIntegrityReference(nullableHash(value) ?? requiredString(value)); }
function shortDigest(value: unknown): string { const digest = requiredString(value); if (!/^[a-fA-F0-9]{64}$/.test(digest)) invalid(); return abbreviateIntegrityReference(digest); }
function nullableConfidenceLabel(value: unknown): string | null { const confidence = nullableConfidence(value); return confidence === null ? null : `${Math.round(confidence * 100)}% de confianza`; }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`; }
function invalid(): never { throw new IncompatiblePayloadError('La respuesta de la wallet no cumple el contrato esperado.'); }
