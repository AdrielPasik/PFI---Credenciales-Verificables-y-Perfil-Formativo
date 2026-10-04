import type { IssuerContextState } from '@/models/issuer-context';

export interface AuthUserVM {
  userReference: string;
  email: string;
  did: string | null;
  // A1.1: proyeccion de presentacion segura (nunca firstName/lastName
  // crudos) calculada por el backend con el mismo helper que ya usan
  // issuer-holder-resolution/issuer-credential-read/verification. Nunca
  // vacio: cae a email si no hay nombre.
  displayLabel: string;
}

/**
 * El usuario de la sesion RESUELTA (`GET /auth/me`), que a diferencia de la
 * respuesta de login tambien trae la capacidad de plataforma.
 *
 * S3: `isPlatformAdmin` solo decide si se OFRECE la superficie /admin. No es
 * seguridad -- la autoridad es `PlatformAdminGuard`, server-side, que relee la
 * tabla en cada request. Y no dice nada sobre que issuer puede operar esta
 * persona: eso sigue siendo `issuerContext`, un plano separado.
 */
export interface CurrentUserVM extends AuthUserVM {
  isPlatformAdmin: boolean;
}

export type AuthFeedbackCode =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'email_taken'
  | 'forbidden'
  | 'service_unavailable'
  | 'network'
  | 'incompatible_response'
  | 'session_expired'
  | 'unexpected';

export interface AuthFeedback {
  code: AuthFeedbackCode;
  message: string;
  recoverable: boolean;
}

export type AuthSessionState =
  | { status: 'booting' }
  | { status: 'unauthenticated' }
  | { status: 'authenticating' }
  | { status: 'resolving-context' }
  | {
      status: 'authenticated';
      currentUser: CurrentUserVM;
      issuerContext: IssuerContextState;
    }
  | {
      status: 'recoverable-error';
      error: AuthFeedback;
    }
  | {
      status: 'expired';
      error: AuthFeedback;
    };
