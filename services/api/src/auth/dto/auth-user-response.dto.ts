import { UserStatus } from '@prisma/client';

export interface AuthUserResponseDto {
  id: string;
  email: string;
  did: string | null;
  status: UserStatus;
}
