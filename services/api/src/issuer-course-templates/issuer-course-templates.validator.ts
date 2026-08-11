import { BadRequestException } from '@nestjs/common';
import { CourseTemplateStatus, CredentialType, Prisma } from '@prisma/client';

import {
  CONTROLLED_ARRAY_ITEM_MAX_LENGTH,
  CONTROLLED_ARRAY_MAX_ITEMS,
  CONTROLLED_STRING_MAX_LENGTH,
  EXTERNAL_URL_MAX_LENGTH,
  isCalendarDate,
  type FieldUpdate
} from '../credentials/issuer-credential-draft-update.validator';

// C3a: mismos valores controlados de modality que course en
// issuer-credential-draft-subject.ts. Se duplica localmente (no se exporta
// de ese modulo) para no acoplar este catalogo al validador de drafts.
const COURSE_TEMPLATE_MODALITIES = new Set(['Presencial', 'Online', 'Asincrónica']);
const MAX_HOURS = new Prisma.Decimal('99999999.99');

// C3a.2: solo course y certification pueden guardarse como reutilizables
// (ver domain-rules-v0.md -- academic_subject/degree pertenecen al catalogo
// academico formal, no a un catalogo libre por issuer).
export const REUSABLE_CREDENTIAL_TYPES = [
  CredentialType.course,
  CredentialType.certification
] as const;
export type ReusableCredentialType = (typeof REUSABLE_CREDENTIAL_TYPES)[number];

// Campos comunes a ambos tipos (coinciden con lo que credentialSubject ya
// permite para course Y certification, ver APPLICABLE_FIELDS_BY_TYPE en
// issuer-credential-draft-subject.ts).
const COMMON_FIELDS = [
  'title',
  'description',
  'hours',
  'credentialType',
  'externalUrl',
  'competencies'
] as const;
// Exclusivos de course.
const COURSE_ONLY_FIELDS = ['modality', 'platformName', 'learningOutcomes'] as const;
// Exclusivos de certification.
const CERTIFICATION_ONLY_FIELDS = [
  'certificationCode',
  'expirationDate',
  'providerName',
  'level',
  'skills'
] as const;

const CREATE_FIELDS = [
  ...COMMON_FIELDS,
  ...COURSE_ONLY_FIELDS,
  ...CERTIFICATION_ONLY_FIELDS
] as const;
// credentialType es inmutable despues de creado (define que campos aplican);
// no se acepta en PATCH, igual criterio que createdFromCredentialId.
const PATCH_FIELDS = [
  ...COMMON_FIELDS.filter((field) => field !== 'credentialType'),
  ...COURSE_ONLY_FIELDS,
  ...CERTIFICATION_ONLY_FIELDS,
  'status'
] as const;
const CREATE_ALLOWED_FIELDS = new Set<string>(CREATE_FIELDS);
const PATCH_ALLOWED_FIELDS = new Set<string>(PATCH_FIELDS);
const COURSE_ONLY_SET = new Set<string>(COURSE_ONLY_FIELDS);
const CERTIFICATION_ONLY_SET = new Set<string>(CERTIFICATION_ONLY_FIELDS);

