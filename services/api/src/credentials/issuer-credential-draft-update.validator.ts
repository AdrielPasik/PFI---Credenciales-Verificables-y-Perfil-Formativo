import { BadRequestException } from '@nestjs/common';
import { CredentialType, Prisma } from '@prisma/client';

export const TYPE_SPECIFIC_UPDATE_FIELDS = [
  'completionDate',
  'academicPeriod',
  'programName',
  'grade',
  'providerName',
  'platformName',
  'modality',
  'level',
  'certificationCode',
  'expirationDate',
  'externalUrl',
  'skills',
  'competencies',
  'learningOutcomes'
] as const;

export type TypeSpecificUpdateField =
  (typeof TYPE_SPECIFIC_UPDATE_FIELDS)[number];

const EDITABLE_FIELDS = [
  'academicCourseReference',
  'curriculumReference',
  'achievementName',
  'description',
  'hours',
  'type',
  ...TYPE_SPECIFIC_UPDATE_FIELDS
] as const;
const ALLOWED_FIELDS = new Set(['expectedUpdatedAt', ...EDITABLE_FIELDS]);
const CONTROLLED_STRING_FIELDS = [
  'academicPeriod',
  'programName',
  'grade',
  'providerName',
  'platformName',
  'modality',
  'level',
  'certificationCode'
] as const;
const ARRAY_FIELDS = [
  'skills',
  'competencies',
  'learningOutcomes'
] as const;
const HOURS_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HOURS = new Prisma.Decimal('99999999.99');
export const CONTROLLED_STRING_MAX_LENGTH = 255;
export const EXTERNAL_URL_MAX_LENGTH = 2_048;
export const CONTROLLED_ARRAY_MAX_ITEMS = 30;
// R2: 80 fue calibrado pensando en tags cortos (skills/competencies de
// academic_subject, ej. "TypeScript", "modelado de datos"). El mismo
// campo tecnico (learningOutcomes) se reutiliza para "Contenido e
// información adicional" en course -- la UI invita explicitamente
// contenido/temario mas largo por linea ("Agregá contenidos, temario,
// herramientas, conocimientos abordados u otra información relevante
// del curso"), que supera 80 caracteres con cualquier oracion realista.
// 500 sigue acotado (rechaza pegar un documento entero en una sola
// linea) pero admite una linea de temario/competencia realista para
// cualquier tipo. Se mantiene un unico limite compartido por los tres
// campos (skills/competencies/learningOutcomes) -- nunca uno distinto
// por CredentialType, para no introducir una regla nueva de scoping.
export const CONTROLLED_ARRAY_ITEM_MAX_LENGTH = 500;

export interface FieldUpdate<T> {
  provided: boolean;
  value?: T;
}

export interface NormalizedIssuerCredentialDraftUpdate {
  expectedUpdatedAt: Date;
  expectedUpdatedAtIso: string;
  academicCourseReference: FieldUpdate<string>;
  curriculumReference: FieldUpdate<string>;
  achievementName: FieldUpdate<string>;
  description: FieldUpdate<string | null>;
  hours: FieldUpdate<Prisma.Decimal | null>;
  type: FieldUpdate<CredentialType>;
  completionDate: FieldUpdate<string | null>;
  academicPeriod: FieldUpdate<string | null>;
  programName: FieldUpdate<string | null>;
  grade: FieldUpdate<string | null>;
  providerName: FieldUpdate<string | null>;
  platformName: FieldUpdate<string | null>;
  modality: FieldUpdate<string | null>;
  level: FieldUpdate<string | null>;
  certificationCode: FieldUpdate<string | null>;
  expirationDate: FieldUpdate<string | null>;
  externalUrl: FieldUpdate<string | null>;
  skills: FieldUpdate<string[]>;
  competencies: FieldUpdate<string[]>;
  learningOutcomes: FieldUpdate<string[]>;
}

