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
