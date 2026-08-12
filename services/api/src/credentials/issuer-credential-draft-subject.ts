import { BadRequestException } from '@nestjs/common';
import { CredentialType, Prisma } from '@prisma/client';

import {
  isCalendarDate,
  type NormalizedIssuerCredentialDraftUpdate,
  TYPE_SPECIFIC_UPDATE_FIELDS,
  type TypeSpecificUpdateField
} from './issuer-credential-draft-update.validator';

const SUBJECT_KEY_BY_UPDATE_FIELD: Record<
  TypeSpecificUpdateField,
  string
> = {
  completionDate: 'completion_date',
  academicPeriod: 'academic_period',
  programName: 'program_name',
  grade: 'grade',
  providerName: 'provider_name',
  platformName: 'platform_name',
  modality: 'modality',
  level: 'level',
  certificationCode: 'certification_code',
  expirationDate: 'expiration_date',
  externalUrl: 'external_url',
  skills: 'skills',
  competencies: 'competencies',
  learningOutcomes: 'learning_outcomes'
};

const APPLICABLE_FIELDS_BY_TYPE: Record<
  CredentialType,
  ReadonlySet<TypeSpecificUpdateField>
> = {
  [CredentialType.academic_subject]: new Set([
    'completionDate',
    'academicPeriod',
    'programName',
    'grade',
    'skills',
    'competencies'
  ]),
  [CredentialType.course]: new Set([
    'completionDate',
    // C4x fix: `platformName` se mantiene en el set "aplicable" solo para
    // que el loop de abajo NO borre un `platform_name` legacy ya persistido
    // cuando el PATCH toca otro campo distinto (se preserva de solo
    // lectura). Nunca se acepta como dato nuevo: assertPlatformNameIsNotEditable
    // rechaza con 400 cualquier intento de enviarlo, para cualquier tipo,
    // antes de llegar a este set. El emisor activo es la fuente
    // institucional de la plataforma, no un dato libre del operador.
    'platformName',
    'modality',
    'externalUrl',
    'competencies',
    'learningOutcomes'
  ]),
  [CredentialType.certification]: new Set([
    'completionDate',
    'certificationCode',
    'expirationDate',
    'externalUrl',
    'providerName',
    'level',
    'skills',
    'competencies'
  ]),
  [CredentialType.degree]: new Set([
    'completionDate',
    'programName',
    'level',
    'grade',
    'competencies',
    'learningOutcomes'
  ])
};

export function buildUpdatedCredentialSubject(input: {
  currentSubject: Prisma.InputJsonObject;
  finalType: CredentialType;
  resultingTitle: string;
  issuerName: string;
  update: NormalizedIssuerCredentialDraftUpdate;
}): Prisma.InputJsonObject {
  assertPlatformNameIsNotEditable(input.update);
  assertRequestedFieldsApplyToType(input.update, input.finalType);

  if (
    input.finalType === CredentialType.course &&
    input.update.modality.provided &&
    input.update.modality.value !== null &&
    input.update.modality.value !== undefined &&
    !COURSE_MODALITIES.has(input.update.modality.value)
  ) {
    throw new BadRequestException(
      'modality debe ser Presencial, Online o Asincrónica para course.'
    );
  }

  const result = {
    ...input.currentSubject
  } as Record<string, Prisma.InputJsonValue | null | undefined>;
  const applicableFields = APPLICABLE_FIELDS_BY_TYPE[input.finalType];

  for (const field of TYPE_SPECIFIC_UPDATE_FIELDS) {
    const subjectKey = SUBJECT_KEY_BY_UPDATE_FIELD[field];

    if (!applicableFields.has(field)) {
      delete result[subjectKey];
      continue;
    }

    const fieldUpdate = input.update[field];

    if (!fieldUpdate.provided) {
      continue;
    }

    if (fieldUpdate.value === null) {
      delete result[subjectKey];
      continue;
    }

    result[subjectKey] = fieldUpdate.value;
  }

  result.achievement_name = input.resultingTitle;
  result.institution_name = input.issuerName;

  assertDateOrder(result);

  return result as Prisma.InputJsonObject;
}

const COURSE_MODALITIES = new Set(['Presencial', 'Online', 'Asincrónica']);

// C4x fix: `platformName` deja de ser un dato editable via PATCH, para
// cualquier tipo (solo `course` lo aceptaba antes). El curso pertenece al
// emisor activo y la entidad emisora es la fuente institucional -- no un
// texto libre que el operador pueda escribir o reenviar. Se rechaza con
// 400 explicito en cuanto se envia, sin importar si el tipo final es
// course u otro. Un `platform_name` legacy ya persistido sigue
// preservandose de solo lectura (ver APPLICABLE_FIELDS_BY_TYPE.course).
function assertPlatformNameIsNotEditable(
  update: NormalizedIssuerCredentialDraftUpdate
) {
  if (update.platformName.provided) {
    throw new BadRequestException(
      'platformName no es un dato editable. La entidad emisora es la fuente institucional de la plataforma.'
    );
  }
}

function assertRequestedFieldsApplyToType(
  update: NormalizedIssuerCredentialDraftUpdate,
  finalType: CredentialType
) {
  const applicableFields = APPLICABLE_FIELDS_BY_TYPE[finalType];

  for (const field of TYPE_SPECIFIC_UPDATE_FIELDS) {
    if (update[field].provided && !applicableFields.has(field)) {
      throw new BadRequestException(
        `${field} no aplica al tipo ${finalType}.`
      );
    }
  }
}

function assertDateOrder(
  subject: Record<string, Prisma.InputJsonValue | null | undefined>
) {
  const completionDate = readCalendarDate(subject.completion_date);
  const expirationDate = readCalendarDate(subject.expiration_date);

  if (
    completionDate &&
    expirationDate &&
    expirationDate < completionDate
  ) {
    throw new BadRequestException(
      'expirationDate no puede ser anterior a completionDate.'
    );
  }
}

function readCalendarDate(value: Prisma.InputJsonValue | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  if (!isCalendarDate(value)) {
    throw new BadRequestException(
      'El borrador contiene una fecha controlada invalida.'
    );
  }

  return value;
}
