import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType
} from '@prisma/client';

export class IssuerCredentialSubjectResponseDto {
  achievement_name!: string | null;
  institution_name!: string | null;
  completion_date!: string | null;
  academic_period!: string | null;
  program_name!: string | null;
  grade!: string | null;
  provider_name!: string | null;
  platform_name!: string | null;
  modality!: string | null;
  level!: string | null;
  certification_code!: string | null;
  expiration_date!: string | null;
  external_url!: string | null;
  skills!: string[];
  competencies!: string[];
  learning_outcomes!: string[];
}

export class IssuerCredentialIssuerResponseDto {
  displayName!: string;
  did!: string | null;
}

export class IssuerCredentialHolderResponseDto {
  displayLabel!: string;
  email!: string | null;
  did!: string | null;
}

export class IssuerCredentialAcademicCourseResponseDto {
  academicCourseReference!: string;
  code!: string;
  name!: string;
  description!: string | null;
  hours!: string | null;
  program!: IssuerCredentialAcademicProgramResponseDto | null;
}

export class IssuerCredentialAcademicProgramResponseDto {
  programReference!: string;
  programCode!: string;
  programName!: string;
  curriculumReference!: string;
  curriculumCode!: string;
}

export class IssuerCredentialDetailResponseDto {
  id!: string;
  status!: CredentialStatus;
  type!: CredentialType;
  title!: string;
  description!: string | null;
  hours!: string | null;
  sourceType!: CredentialSourceType;
  credentialSubject!: IssuerCredentialSubjectResponseDto;
  createdAt!: string;
  updatedAt!: string;
  issuer!: IssuerCredentialIssuerResponseDto;
  holder!: IssuerCredentialHolderResponseDto;
  academicCourse!: IssuerCredentialAcademicCourseResponseDto | null;
}
