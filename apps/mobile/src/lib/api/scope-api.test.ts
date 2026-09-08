import {
  createProfileShareRequest,
  currentUserRequest,
  getMyCredentialRequest,
  getMyCredentialsRequest,
  getMyCurrentProfileRequest,
  InvalidCredentialReferenceError,
  loginRequest,
  rebuildMyProfileRequest
} from '@/lib/api/scope-api';
import type { AuthenticatedRequest } from '@/lib/api/http-client';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  credentialDetailPayload,
  credentialListPayload,
  currentProfilePayload,
  currentUserPayload,
  loginResponsePayload,
  profileSharePayload
} from '@/test/fixtures';
import { createTestHttpClient } from '@/test/http';

function authenticatedRequestReturning(payload: unknown) {
  const calls: { path: string; method?: string }[] = [];

  const request: AuthenticatedRequest = async (path, options) => {
    calls.push({ path, method: options?.method });
    return payload;
  };

  return { request, calls };
}

describe('inventario de endpoints consumidos por la app', () => {
  it('POST /auth/login devuelve token y usuario adaptados', async () => {
    const { client, calls } = createTestHttpClient({
      body: loginResponsePayload()
    });

    const response = await loginRequest(client, {
      email: 'titular@example.com',
      password: 'secreto'
    });

    expect(calls[0]?.url).toBe('https://api.scope.test/auth/login');
    expect(calls[0]?.method).toBe('POST');
    expect(response.accessToken).toBe('header.payload.signature');
    expect(response.user.displayLabel).toBe('Ada Lovelace');
  });

  it('la petición de login nunca deja la contraseña en el modelo devuelto', async () => {
    const { client } = createTestHttpClient({ body: loginResponsePayload() });

    const response = await loginRequest(client, {
      email: 'titular@example.com',
      password: 'secreto'
    });

    expect(JSON.stringify(response)).not.toContain('secreto');
  });

  it('GET /auth/me exige el token y adapta el usuario', async () => {
    const { client, calls } = createTestHttpClient({
      body: currentUserPayload()
    });

    const user = await currentUserRequest(client, 'jwt-1');

    expect(calls[0]?.url).toBe('https://api.scope.test/auth/me');
    expect(calls[0]?.headers.Authorization).toBe('Bearer jwt-1');
    expect(user.email).toBe('titular@example.com');
  });

  it('GET /auth/me ignora las membresías de emisor (app holder-only)', async () => {
    const { client } = createTestHttpClient({
      body: currentUserPayload({
        issuerMemberships: [
          {
            issuerId: 'issuer-1',
            issuerName: 'Universidad Ejemplo',
            issuerDid: null,
            issuerAuthorizationStatus: 'authorized',
            role: 'admin',
            status: 'active'
          }
        ]
      })
    });

    const user = await currentUserRequest(client, 'jwt-1');

    expect(Object.keys(user)).toEqual([
      'userReference',
      'email',
      'did',
      'displayLabel'
    ]);
    expect(JSON.stringify(user)).not.toContain('issuer');
  });

  it('rechaza un usuario que no esté activo', async () => {
    const { client } = createTestHttpClient({
      body: currentUserPayload({ status: 'suspended' })
    });

    await expect(currentUserRequest(client, 'jwt-1')).rejects.toBeInstanceOf(
      IncompatiblePayloadError
    );
  });

  it('GET /me/credentials adapta la lista', async () => {
    const { request, calls } = authenticatedRequestReturning(
      credentialListPayload()
    );

    const credentials = await getMyCredentialsRequest(request);

    expect(calls[0]?.path).toBe('/me/credentials');
    expect(credentials).toHaveLength(4);
  });

  it('GET /me/credentials/:id codifica la referencia en la URL', async () => {
    const { request, calls } = authenticatedRequestReturning(
      credentialDetailPayload()
    );

    await getMyCredentialRequest(request, 'cred/001 con espacio');

    expect(calls[0]?.path).toBe(
      '/me/credentials/cred%2F001%20con%20espacio'
    );
  });

  it('rechaza una referencia de credencial vacía sin llamar al backend', async () => {
    const { request, calls } = authenticatedRequestReturning(null);

    await expect(getMyCredentialRequest(request, '   ')).rejects.toBeInstanceOf(
      InvalidCredentialReferenceError
    );
    expect(calls).toHaveLength(0);
  });

  it('GET /me/profile/current adapta el perfil', async () => {
    const { request, calls } = authenticatedRequestReturning(
      currentProfilePayload()
    );

    const profile = await getMyCurrentProfileRequest(request);

    expect(calls[0]?.path).toBe('/me/profile/current');
    expect(profile?.credentialsCount).toBe(4);
  });

  it('POST /me/profile/rebuild reusa el mismo contrato que el perfil actual', async () => {
    const { request, calls } = authenticatedRequestReturning(
      currentProfilePayload()
    );

    const profile = await rebuildMyProfileRequest(request);

    expect(calls[0]).toEqual({ path: '/me/profile/rebuild', method: 'POST' });
    expect(profile?.profileVersion).toBe('formative_profile_v1');
  });

  it('POST /me/profile/share devuelve una ruta opaca, no una URL absoluta', async () => {
    const { request, calls } = authenticatedRequestReturning(
      profileSharePayload()
    );

    const link = await createProfileShareRequest(request);

    expect(calls[0]).toEqual({ path: '/me/profile/share', method: 'POST' });
    expect(link.sharePath.startsWith('/share/profile/')).toBe(true);
    expect(link.sharePath).not.toContain('http');
    expect(link.expiresAtLabel).not.toBeNull();
  });

  it('rechaza un sharePath que no tenga la forma esperada', async () => {
    const { request } = authenticatedRequestReturning(
      profileSharePayload({ sharePath: 'https://malicioso.example.org/x' })
    );

    await expect(createProfileShareRequest(request)).rejects.toBeInstanceOf(
      IncompatiblePayloadError
    );
  });

  it('acepta un enlace de perfil sin fecha de expiración', async () => {
    const { request } = authenticatedRequestReturning(
      profileSharePayload({ expiresAt: null })
    );

    const link = await createProfileShareRequest(request);

    expect(link.expiresAtLabel).toBeNull();
  });
});
