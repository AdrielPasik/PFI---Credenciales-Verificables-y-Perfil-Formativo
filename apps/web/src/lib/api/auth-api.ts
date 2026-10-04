import type { UserOnboardingIntent } from '@/models/auth-session';

import { createApiClient } from '@/lib/api/api-client';

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

export async function currentUserRequest(accessToken: string) {
  return createApiClient().request('/auth/me', {
    token: accessToken
  });
}
