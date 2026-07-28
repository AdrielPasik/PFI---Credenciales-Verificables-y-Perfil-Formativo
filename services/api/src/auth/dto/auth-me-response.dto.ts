import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { AuthUserResponseDto } from './auth-user-response.dto';

export interface AuthMeResponseDto extends AuthUserResponseDto {
  issuerMemberships: Array<{
    issuerId: string;
    issuerName: string;
    issuerDid: string | null;
    issuerAuthorizationStatus: IssuerAuthorizationStatus;
    role: IssuerMembershipRole;
    status: IssuerMembershipStatus;
  }>;
}
