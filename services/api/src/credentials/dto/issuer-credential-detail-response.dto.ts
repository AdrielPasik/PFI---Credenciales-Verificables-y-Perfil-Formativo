import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType
} from '@prisma/client';

export class IssuerCredentialSubjectResponseDto {
  achievement_name!: string | null;
  institution_name!: string | null;
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

export class IssuerCredentialDetailResponseDto {
  id!: string;
  status!: CredentialStatus;
  type!: CredentialType;
  title!: string;
  sourceType!: CredentialSourceType;
  credentialSubject!: IssuerCredentialSubjectResponseDto;
  createdAt!: string;
  updatedAt!: string;
  issuer!: IssuerCredentialIssuerResponseDto;
  holder!: IssuerCredentialHolderResponseDto;
}
