import { createApiClient } from '@/lib/api/api-client';

export interface LoginCommand {
  email: string;
  password: string;
}

export async function loginRequest(command: LoginCommand) {
  return createApiClient().request('/auth/login', {
    method: 'POST',
    body: command
  });
}

export async function currentUserRequest(accessToken: string) {
  return createApiClient().request('/auth/me', {
    token: accessToken
  });
}
