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

export interface CreateCredentialDraftCommand {
  issuerReference: string;
  holderReference: string;
  achievementName: string;
  institutionName: string;
  credentialType: CredentialType;
}

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
