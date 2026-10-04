import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@prisma/client';

import { AuthUserResponseDto } from './auth-user-response.dto';

export interface AuthMeResponseDto extends AuthUserResponseDto {
  // S3: capacidad de ADMINISTRACION DE PLATAFORMA, como booleano y nada mas.
  // Nunca `PlatformAdmin.id`, nunca `grantedAt`, nunca el objeto: el cliente
  // solo necesita saber si mostrar la superficie /admin, y la autoridad real
  // sigue siendo server-side (`PlatformAdminGuard`, que relee la tabla en cada
  // request). Deliberadamente SEPARADO de `issuerMemberships`: son dos planos
  // de autorizacion distintos y este flag no dice nada sobre que issuer puede
  // operar esta persona.
  platformAdmin: boolean;
  issuerMemberships: Array<{
    issuerId: string;
    issuerName: string;
    issuerDid: string | null;
    issuerAuthorizationStatus: IssuerAuthorizationStatus;
    role: IssuerMembershipRole;
    status: IssuerMembershipStatus;
  }>;
}
