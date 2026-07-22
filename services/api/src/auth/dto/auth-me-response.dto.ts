import { IssuerMembershipRole, IssuerMembershipStatus } from '@prisma/client';

import { AuthUserResponseDto } from './auth-user-response.dto';

export interface AuthMeResponseDto extends AuthUserResponseDto {
  issuerMemberships: Array<{
    issuerId: string;
    role: IssuerMembershipRole;
    status: IssuerMembershipStatus;
  }>;
}
