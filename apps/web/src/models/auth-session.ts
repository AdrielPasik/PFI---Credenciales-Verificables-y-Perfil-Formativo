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

export type CurrentUserVM = AuthUserVM;

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
