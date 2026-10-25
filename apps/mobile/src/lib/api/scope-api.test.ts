import {
  createProfileShareRequest,
  getShareVerificationPolicyRequest,
  listMyProfileSharesRequest,
  recoverProfileShareLinkRequest,
  revokeProfileShareRequest,
  currentUserRequest,
  getMyCredentialRequest,
  getMyCredentialsRequest,
  getMyCurrentProfileRequest,
  InvalidCredentialReferenceError,
  loginRequest,
  registerRequest,
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
  it('gestiona enlaces de perfil sin recuperar tokens al listar', async () => {
    const { request, calls } = authenticatedRequestReturning([
      {
        shareId: 'share-1', scope: 'profile', status: 'ACTIVE', createdAt: '2026-10-25T10:00:00Z',
        expiresAt: null, revokedAt: null, lastUsedAt: null,
        contextualVerificationEnabled: false, authorizedCredentialCount: 0,
        effectiveAuthorizedCredentialCount: 0
      }
    ]);

    const shares = await listMyProfileSharesRequest(request);
    expect(calls[0]).toEqual({ path: '/me/profile/shares', method: undefined });
    expect(shares[0]?.status).toBe('ACTIVE');
  });

  it('recupera y revoca un enlace sólo por su endpoint autenticado específico', async () => {
    const { request, calls } = authenticatedRequestReturning({
      sharePath: `/share/profile/${'a'.repeat(43)}`, shareUrl: null
    });

    await recoverProfileShareLinkRequest(request, 'share/id');
    expect(calls[0]).toEqual({ path: '/me/profile/shares/share%2Fid/link', method: 'POST' });

    await revokeProfileShareRequest(request, 'share/id');
    expect(calls[1]).toEqual({ path: '/me/profile/shares/share%2Fid/revoke', method: 'POST' });
  });

  it('lee la política persistida antes de reemplazarla y valida el contrato', async () => {
    const { request, calls } = authenticatedRequestReturning({
      configured: true, enabled: true, policyVersion: 2,
      authorizedCredentialIds: ['cred-1'], effectiveAuthorizedCredentialIds: ['cred-1'],
      updatedAt: '2026-10-25T10:00:00Z'
    });

    const policy = await getShareVerificationPolicyRequest(request, 'share/id');

    expect(calls[0]).toEqual({
      path: '/me/profile/shares/share%2Fid/verification-policy', method: undefined
    });
    expect(policy.authorizedCredentialIds).toEqual(['cred-1']);
  });

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

  it('POST /auth/register usa sólo el contrato público y adapta la sesión', async () => {
    const { client, calls } = createTestHttpClient({ body: loginResponsePayload() });

    const response = await registerRequest(client, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'secreto8'
    });

    expect(calls[0]?.url).toBe('https://api.scope.test/auth/register');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe(
      JSON.stringify({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        password: 'secreto8'
      })
    );
    expect(response.user.displayLabel).toBe('Ada Lovelace');
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