export function validateIssuerCredentialDraftUpdate(
  payload: unknown
): NormalizedIssuerCredentialDraftUpdate {
  const body = asObject(payload);
  const keys = Object.keys(body);

  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new BadRequestException(
      'El payload contiene campos no permitidos para actualizar el borrador.'
    );
  }

  if (!hasOwn(body, 'expectedUpdatedAt')) {
    throw new BadRequestException('expectedUpdatedAt es requerido.');
  }

  if (!EDITABLE_FIELDS.some((field) => hasOwn(body, field))) {
    throw new BadRequestException(
      'Debe enviarse al menos un campo editable ademas de expectedUpdatedAt.'
    );
  }

  const expectedUpdatedAtIso = normalizeExpectedUpdatedAt(
    body.expectedUpdatedAt
  );
  const result = {
    expectedUpdatedAt: new Date(expectedUpdatedAtIso),
    expectedUpdatedAtIso,
    academicCourseReference: normalizeOptionalField(
      body,
      'academicCourseReference',
      normalizeAcademicCourseReference
    ),
    curriculumReference: normalizeOptionalField(
      body,
      'curriculumReference',
      (value) => normalizeReference(value, 'curriculumReference')
    ),
    achievementName: normalizeOptionalField(
      body,
      'achievementName',
      normalizeAchievementName
    ),
    description: normalizeOptionalField(
      body,
      'description',
      normalizeDescription
    ),
    hours: normalizeOptionalField(body, 'hours', normalizeHours),
    type: normalizeOptionalField(body, 'type', normalizeCredentialType),
    completionDate: normalizeOptionalField(
      body,
      'completionDate',
      (value) => normalizeCalendarDate(value, 'completionDate')
    ),
    expirationDate: normalizeOptionalField(
      body,
      'expirationDate',
      (value) => normalizeCalendarDate(value, 'expirationDate')
    ),
    externalUrl: normalizeOptionalField(
      body,
      'externalUrl',
      normalizeExternalUrl
    )
  } as Omit<
    NormalizedIssuerCredentialDraftUpdate,
    | (typeof CONTROLLED_STRING_FIELDS)[number]
    | (typeof ARRAY_FIELDS)[number]
  > &
    Partial<NormalizedIssuerCredentialDraftUpdate>;

  for (const field of CONTROLLED_STRING_FIELDS) {
    result[field] = normalizeOptionalField(body, field, (value) =>
      normalizeControlledString(value, field)
    );
  }

  for (const field of ARRAY_FIELDS) {
    result[field] = normalizeOptionalField(body, field, (value) =>
      normalizeControlledStringArray(value, field)
    );
  }

  if (
    result.academicCourseReference?.provided &&
    (result.achievementName?.provided ||
      result.description?.provided ||
      result.hours?.provided)
  ) {
    throw new BadRequestException(
      'academicCourseReference no puede combinarse con achievementName, description u hours.'
    );
  }

  if (
    result.curriculumReference?.provided &&
    !result.academicCourseReference?.provided
  ) {
    throw new BadRequestException(
      'curriculumReference requiere academicCourseReference.'
    );
  }

  if (
    result.curriculumReference?.provided &&
    result.programName?.provided
  ) {
    throw new BadRequestException(
      'curriculumReference no puede combinarse con programName.'
    );
  }

  return result as NormalizedIssuerCredentialDraftUpdate;
}

function normalizeAcademicCourseReference(value: unknown) {
  return normalizeReference(value, 'academicCourseReference');
}

function normalizeReference(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new BadRequestException(
      `${field} debe ser string no vacio.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new BadRequestException(
      `${field} debe ser string no vacio.`
    );
  }

  return normalized;
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

function normalizeExpectedUpdatedAt(value: unknown) {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new BadRequestException(
      'expectedUpdatedAt debe ser una fecha ISO exacta.'
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new BadRequestException(
      'expectedUpdatedAt debe ser una fecha ISO exacta.'
    );
  }

  return value;
}

function normalizeAchievementName(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('achievementName debe ser string.');
  }

  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    throw new BadRequestException('achievementName no puede estar vacio.');
  }

  if (normalized.length > CONTROLLED_STRING_MAX_LENGTH) {
    throw new BadRequestException(
      `achievementName no puede superar ${CONTROLLED_STRING_MAX_LENGTH} caracteres.`
    );
  }

  return normalized;
}

function normalizeDescription(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('description debe ser string o null.');
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeCredentialType(value: unknown) {
  if (
    typeof value !== 'string' ||
    !Object.values(CredentialType).includes(value as CredentialType)
  ) {
    throw new BadRequestException(
      'type debe ser academic_subject, course, certification o degree.'
    );
  }

  return value as CredentialType;
}

function normalizeCalendarDate(value: unknown, field: string) {
  if (value === null) {
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

export function isCalendarDate(value: string) {
  if (!CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeControlledString(value: unknown, field: string) {
  if (value === null) {
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

function normalizeExternalUrl(value: unknown) {
  if (value === null) {
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
  if (value === null) {
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

function normalizeHours(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('hours debe ser un decimal string o null.');
  }

  const normalized = value.trim();

  if (!HOURS_PATTERN.test(normalized)) {
    throw new BadRequestException(
      'hours debe ser un decimal positivo con hasta 8 enteros y 2 decimales.'
    );
  }

  const decimal = new Prisma.Decimal(normalized);

  if (decimal.lte(0)) {
    throw new BadRequestException('hours debe ser mayor a 0.');
  }

  if (decimal.gt(MAX_HOURS)) {
    throw new BadRequestException(
      'hours debe ser un decimal positivo con hasta 8 enteros y 2 decimales.'
    );
  }

  return decimal;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}
