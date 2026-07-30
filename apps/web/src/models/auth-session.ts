import type { IssuerContextState } from '@/models/issuer-context';

export interface AuthUserVM {
  userReference: string;
  email: string;
  did: string | null;
}

export type CurrentUserVM = AuthUserVM;

export type AuthFeedbackCode =
  | 'invalid_input'
  | 'invalid_credentials'
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
