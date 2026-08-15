import { createApiClient } from '@/lib/api/api-client';

export interface LoginCommand {
  email: string;
  password: string;
}

export interface RegisterCommand {
  email: string;
  password: string;
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
