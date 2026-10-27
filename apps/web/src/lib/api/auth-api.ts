import type { UserOnboardingIntent } from '@/models/auth-session';

import { createApiClient } from '@/lib/api/api-client';
import { ApiError } from '@/lib/errors/api-error';

export interface LoginCommand {
  email: string;
  password: string;
}

export interface RegisterCommand {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  // O1: el frontend nuevo SIEMPRE lo manda (la selección es obligatoria en el
  // form). Es opcional en el tipo porque el contrato del backend lo es, por
  // compatibilidad de deploy entre web y API.
  onboardingIntent?: UserOnboardingIntent;
}

export async function loginRequest(command: LoginCommand) {
  return createApiClient().request('/auth/login', {
    method: 'POST',
    body: command
  });
}

// A1: nunca manda confirmPassword al backend -- esa confirmacion es
// exclusivamente client-side (ver register-form.tsx).
export async function registerRequest(command: RegisterCommand) {
  return createApiClient().request('/auth/register', {
    method: 'POST',
    body: command
  });
}

// ---------------------------------------------------------------------------
// Recuperacion de contrasena
//
// Los tres endpoints son PUBLICOS: se llaman SIN token, a proposito. Una sesion
// abierta en este navegador no interviene (ni se envia su JWT, ni un 401 puede
// disparar el "sesion vencida" del SessionProvider, que vive en
// `requestAuthenticated`). La autoridad es el backend; aca solo se valida que la
// respuesta sea exactamente el contrato.
// ---------------------------------------------------------------------------

export interface RequestPasswordResetCommand {
  email: string;
}

export interface ConfirmPasswordResetCommand {
  /** Secreto de un solo uso. Solo se manda a verify/confirm; nunca se guarda. */
  token: string;
  /** Tal cual la escribio la persona: sin trim, sin normalizar. */
  password: string;
}

/**
 * Una respuesta 2xx cuyo cuerpo NO es el contrato no se interpreta como exito. Se
 * lanza `invalid-response`, sin copiar el cuerpo (que podria traer cualquier cosa).
 */
function expectStatus(payload: unknown, expected: string): void {
  const status =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as { status?: unknown }).status
      : undefined;

  if (status !== expected) {
    throw new ApiError(
      'El servicio devolvió una respuesta inesperada.',
      'invalid-response'
    );
  }
}

/** 202 `{ status: 'requested' }`. NO significa que el correo haya salido. */
export async function requestPasswordReset(
  command: RequestPasswordResetCommand
): Promise<void> {
  const payload = await createApiClient().request(
    '/auth/password-reset/request',
    { method: 'POST', body: { email: command.email } }
  );

  expectStatus(payload, 'requested');
}

/** 200 `{ status: 'valid' }`. Solo lectura: no consume el token. */
export async function verifyPasswordResetToken(
  command: Pick<ConfirmPasswordResetCommand, 'token'>
): Promise<void> {
  const payload = await createApiClient().request(
    '/auth/password-reset/verify',
    { method: 'POST', body: { token: command.token } }
  );

  expectStatus(payload, 'valid');
}

/**
 * 200 `{ status: 'password_reset' }`. Consume el token. NO devuelve un JWT y la
 * web NO inicia sesion. Se envian exactamente `token` y `password`: nunca un email,
 * un id ni una version de sesion.
 */
export async function confirmPasswordReset(
  command: ConfirmPasswordResetCommand
): Promise<void> {
  const payload = await createApiClient().request(
    '/auth/password-reset/confirm',
    {
      method: 'POST',
      body: { token: command.token, password: command.password }
    }
  );

  expectStatus(payload, 'password_reset');
}

export async function currentUserRequest(accessToken: string) {
  return createApiClient().request('/auth/me', {
    token: accessToken
  });
}
