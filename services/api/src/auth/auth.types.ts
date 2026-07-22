import { UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  did: string | null;
  status: UserStatus;
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}
