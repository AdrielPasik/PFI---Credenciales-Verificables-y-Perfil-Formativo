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

export interface IssuerCredentialDetailVM {
  credentialReference: string;
  issuerReference: string;
  title: string;
  type: CredentialType;
  typeLabel: string;
  status: CredentialStatus;
  statusLabel: string;
  institutionName: string | null;
  createdAt: string;
}

export type CredentialFeedbackCode =
  | 'invalid_input'
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
