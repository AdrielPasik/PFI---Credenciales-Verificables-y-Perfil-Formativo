import { BadRequestException } from '@nestjs/common';
import { CredentialSourceType, CredentialType } from '@prisma/client';

import { type CreateCredentialDraftDto } from './dto/create-credential-draft.dto';

const INTERNAL_OR_RELATIONAL_FIELDS = [
  'academicCourseId',
  'programCourseId',
  'curriculumVersionId',
  'academicCourse',
  'programCourse',
  'curriculum',
  'program'
] as const;

const CURRICULAR_ALLOWED_FIELDS = new Set([
  'issuerId',
  'subjectUserId',
  'type',
  'sourceType',
  'academicCourseReference',
  'curriculumReference'
]);

export interface AcademicCurriculumSelection {
  academicCourseReference: string;
  curriculumReference: string;
}

export function validateCreateCredentialDraftCurricularSelection(
  payload: CreateCredentialDraftDto
): AcademicCurriculumSelection | null {
  const record = payload as unknown as Record<string, unknown>;

  for (const field of INTERNAL_OR_RELATIONAL_FIELDS) {
    if (hasOwn(record, field)) {
      throw new BadRequestException(
        `${field} no forma parte del contrato publico de creacion de borradores.`
      );
    }
  }

  const hasAcademicCourseReference = hasOwn(
    record,
    'academicCourseReference'
  );
  const hasCurriculumReference = hasOwn(record, 'curriculumReference');

  if (hasAcademicCourseReference !== hasCurriculumReference) {
    throw new BadRequestException(
      'academicCourseReference y curriculumReference deben enviarse juntos.'
    );
  }

  if (!hasAcademicCourseReference) {
    return null;
  }

  const unexpectedField = Object.keys(record).find(
    (field) => !CURRICULAR_ALLOWED_FIELDS.has(field)
  );

  if (unexpectedField) {
    throw new BadRequestException(
      `${unexpectedField} no forma parte del contrato curricular de creacion de borradores.`
    );
  }

  const academicCourseReference = normalizeReference(
    record.academicCourseReference,
    'academicCourseReference'
  );
  const curriculumReference = normalizeReference(
    record.curriculumReference,
    'curriculumReference'
  );

  if (payload.type !== CredentialType.academic_subject) {
    throw new BadRequestException(
      'La seleccion curricular solo puede usarse con type academic_subject.'
    );
  }

  if (payload.sourceType !== CredentialSourceType.manual_issuer) {
    throw new BadRequestException(
      'La creacion curricular requiere sourceType manual_issuer.'
    );
  }

  return {
    academicCourseReference,
    curriculumReference
  };
}

function normalizeReference(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} debe ser un string no vacio.`);
  }

  return value.trim();
}

function hasOwn(record: object, field: string) {
  return Object.prototype.hasOwnProperty.call(record, field);
}
