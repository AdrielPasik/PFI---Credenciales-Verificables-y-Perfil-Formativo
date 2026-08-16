import { describe, expect, it } from 'vitest';

import {
  adaptCurrentUserResponse,
  adaptLoginResponse
} from '@/lib/adapters/auth.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

const activeUser = {
  id: 'user-internal-reference',
  email: 'persona@example.com',
  did: null,
  status: 'active',
  displayLabel: 'Persona Demo'
};

describe('auth adapters', () => {
  it('adapts a valid login response and discards unknown fields', () => {
    const response = adaptLoginResponse({
      accessToken: '[REDACTED]',
      user: {
        ...activeUser,
        passwordHash: 'must-not-leak',
        metadata: { internal: true }
      },
      debug: true
    });

    expect(response).toEqual({
      accessToken: '[REDACTED]',
      user: {
        userReference: 'user-internal-reference',
        email: 'persona@example.com',
        did: null,
        displayLabel: 'Persona Demo'
      }
    });
  });

  it('A1.1: rejects a login response missing displayLabel', () => {
    const { displayLabel: _displayLabel, ...userWithoutDisplayLabel } = activeUser;
    expect(() =>
      adaptLoginResponse({
        accessToken: '[REDACTED]',
        user: userWithoutDisplayLabel
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects a login response without an access token', () => {
    expect(() => adaptLoginResponse({ user: activeUser })).toThrow(
      IncompatiblePayloadError
    );
  });

  it('rejects an invalid login user', () => {
    expect(() =>
      adaptLoginResponse({
        accessToken: '[REDACTED]',
        user: { ...activeUser, status: 'suspended' }
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('adapts memberships, keeps nullable DIDs and discards extra fields', () => {
    const response = adaptCurrentUserResponse({
      ...activeUser,
      authCredential: { passwordHash: 'must-not-leak' },
      issuerMemberships: [
        {
          issuerId: 'issuer-internal-reference',
          issuerName: 'Institución Demo',
          issuerDid: null,
          issuerAuthorizationStatus: 'authorized',
          role: 'admin',
          status: 'active',
          walletAddress: 'must-not-leak',
          issuer: { metadata: 'must-not-leak' }
        }
      ]
    });

    expect(response).toEqual({
      currentUser: {
        userReference: 'user-internal-reference',
        email: 'persona@example.com',
        did: null,
        displayLabel: 'Persona Demo'
      },
      issuerMemberships: [
        {
          issuerReference: 'issuer-internal-reference',
          issuerName: 'Institución Demo',
          issuerDid: null,
          issuerAuthorizationStatus: 'authorized',
          issuerAuthorizationLabel: 'Autorizada',
          role: 'admin',
          roleLabel: 'Administrador',
          status: 'active',
          operational: true
        }
      ]
    });
  });

  it('rejects an unknown issuer authorization status', () => {
    expect(() =>
      adaptCurrentUserResponse({
        ...activeUser,
        issuerMemberships: [
          {
            issuerId: 'issuer-1',
            issuerName: 'Institución',
            issuerDid: null,
            issuerAuthorizationStatus: 'unknown',
            role: 'admin',
            status: 'active'
          }
        ]
      })
    ).toThrow(IncompatiblePayloadError);
  });

  it('rejects an unknown membership role', () => {
    expect(() =>
      adaptCurrentUserResponse({
        ...activeUser,
        issuerMemberships: [
          {
            issuerId: 'issuer-1',
            issuerName: 'Institución',
            issuerDid: null,
            issuerAuthorizationStatus: 'authorized',
            role: 'owner',
            status: 'active'
          }
        ]
      })
    ).toThrow(IncompatiblePayloadError);
  });
});
