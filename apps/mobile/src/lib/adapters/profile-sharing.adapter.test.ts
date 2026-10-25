import {
  adaptProfileShareSummaries,
  adaptRecoveredProfileShareLink,
  adaptShareVerificationPolicy
} from '@/lib/adapters/profile-sharing.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const TOKEN = 'a'.repeat(43);

describe('profile sharing adapter', () => {
  it('adapta enlaces sin exponer tokens en el listado', () => {
    const shares = adaptProfileShareSummaries([
      {
        shareId: 'share-1', scope: 'profile', status: 'ACTIVE', createdAt: '2026-10-25T10:00:00Z',
        expiresAt: null, revokedAt: null, lastUsedAt: null,
        contextualVerificationEnabled: false, authorizedCredentialCount: 0,
        effectiveAuthorizedCredentialCount: 0
      },
      {
        shareId: 'share-2', scope: 'credential', status: 'REVOKED', createdAt: '2026-10-20T10:00:00Z',
        expiresAt: null, revokedAt: '2026-10-21T10:00:00Z', lastUsedAt: '2026-10-20T11:00:00Z',
        contextualVerificationEnabled: false, authorizedCredentialCount: 0,
        effectiveAuthorizedCredentialCount: 0
      }
    ]);

    expect(shares.map((share) => share.statusLabel)).toEqual(['Activo', 'Revocado']);
    expect(shares.map((share) => share.supportsContextualVerification)).toEqual([true, false]);
    expect(JSON.stringify(shares)).not.toContain(TOKEN);
  });

  it('rechaza estados desconocidos y datos inválidos', () => {
    expect(() => adaptProfileShareSummaries([{ shareId: 'x', status: 'UNKNOWN' }]))
      .toThrow(IncompatiblePayloadError);
  });

  it('rechaza scopes desconocidos para no ofrecer una capacidad no autorizada', () => {
    expect(() => adaptProfileShareSummaries([{
      shareId: 'x', scope: 'other', status: 'ACTIVE', createdAt: '2026-10-25T10:00:00Z',
      expiresAt: null, revokedAt: null, lastUsedAt: null
    }])).toThrow(IncompatiblePayloadError);
  });

  it('acepta un enlace recuperado sólo cuando su ruta opaca es válida', () => {
    expect(adaptRecoveredProfileShareLink({
      sharePath: `/share/profile/${TOKEN}`,
      shareUrl: null
    })).toEqual({ sharePath: `/share/profile/${TOKEN}`, shareUrl: null });
    expect(() => adaptRecoveredProfileShareLink({ sharePath: 'https://evil.test', shareUrl: null }))
      .toThrow(IncompatiblePayloadError);
  });

  it('distingue una política sin configurar de una selección vacía guardada', () => {
    expect(adaptShareVerificationPolicy({
      configured: false, enabled: false, policyVersion: 0,
      authorizedCredentialIds: [], effectiveAuthorizedCredentialIds: [], updatedAt: null
    })).toMatchObject({ configured: false, policyVersion: 0 });
    expect(adaptShareVerificationPolicy({
      configured: true, enabled: false, policyVersion: 1,
      authorizedCredentialIds: [], effectiveAuthorizedCredentialIds: [], updatedAt: '2026-10-25T10:00:00Z'
    })).toMatchObject({ configured: true, policyVersion: 1 });
  });

  it('rechaza una política de lectura sin el discriminante configurado', () => {
    expect(() => adaptShareVerificationPolicy({
      enabled: false, policyVersion: 0, authorizedCredentialIds: [],
      effectiveAuthorizedCredentialIds: [], updatedAt: null
    })).toThrow(IncompatiblePayloadError);
  });
});
