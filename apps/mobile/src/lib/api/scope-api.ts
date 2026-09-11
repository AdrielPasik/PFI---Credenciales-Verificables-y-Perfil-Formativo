import {
  adaptCurrentUserResponse,
  adaptLoginResponse,
  type AdaptedLoginResponse
} from '@/lib/adapters/auth.adapter';
import {
  adaptMyCredential,
  adaptMyCredentials,
  adaptMyCurrentProfile
} from '@/lib/adapters/holder.adapter';
import { adaptProfileShareLink } from '@/lib/adapters/profile-sharing.adapter';
import {
  AUTH_TIMEOUT_MS,
  type AuthenticatedRequest,
  type HttpClient
} from '@/lib/api/http-client';
import type { AuthUserVM } from '@/types/auth';
import type {
  HolderCredentialDetailVM,
  HolderCredentialListItemVM,
  HolderProfileVM
} from '@/types/holder';
import type { ProfileShareLinkVM } from '@/types/sharing';

/**
 * Inventario completo de endpoints que consume la app móvil.
 *
 * Cada función devuelve un modelo YA adaptado: la capa de arriba nunca ve un
 * payload crudo. Ver `04-api-y-contratos.md` para el detalle de cada uno.
 *
 * No existe `/mobile/*`: la app consume exactamente los mismos endpoints que
 * Holder Web.
 */

export interface LoginCommand {
  email: string;
  password: string;
}

export interface RegisterCommand {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/** POST /auth/login (público). */
export async function loginRequest(
  client: HttpClient,
  command: LoginCommand
): Promise<AdaptedLoginResponse> {
  return adaptLoginResponse(
    await client.request('/auth/login', {
      method: 'POST',
      body: command,
      timeoutMs: AUTH_TIMEOUT_MS
    })
  );
}

/** POST /auth/register (público, 201 y mismo response que login). */
export async function registerRequest(
  client: HttpClient,
  command: RegisterCommand
): Promise<AdaptedLoginResponse> {
  return adaptLoginResponse(
    await client.request('/auth/register', {
      method: 'POST',
      body: command,
      timeoutMs: AUTH_TIMEOUT_MS
    })
  );
}

/** GET /auth/me (Bearer). Resuelve la sesión al arrancar la app. */
export async function currentUserRequest(
  client: HttpClient,
  accessToken: string
): Promise<AuthUserVM> {
  return adaptCurrentUserResponse(
    await client.request('/auth/me', {
      token: accessToken,
      timeoutMs: AUTH_TIMEOUT_MS
    })
  );
}

/** GET /me/credentials */
export async function getMyCredentialsRequest(
  request: AuthenticatedRequest
): Promise<HolderCredentialListItemVM[]> {
  return adaptMyCredentials(await request('/me/credentials'));
}

/** GET /me/credentials/:id */
export async function getMyCredentialRequest(
  request: AuthenticatedRequest,
  credentialReference: string
): Promise<HolderCredentialDetailVM> {
  const reference = credentialReference.trim();

  if (!reference) {
    throw new InvalidCredentialReferenceError();
  }

  return adaptMyCredential(
    await request(`/me/credentials/${encodeURIComponent(reference)}`)
  );
}

/** GET /me/profile/current. `null` = todavía no hay perfil (no es error). */
export async function getMyCurrentProfileRequest(
  request: AuthenticatedRequest
): Promise<HolderProfileVM | null> {
  return adaptMyCurrentProfile(await request('/me/profile/current'));
}

/**
 * POST /me/profile/rebuild
 *
 * Recompone la proyección del perfil desde las credenciales emitidas y la
 * semántica YA disponible. Es determinístico: NUNCA ejecuta IA. Devuelve el
 * mismo shape que `/me/profile/current`, por eso reusa el mismo adapter.
 */
export async function rebuildMyProfileRequest(
  request: AuthenticatedRequest
): Promise<HolderProfileVM | null> {
  return adaptMyCurrentProfile(
    await request('/me/profile/rebuild', { method: 'POST' })
  );
}

/** POST /me/profile/share. Devuelve una ruta pública opaca. */
export async function createProfileShareRequest(
  request: AuthenticatedRequest
): Promise<ProfileShareLinkVM> {
  return adaptProfileShareLink(
    await request('/me/profile/share', { method: 'POST' })
  );
}

export class InvalidCredentialReferenceError extends Error {
  constructor() {
    super('La referencia de credencial no es válida.');
    this.name = 'InvalidCredentialReferenceError';
  }
}