export interface NormalizedCourseTemplateCreate {
  credentialType: ReusableCredentialType;
  title: string;
  description: string | null;
  hours: Prisma.Decimal | null;
  modality: string | null;
  platformName: string | null;
  externalUrl: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  providerName: string | null;
  level: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export interface NormalizedCourseTemplatePatch {
  title: FieldUpdate<string>;
  description: FieldUpdate<string | null>;
  hours: FieldUpdate<Prisma.Decimal | null>;
  modality: FieldUpdate<string | null>;
  platformName: FieldUpdate<string | null>;
  externalUrl: FieldUpdate<string | null>;
  certificationCode: FieldUpdate<string | null>;
  expirationDate: FieldUpdate<string | null>;
  providerName: FieldUpdate<string | null>;
  level: FieldUpdate<string | null>;
  skills: FieldUpdate<string[]>;
  competencies: FieldUpdate<string[]>;
  learningOutcomes: FieldUpdate<string[]>;
  status: FieldUpdate<CourseTemplateStatus>;
}

export function validateCreateCourseTemplatePayload(
  payload: unknown
): NormalizedCourseTemplateCreate {
  const body = asObject(payload);
  rejectUnknownFields(body, CREATE_ALLOWED_FIELDS);

  if (!hasOwn(body, 'title')) {
    throw new BadRequestException('title es requerido.');
  }

  const credentialType = hasOwn(body, 'credentialType')
    ? normalizeCredentialType(body.credentialType)
    : CredentialType.course;

  rejectFieldsNotApplicableToType(body, credentialType);

  return {
    credentialType,
    title: normalizeRequiredTitle(body.title),
    description: hasOwn(body, 'description')
      ? normalizeDescription(body.description)
      : null,
    hours: hasOwn(body, 'hours') ? normalizeHours(body.hours) : null,
    modality: hasOwn(body, 'modality') ? normalizeModality(body.modality) : null,
    platformName: hasOwn(body, 'platformName')
      ? normalizeControlledString(body.platformName, 'platformName')
      : null,
    externalUrl: hasOwn(body, 'externalUrl')
      ? normalizeExternalUrl(body.externalUrl)
      : null,
    certificationCode: hasOwn(body, 'certificationCode')
      ? normalizeControlledString(body.certificationCode, 'certificationCode')
      : null,
    expirationDate: hasOwn(body, 'expirationDate')
      ? normalizeCalendarDate(body.expirationDate, 'expirationDate')
      : null,
    providerName: hasOwn(body, 'providerName')
      ? normalizeControlledString(body.providerName, 'providerName')
      : null,
    level: hasOwn(body, 'level') ? normalizeControlledString(body.level, 'level') : null,
    skills: hasOwn(body, 'skills')
      ? normalizeControlledStringArray(body.skills, 'skills')
      : [],
    competencies: hasOwn(body, 'competencies')
      ? normalizeControlledStringArray(body.competencies, 'competencies')
      : [],
    learningOutcomes: hasOwn(body, 'learningOutcomes')
      ? normalizeControlledStringArray(body.learningOutcomes, 'learningOutcomes')
      : []
  };
}

export function validatePatchCourseTemplatePayload(
  payload: unknown,
  currentCredentialType: ReusableCredentialType
): NormalizedCourseTemplatePatch {
  const body = asObject(payload);
  rejectUnknownFields(body, PATCH_ALLOWED_FIELDS);

  if (Object.keys(body).length === 0) {
    throw new BadRequestException('Debe enviarse al menos un campo para actualizar.');
  }

  rejectFieldsNotApplicableToType(body, currentCredentialType);

  return {
    title: normalizeOptionalField(body, 'title', normalizeRequiredTitle),
    description: normalizeOptionalField(body, 'description', normalizeDescription),
    hours: normalizeOptionalField(body, 'hours', normalizeHours),
    modality: normalizeOptionalField(body, 'modality', normalizeModality),
    platformName: normalizeOptionalField(body, 'platformName', (value) =>
      normalizeControlledString(value, 'platformName')
    ),
    externalUrl: normalizeOptionalField(body, 'externalUrl', normalizeExternalUrl),
    certificationCode: normalizeOptionalField(body, 'certificationCode', (value) =>
      normalizeControlledString(value, 'certificationCode')
    ),
    expirationDate: normalizeOptionalField(body, 'expirationDate', (value) =>
      normalizeCalendarDate(value, 'expirationDate')
    ),
    providerName: normalizeOptionalField(body, 'providerName', (value) =>
      normalizeControlledString(value, 'providerName')
    ),
    level: normalizeOptionalField(body, 'level', (value) =>
      normalizeControlledString(value, 'level')
    ),
    skills: normalizeOptionalField(body, 'skills', (value) =>
      normalizeControlledStringArray(value, 'skills')
    ),
    competencies: normalizeOptionalField(body, 'competencies', (value) =>
      normalizeControlledStringArray(value, 'competencies')
    ),
    learningOutcomes: normalizeOptionalField(body, 'learningOutcomes', (value) =>
      normalizeControlledStringArray(value, 'learningOutcomes')
    ),
    status: normalizeOptionalField(body, 'status', normalizeStatus)
  };
}

function rejectFieldsNotApplicableToType(
  body: Record<string, unknown>,
  credentialType: ReusableCredentialType
) {
  const forbidden =
    credentialType === CredentialType.course
      ? CERTIFICATION_ONLY_SET
      : COURSE_ONLY_SET;

  for (const key of Object.keys(body)) {
    if (forbidden.has(key)) {
      throw new BadRequestException(
        `${key} no aplica a un template de tipo ${credentialType}.`
      );
    }
  }
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: Set<string>) {
  const keys = Object.keys(body);

  if (keys.some((key) => !allowed.has(key))) {
    throw new BadRequestException(
      'El payload contiene campos no permitidos para el template reutilizable. ' +
        'issuerId, createdByUserId, createdFromCredentialId y ' +
        'lastSemanticAnalysisId no se aceptan desde el body.'
    );
  }
}

function normalizeOptionalField<T>(
  body: Record<string, unknown>,
  field: string,
  normalizer: (value: unknown) => T
): FieldUpdate<T> {
  return hasOwn(body, field)
    ? { provided: true, value: normalizer(body[field]) }
    : { provided: false };
}

function asObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BadRequestException('El body debe ser un objeto JSON.');
  }

  return payload as Record<string, unknown>;
}

