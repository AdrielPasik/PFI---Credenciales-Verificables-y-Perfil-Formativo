import {
  invalid,
  nullableString,
  record,
  requiredString,
  safeString
} from '@/lib/adapters/contract';
import type { AuthUserVM } from '@/types/auth';

/**
 * Adaptación de las respuestas de autenticación.
 *
 * `/auth/me` incluye además `issuerMemberships`. Scope Mobile es holder-only:
 * ese campo se valida como array (para detectar un contrato roto) pero NO se
 * expone a la UI ni habilita ninguna superficie institucional.
 */

export interface AdaptedLoginResponse {
  accessToken: string;
  user: AuthUserVM;
}

function adaptUser(payload: unknown, path: string): AuthUserVM {
  const user = record(payload, path);

  if (user.status !== 'active') {
    invalid(`${path}.status`, "'active'", user.status);
  }

  return {
    userReference: requiredString(user.id, `${path}.id`),
    email: safeString(user.email, 320, `${path}.email`),
    did: nullableString(user.did, `${path}.did`),
    displayLabel: safeString(user.displayLabel, 300, `${path}.displayLabel`)
  };
}

export function adaptLoginResponse(payload: unknown): AdaptedLoginResponse {
  const response = record(payload, 'auth');

  return {
    accessToken: requiredString(response.accessToken, 'auth.accessToken'),
    user: adaptUser(response.user, 'auth.user')
  };
}

export function adaptCurrentUserResponse(payload: unknown): AuthUserVM {
  const response = record(payload, 'auth.me');

  if (!Array.isArray(response.issuerMemberships)) {
    invalid('auth.me.issuerMemberships', 'array', response.issuerMemberships);
  }

  return adaptUser(response, 'auth.me');
}
