export interface HolderSummaryVM {
  holderReference: string;
  email: string;
  did: string | null;
  displayLabel: string;
}

export interface HolderResolutionCommand {
  issuerReference: string;
  email: string;
}

export interface AcademicProgramSearchItemVM {
  programReference: string;
  programCode: string;
  programName: string;
  curriculumReference: string;
  curriculumCode: string;
}

export interface CurriculumAcademicSubjectSearchItemVM {
  academicCourseReference: string;
  code: string;
  name: string;
  description: string | null;
  hours: string | null;
  programReference: string;
  programCode: string;
  programName: string;
  curriculumReference: string;
  curriculumCode: string;
}

export interface AcademicProgramSearchCommand {
  issuerReference: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CurriculumAcademicSubjectSearchCommand {
  issuerReference: string;
  curriculumReference: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export type CredentialType =
  | 'academic_subject'
  | 'course'
  | 'certification'
  | 'degree';

export const credentialTypeLabels: Record<CredentialType, string> = {
  academic_subject: 'Asignatura académica',
  course: 'Curso',
  certification: 'Certificación',
  degree: 'Título académico'
};

export const credentialTypeOptions: readonly CredentialType[] = [
  'course',
  'certification',
  'academic_subject',
  'degree'
];

export type ManualCredentialType = Exclude<
  CredentialType,
  'academic_subject'
>;

export interface CreateManualCredentialDraftCommand {
  issuerReference: string;
  holderReference: string;
  achievementName: string;
  institutionName: string;
  credentialType: ManualCredentialType;
}

export interface CreateAcademicSubjectCurricularDraftCommand {
  issuerReference: string;
  holderReference: string;
  credentialType: 'academic_subject';
  academicCourseReference: string;
  curriculumReference: string;
}

export type CreateCredentialDraftCommand =
  | CreateManualCredentialDraftCommand
  | CreateAcademicSubjectCurricularDraftCommand;

export type CredentialDraftFormSubmission =
  | {
      credentialType: ManualCredentialType;
      achievementName: string;
      holder: HolderSummaryVM;
    }
  | {
      credentialType: 'academic_subject';
      holder: HolderSummaryVM;
      program: AcademicProgramSearchItemVM;
      subject: CurriculumAcademicSubjectSearchItemVM;
    };

export type CredentialStatus = 'draft' | 'issued' | 'revoked';

export interface CreatedCredentialDraftVM {
  credentialReference: string;
  issuerReference: string;
  status: CredentialStatus;
}

export interface IssuerCredentialSubjectVM {
  achievementName: string | null;
  institutionName: string | null;
  completionDate: string | null;
  academicPeriod: string | null;
  programName: string | null;
  grade: string | null;
  providerName: string | null;
  platformName: string | null;
  modality: string | null;
  level: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  externalUrl: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export interface IssuerCredentialDetailVM {
  credentialReference: string;
  title: string;
  description: string | null;
  hours: string | null;
  type: CredentialType;
  typeLabel: string;
  status: CredentialStatus;
  statusLabel: string;
  issuer: {
    displayName: string;
    did: string | null;
  };
  credentialSubject: IssuerCredentialSubjectVM;
  holder: {
    displayLabel: string;
    email: string | null;
    did: string | null;
  };
  academicCourse: {
    academicCourseReference: string;
    code: string;
    name: string;
    description: string | null;
    hours: string | null;
    program: AcademicProgramSearchItemVM | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialDraftPatchFields {
  achievementName: string;
  description: string | null;
  hours: string | null;
  type: CredentialType;
  completionDate: string | null;
  academicPeriod: string | null;
  programName: string | null;
  grade: string | null;
  providerName: string | null;
  platformName: string | null;
  modality: string | null;
  level: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  externalUrl: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export type UpdateIssuerCredentialDraftCommand = {
  issuerReference: string;
  credentialReference: string;
  expectedUpdatedAt: string;
  academicCourseReference?: string;
  curriculumReference?: string;
} & Partial<CredentialDraftPatchFields>;

export type CredentialFeedbackCode =
  | 'invalid_input'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'session_expired'
  | 'service_unavailable'
  | 'network'
  | 'incompatible_response'
  | 'unexpected';

export interface CredentialFeedback {
  code: CredentialFeedbackCode;
  message: string;
}
