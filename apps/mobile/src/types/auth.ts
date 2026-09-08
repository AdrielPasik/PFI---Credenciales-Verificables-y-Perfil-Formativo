/**
 * Modelos de sesión.
 *
 * El backend no distingue "rol holder": cualquier cuenta autenticada es
 * titular de sus propias credenciales (`/me/*` sólo exige AuthGuard). Las
 * membresías de emisor existen en `/auth/me` pero la app móvil las ignora
 * a propósito: Scope Mobile es holder-only (secciones 12 y 57 del encargo).
 */
export interface AuthUserVM {
  userReference: string;
  email: string;
  did: string | null;
  /**
   * Proyección de presentación calculada por el backend (nunca firstName /
   * lastName crudos). Nunca vacía: cae a email si no hay nombre.
   */
  displayLabel: string;
}

export type AuthFeedbackCode =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'forbidden'
  | 'service_unavailable'
  | 'network'
  | 'timeout'
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
  | { status: 'unauthenticated'; notice: AuthFeedback | null }
  | { status: 'authenticating' }
  | { status: 'authenticated'; currentUser: AuthUserVM }
  | { status: 'recoverable-error'; error: AuthFeedback };
