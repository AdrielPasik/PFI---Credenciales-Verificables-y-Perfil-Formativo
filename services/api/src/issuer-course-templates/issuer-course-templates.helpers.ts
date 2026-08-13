import { BadRequestException } from '@nestjs/common';
import { CredentialType, Prisma, SemanticAnalysisStatus } from '@prisma/client';

import type { ReusableCredentialType } from './issuer-course-templates.validator';

// C3a/C3a.2: mismas claves de credentialSubject que
// issuer-credential-read.mapper.ts (achievement_name, platform_name,
// modality, external_url, certification_code, expiration_date,
// provider_name, level, competencies, learning_outcomes, skills). Se
// duplica localmente porque esos helpers no estan exportados y no queremos
// acoplar este catalogo al mapper de lectura de credenciales.

export function toJsonObject(
  value: Prisma.JsonValue
): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}

export function readSubjectText(
  source: Record<string, Prisma.JsonValue>,
  key:
    | 'achievement_name'
    | 'platform_name'
    | 'modality'
    | 'external_url'
    | 'certification_code'
    | 'expiration_date'
    | 'provider_name'
    | 'level'
): string | null {
  const value = source[key];

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function readSubjectStringArray(
  source: Record<string, Prisma.JsonValue>,
  key: 'competencies' | 'learning_outcomes' | 'skills'
): string[] {
  const value = source[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalized = entry.trim().replace(/\s+/g, ' ');
    const comparisonKey = normalized.toLocaleLowerCase('en-US');

    if (normalized && !seen.has(comparisonKey)) {
      seen.add(comparisonKey);
      result.push(normalized);
    }
  }

  return result;
}

// Prioridad: credentialSubject.achievement_name, despues Credential.title.
// Nunca copia providerName/level/skills como titulo, y nunca usa un titulo
// vacio.
export function resolveTemplateTitleFromCredential(
  subject: Record<string, Prisma.JsonValue>,
  credentialTitle: string
): string {
  const achievementName = readSubjectText(subject, 'achievement_name');

  if (achievementName) {
    return achievementName;
  }

  const normalizedCredentialTitle =
    typeof credentialTitle === 'string' ? credentialTitle.trim() : '';

  if (normalizedCredentialTitle) {
    return normalizedCredentialTitle;
  }

  throw new BadRequestException(
    'La credencial no tiene un titulo suficiente para crear un template reutilizable.'
  );
}

// Normalizacion para comparar duplicados: trim, colapsar espacios,
// case-insensitive. No se persiste (ver decision documentada en el bundle).
export function normalizeTitleForComparison(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

// C3a.2: solo course y certification pueden guardarse como reutilizables.
// academic_subject y degree pertenecen al catalogo academico formal
// (AcademicCourse/Program) -- nunca a un catalogo libre por issuer.
export function resolveReusableCredentialType(
  credentialType: CredentialType
): ReusableCredentialType {
  if (
    credentialType !== CredentialType.course &&
    credentialType !== CredentialType.certification
  ) {
    throw new BadRequestException(
      'Solo se pueden guardar como reutilizables credenciales de tipo course o certification.'
    );
  }

  return credentialType;
}

// ---------------------------------------------------------------------------
// C4a.1: aprobacion de una interpretacion semantica (SemanticAnalysis) como
// snapshot reutilizable de un IssuerCourseTemplate.
//
// El snapshot es una copia ALLOWLISTED y estable, nunca un clon ciego de
// analysisJson. Ver docs/architecture/domain-rules-v0.md para la lista
// completa de exclusiones (sourceRefs, evidenceMap, textForEmbedding,
// storageKey/path, ids de DocumentEvidence/TextEvidence, contenido crudo,
// debug/audit, tokens, datos de blockchain).
//
// Decision de diseno: SemanticAnalysis NO tiene competencies ni
// learningOutcomes (esos campos solo existen en Credential.credentialSubject
// como dato EMITIDO por el emisor -- ver issuer-credential-draft-subject.ts
// y el principio "emitido vs inferido" de FormativeProfileService). Por eso
// el snapshot los omite por completo en vez de inventar arrays vacios para
// un concepto que no aplica a esta fuente de datos.
// ---------------------------------------------------------------------------

export const APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA =
  'approved_template_semantic_snapshot_v1';
export const REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA =
  'approved_template_semantic_snapshot_v2';

const USABLE_SEMANTIC_ANALYSIS_STATUSES: readonly SemanticAnalysisStatus[] = [
  SemanticAnalysisStatus.completed,
  SemanticAnalysisStatus.partial
];

export interface ApprovedSemanticSnapshotDescriptor {
  id: string;
  label: string;
  confidence: number | null;
}

export interface ApprovedSemanticSnapshotHoursDistributionEntry {
  areaId: string;
  hours: number;
}

export interface ApprovedTemplateSemanticSnapshot {
  schema: typeof APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA;
  semanticAnalysisSchema: string;
  status: 'completed' | 'partial';
  areas: ApprovedSemanticSnapshotDescriptor[];
  skills: ApprovedSemanticSnapshotDescriptor[];
  concepts: ApprovedSemanticSnapshotDescriptor[];
  hoursDistribution: ApprovedSemanticSnapshotHoursDistributionEntry[];
  confidence: number | null;
  warnings: string[];
  qualityFlags: string[];
}

export interface ReviewedTemplateSemanticApprovalInput {
  reviewedAreas?: unknown;
  reviewedSkills?: unknown;
  reviewedConcepts?: unknown;
  reviewNote?: unknown;
}

export interface ReviewedApprovedTemplateSemanticSnapshot {
  schema: typeof REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA;
  semanticAnalysisSchema: string;
  sourceSemanticAnalysisId: string;
  status: 'completed' | 'partial';
  originalSummary: ApprovedSemanticSnapshotSummary;
  areas: ApprovedSemanticSnapshotDescriptor[];
  skills: ApprovedSemanticSnapshotDescriptor[];
  concepts: ApprovedSemanticSnapshotDescriptor[];
  hoursDistribution: ApprovedSemanticSnapshotHoursDistributionEntry[];
  confidence: number | null;
  warnings: string[];
  qualityFlags: string[];
  review: { issuerReviewed: true; note: string | null };
}

export interface ApprovedSemanticSnapshotSummary {
  schema: string;
  status: 'completed' | 'partial';
  areaCount: number;
  skillCount: number;
  conceptCount: number;
  hasHoursDistribution: boolean;
  warningCount: number;
  qualityFlagCount: number;
}

export interface SemanticAnalysisForApprovedSnapshot {
  schemaVersion: string;
  status: 'completed' | 'partial';
  areas: Prisma.JsonValue;
  skills: Prisma.JsonValue;
  concepts: Prisma.JsonValue;
  qualityFlags: Prisma.JsonValue;
  confidence: unknown;
  analysisJson: Prisma.JsonValue | null;
}

// SemanticAnalysisStatus solo tiene completed/partial en el schema -- un
// analisis fallido nunca llega a existir como fila SemanticAnalysis (queda
// como AnalysisRun con status failed). Este guard es defensivo/a futuro:
// rechaza cualquier valor que no sea exactamente uno de los dos usables.
export function assertSemanticAnalysisStatusIsUsable(
  status: SemanticAnalysisStatus
): void {
  if (!USABLE_SEMANTIC_ANALYSIS_STATUSES.includes(status)) {
    throw new BadRequestException(
      'Solo se pueden aprobar interpretaciones semanticas con estado completed o partial.'
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// Mismo patron que FormativeProfileService.toNullableNumber -- necesario
// porque SemanticAnalysis.confidence es un Prisma.Decimal, no un number.
function readConfidenceValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const direct = readFiniteNumber(value);
  if (direct !== null) {
    return direct >= 0 && direct <= 1 ? direct : null;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof (value as { toString: unknown }).toString === 'function'
  ) {
    const parsed = Number((value as { toString: () => string }).toString());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }

  return null;
}

// areas/skills/concepts se persisten como SemanticAnalysisArtifactDescriptor[]
// (ver semantic-analysis-artifact.types.ts): { id, label, confidence, ... }.
// Solo se copian id/label/confidence -- nunca "source" ni claves adicionales
// que pudieran referenciar evidencia. Entradas malformadas se descartan en
// silencio (nunca se inventa un label).
function readDescriptorArray(
  value: Prisma.JsonValue
): ApprovedSemanticSnapshotDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ApprovedSemanticSnapshotDescriptor[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const label = readNonEmptyString(entry.label);
    if (!label) {
      continue;
    }

    const id = readNonEmptyString(entry.id) ?? label;

    result.push({
      id,
      label,
      confidence: readFiniteNumber(entry.confidence)
    });
  }

  return result;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of value) {
    const normalized = readNonEmptyString(entry);
    if (normalized) {
      result.push(normalized);
    }
  }

  return result;
}

// Mismo patron de dos rutas que FormativeProfileService.readHoursDistribution
// (analysisJson.hoursDistribution directo, o analysisJson.mapped.metadata.
// hoursDistribution como fallback legacy).
function readHoursDistributionRaw(analysisJson: Prisma.JsonValue | null): unknown[] {
  if (!isRecord(analysisJson)) {
    return [];
  }

  if (Array.isArray(analysisJson.hoursDistribution)) {
    return analysisJson.hoursDistribution;
  }

  const mapped = analysisJson.mapped;
  if (
    isRecord(mapped) &&
    isRecord(mapped.metadata) &&
    Array.isArray(mapped.metadata.hoursDistribution)
  ) {
    return mapped.metadata.hoursDistribution;
  }

  return [];
}

function readHoursDistribution(
  analysisJson: Prisma.JsonValue | null
): ApprovedSemanticSnapshotHoursDistributionEntry[] {
  const raw = readHoursDistributionRaw(analysisJson);
  const result: ApprovedSemanticSnapshotHoursDistributionEntry[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const areaId = readNonEmptyString(entry.areaId);
    const hours = readFiniteNumber(entry.hours);

    if (!areaId || hours === null) {
      continue;
    }

    result.push({ areaId, hours });
  }

  return result;
}

function readWarnings(analysisJson: Prisma.JsonValue | null): string[] {
  if (!isRecord(analysisJson)) {
    return [];
  }

  return readStringArray(analysisJson.warnings);
}

// Construye el snapshot aprobado -- ver el bloque de comentarios de C4a.1
// arriba para la lista de exclusiones. NUNCA copia analysisJson completo,
// sourceRefs, evidenceMap, textForEmbedding, ni ningun identificador de
// evidencia/almacenamiento.
export function buildApprovedTemplateSemanticSnapshot(
  semanticAnalysis: SemanticAnalysisForApprovedSnapshot
): ApprovedTemplateSemanticSnapshot {
  return {
    schema: APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA,
    semanticAnalysisSchema: semanticAnalysis.schemaVersion,
    status: semanticAnalysis.status,
    areas: readDescriptorArray(semanticAnalysis.areas),
    skills: readDescriptorArray(semanticAnalysis.skills),
    concepts: readDescriptorArray(semanticAnalysis.concepts),
    hoursDistribution: readHoursDistribution(semanticAnalysis.analysisJson),
    confidence: readConfidenceValue(semanticAnalysis.confidence),
    warnings: readWarnings(semanticAnalysis.analysisJson),
    qualityFlags: readStringArray(semanticAnalysis.qualityFlags)
  };
}

const REVIEW_LIMITS = {
  reviewedAreas: 10,
  reviewedSkills: 30,
  reviewedConcepts: 50
} as const;

function reviewedLabels(
  value: unknown,
  field: keyof typeof REVIEW_LIMITS
): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > REVIEW_LIMITS[field]) {
    throw new BadRequestException('La revisión semántica no tiene un formato válido.');
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).length !== 1 || typeof entry.label !== 'string') {
      throw new BadRequestException('La revisión semántica no tiene un formato válido.');
    }
    const label = entry.label.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (
      !label ||
      label.length > 120 ||
      /[<>]/.test(label) ||
      /^(\{|\[)/.test(label)
    ) {
      throw new BadRequestException('La revisión semántica contiene etiquetas no válidas.');
    }
    const key = label.toLocaleLowerCase('es-AR');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(label);
    }
  }
  return result;
}

function reviewedNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('La revisión semántica no tiene un formato válido.');
  }
  const note = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!note) return null;
  if (note.length > 500 || /[<>]/.test(note)) {
    throw new BadRequestException('La revisión semántica contiene texto no válido.');
  }
  return note;
}

function reviewedDescriptors(
  original: ApprovedSemanticSnapshotDescriptor[],
  labels: string[] | null
): ApprovedSemanticSnapshotDescriptor[] {
  if (labels === null) return original;
  const originalsByLabel = new Map(
    original.map((entry) => [entry.label.toLocaleLowerCase('es-AR'), entry])
  );
  return labels.map((label) => {
    const originalEntry = originalsByLabel.get(label.toLocaleLowerCase('es-AR'));
    return originalEntry
      ? { ...originalEntry, label }
      : { id: label, label, confidence: null };
  });
}

// C5: stores the issuer-reviewed interpretation separately from the raw AI
// analysis. Only labels may be changed; source descriptors and all sensitive
// artifact fields remain outside this snapshot.
export function buildReviewedApprovedTemplateSemanticSnapshot(
  semanticAnalysisId: string,
  semanticAnalysis: SemanticAnalysisForApprovedSnapshot,
  input: unknown
): ReviewedApprovedTemplateSemanticSnapshot {
  const original = buildApprovedTemplateSemanticSnapshot(semanticAnalysis);
  if (input !== undefined && (!isRecord(input) || Array.isArray(input))) {
    throw new BadRequestException('La revisión semántica no tiene un formato válido.');
  }
  const reviewed = (input ?? {}) as ReviewedTemplateSemanticApprovalInput;
  const areas = reviewedDescriptors(
    original.areas,
    reviewedLabels(reviewed.reviewedAreas, 'reviewedAreas')
  );
  const skills = reviewedDescriptors(
    original.skills,
    reviewedLabels(reviewed.reviewedSkills, 'reviewedSkills')
  );
  const concepts = reviewedDescriptors(
    original.concepts,
    reviewedLabels(reviewed.reviewedConcepts, 'reviewedConcepts')
  );

  return {
    schema: REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA,
    semanticAnalysisSchema: original.semanticAnalysisSchema,
    sourceSemanticAnalysisId: semanticAnalysisId,
    status: original.status,
    originalSummary: {
      schema: original.schema,
      status: original.status,
      areaCount: original.areas.length,
      skillCount: original.skills.length,
      conceptCount: original.concepts.length,
      hasHoursDistribution: original.hoursDistribution.length > 0,
      warningCount: original.warnings.length,
      qualityFlagCount: original.qualityFlags.length
    },
    areas,
    skills,
    concepts,
    hoursDistribution: original.hoursDistribution,
    confidence: original.confidence,
    warnings: original.warnings,
    qualityFlags: original.qualityFlags,
    review: { issuerReviewed: true, note: reviewedNote(reviewed.reviewNote) }
  };
}