function hasOwn(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

// C3a.2: academic_subject y degree nunca son validos aca -- pertenecen al
// catalogo academico formal (AcademicCourse/Program), no a un catalogo
// reutilizable libre por issuer.
function normalizeCredentialType(value: unknown): ReusableCredentialType {
  if (
    value !== CredentialType.course &&
    value !== CredentialType.certification
  ) {
    throw new BadRequestException('credentialType debe ser course o certification.');
  }

  return value;
}

function normalizeRequiredTitle(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('title debe ser string no vacio.');
  }

  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    throw new BadRequestException('title debe ser string no vacio.');
  }

  if (normalized.length > CONTROLLED_STRING_MAX_LENGTH) {
    throw new BadRequestException(
      `title no puede superar ${CONTROLLED_STRING_MAX_LENGTH} caracteres.`
    );
  }

  return normalized;
}

function normalizeDescription(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('description debe ser string o null.');
  }

  const normalized = value.trim();
  return normalized || null;
}

// C3a: hours llega como number JSON (ej. 22 o 22.5), a diferencia del
// validador de drafts que usa un decimal string -- el body de ejemplo del
// enunciado usa un literal numerico. Se redondea a 2 decimales, misma
// precision que Credential.hours.
function normalizeHours(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException('hours debe ser un numero decimal >= 0 o null.');
  }

  if (value < 0) {
    throw new BadRequestException('hours debe ser mayor o igual a 0.');
  }

  const decimal = new Prisma.Decimal(value.toFixed(2));

  if (decimal.gt(MAX_HOURS)) {
    throw new BadRequestException('hours es demasiado grande.');
  }

  return decimal;
}

function normalizeModality(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('modality debe ser string o null.');
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (!COURSE_TEMPLATE_MODALITIES.has(normalized)) {
    throw new BadRequestException(
      'modality debe ser Presencial, Online o Asincrónica.'
    );
  }

  return normalized;
}

function normalizeControlledString(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} debe ser string o null.`);
  }

  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length > CONTROLLED_STRING_MAX_LENGTH) {
    throw new BadRequestException(
      `${field} no puede superar ${CONTROLLED_STRING_MAX_LENGTH} caracteres.`
    );
  }

  return normalized;
}

function normalizeCalendarDate(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} debe ser YYYY-MM-DD o null.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (!isCalendarDate(normalized)) {
    throw new BadRequestException(`${field} debe ser una fecha real YYYY-MM-DD.`);
  }

  return normalized;
}

function normalizeExternalUrl(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('externalUrl debe ser string o null.');
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > EXTERNAL_URL_MAX_LENGTH) {
    throw new BadRequestException(
      `externalUrl no puede superar ${EXTERNAL_URL_MAX_LENGTH} caracteres.`
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException('externalUrl debe ser una URL HTTP o HTTPS valida.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('externalUrl debe usar HTTP o HTTPS.');
  }

  return normalized;
}

function normalizeControlledStringArray(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} debe ser string[] o null.`);
  }

  if (value.length > CONTROLLED_ARRAY_MAX_ITEMS) {
    throw new BadRequestException(
      `${field} no puede superar ${CONTROLLED_ARRAY_MAX_ITEMS} elementos.`
    );
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new BadRequestException(`${field} solo puede contener strings.`);
    }

    const normalized = normalizeWhitespace(entry);

    if (!normalized) {
      continue;
    }

    if (normalized.length > CONTROLLED_ARRAY_ITEM_MAX_LENGTH) {
      throw new BadRequestException(
        `Cada elemento de ${field} admite hasta ${CONTROLLED_ARRAY_ITEM_MAX_LENGTH} caracteres.`
      );
    }

    const comparisonKey = normalized.toLocaleLowerCase('en-US');

    if (!seen.has(comparisonKey)) {
      seen.add(comparisonKey);
      result.push(normalized);
    }
  }

  return result;
}

function normalizeStatus(value: unknown): CourseTemplateStatus {
  if (
    value !== CourseTemplateStatus.active &&
    value !== CourseTemplateStatus.archived
  ) {
    throw new BadRequestException('status debe ser active o archived.');
  }

  return value;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
