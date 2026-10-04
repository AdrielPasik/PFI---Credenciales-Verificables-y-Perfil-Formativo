import {
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus,
  UserOnboardingIntent
} from '@prisma/client';

import { AuthUserResponseDto } from './auth-user-response.dto';

export interface AuthMeResponseDto extends AuthUserResponseDto {
  // O1: intencion de onboarding declarada en el signup, o `null` para las
  // cuentas creadas antes de que Scope lo preguntara. NO es autorizacion: lo
  // unico que el cliente hace con esto es decidir a donde aterrizar cuando no
  // hay ningun contexto institucional operativo. Ningun guard la lee.
  onboardingIntent: UserOnboardingIntent | null;
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