export function humanSemanticNotes(flags: unknown): string[] {
  const messages: Record<string, string> = {
    area_assignment_low_confidence: 'La asignación de área tiene confianza baja.',
    semantic_quality_low: 'La cobertura semántica es limitada.',
    skills_detection_reliability_medium: 'La detección de habilidades requiere revisión.',
    hours_distribution_reliability_low_or_absent:
      'La distribución horaria no está disponible o tiene baja confiabilidad.',
    no_curricular_sections_detected:
      'No se detectaron secciones curriculares estructuradas.'
  };
  const normalized = readStringArray(flags);
  const notes = normalized.map(
    (flag) => messages[flag] ?? 'El análisis incluye observaciones técnicas que requieren revisión.'
  );
  return [...new Set(notes)];
}

// Resumen seguro para exponer en la respuesta del template -- nunca el
// snapshot completo. Acepta unknown porque en runtime viene de un campo Json
// leido de la base (approvedSemanticSnapshot), no del tipo fuerte de arriba.
export function buildApprovedSemanticSnapshotSummary(
  snapshot: unknown
): ApprovedSemanticSnapshotSummary | null {
  if (!isRecord(snapshot)) {
    return null;
  }

  const schema = readNonEmptyString(snapshot.schema);
  const status = snapshot.status;

  if (!schema || (status !== 'completed' && status !== 'partial')) {
    return null;
  }

  const areas = Array.isArray(snapshot.areas) ? snapshot.areas : [];
  const skills = Array.isArray(snapshot.skills) ? snapshot.skills : [];
  const concepts = Array.isArray(snapshot.concepts) ? snapshot.concepts : [];
  const hoursDistribution = Array.isArray(snapshot.hoursDistribution)
    ? snapshot.hoursDistribution
    : [];
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const qualityFlags = Array.isArray(snapshot.qualityFlags)
    ? snapshot.qualityFlags
    : [];

  return {
    schema,
    status,
    areaCount: areas.length,
    skillCount: skills.length,
    conceptCount: concepts.length,
    hasHoursDistribution: hoursDistribution.length > 0,
    warningCount: warnings.length,
    qualityFlagCount: qualityFlags.length
  };
}
