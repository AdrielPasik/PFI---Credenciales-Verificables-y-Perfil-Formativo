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
        displayLabel: 'Persona Demo',
        // S3: el modelo de sesión ahora representa la capacidad de plataforma.
        // `false` porque este payload no trae `platformAdmin` — el caso
        // fail-closed que cubren los tests de abajo.
        isPlatformAdmin: false,
        // O1: `null` porque este payload no trae `onboardingIntent` — el caso
        // fail-safe de una cuenta anterior a O1 o de un API anterior a O1.
        onboardingIntent: null
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
  // -------------------------------------------------------------------------
  // S3: capacidad de plataforma
  // -------------------------------------------------------------------------

  it('maps platformAdmin=true to isPlatformAdmin', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      platformAdmin: true,
      issuerMemberships: []
    });

    expect(adapted.currentUser.isPlatformAdmin).toBe(true);
  });

  it('maps platformAdmin=false to isPlatformAdmin=false', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      platformAdmin: false,
      issuerMemberships: []
    });

    expect(adapted.currentUser.isPlatformAdmin).toBe(false);
  });

  it('defaults isPlatformAdmin to false when the field is absent', () => {
    // Un API anterior a S3 no manda el campo.
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      issuerMemberships: []
    });

    expect(adapted.currentUser.isPlatformAdmin).toBe(false);
  });

  it('does not turn a missing platformAdmin into an incompatible payload', () => {
    // La sesion sigue siendo valida: el resto del usuario se adapta igual.
    expect(() =>
      adaptCurrentUserResponse({ ...activeUser, issuerMemberships: [] })
    ).not.toThrow();

    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      issuerMemberships: []
    });
    expect(adapted.currentUser.email).toBe('persona@example.com');
    expect(adapted.currentUser.displayLabel).toBe('Persona Demo');
  });

  it('is fail-closed against truthy non-boolean values', () => {
    for (const value of ['true', 1, {}, [], 'admin', null]) {
      const adapted = adaptCurrentUserResponse({
        ...activeUser,
        platformAdmin: value,
        issuerMemberships: []
      });

      expect(adapted.currentUser.isPlatformAdmin).toBe(false);
    }
  });

  it('never leaks PlatformAdmin internals into the session model', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      platformAdmin: true,
      issuerMemberships: []
    });

    expect(Object.keys(adapted.currentUser).sort()).toEqual([
      'did',
      'displayLabel',
      'email',
      'isPlatformAdmin',
      'onboardingIntent',
      'userReference'
    ]);
  });

  it('keeps the platform capability independent from issuer memberships', () => {
    // Un platform admin sin ninguna membership sigue sin contexto institucional.
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      platformAdmin: true,
      issuerMemberships: []
    });

    expect(adapted.currentUser.isPlatformAdmin).toBe(true);
    expect(adapted.issuerMemberships).toEqual([]);
  });
  // -------------------------------------------------------------------------
  // O1: intención de onboarding
  // -------------------------------------------------------------------------

  it('O1: maps personal to onboardingIntent', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      onboardingIntent: 'personal',
      issuerMemberships: []
    });

    expect(adapted.currentUser.onboardingIntent).toBe('personal');
  });

  it('O1: maps institutional to onboardingIntent', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      onboardingIntent: 'institutional',
      issuerMemberships: []
    });

    expect(adapted.currentUser.onboardingIntent).toBe('institutional');
  });

  it('O1: maps an explicit null to null', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      onboardingIntent: null,
      issuerMemberships: []
    });

    expect(adapted.currentUser.onboardingIntent).toBeNull();
  });

  it('O1: defaults to null when the field is absent, without breaking the session', () => {
    // Un API anterior a O1 no manda el campo. La sesión sigue siendo válida.
    expect(() =>
      adaptCurrentUserResponse({ ...activeUser, issuerMemberships: [] })
    ).not.toThrow();

    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      issuerMemberships: []
    });

    expect(adapted.currentUser.onboardingIntent).toBeNull();
    expect(adapted.currentUser.email).toBe('persona@example.com');
    expect(adapted.currentUser.displayLabel).toBe('Persona Demo');
  });

  it('O1: is fail-safe to null for unknown or malformed values', () => {
    // A diferencia de `role`/`status` de una membership, un valor desconocido
    // acá NO invalida la sesión: el campo no autoriza nada y la consecuencia
    // de leerlo mal es aterrizar en el espacio personal.
    for (const value of [
      'PERSONAL',
      'Institutional',
      'holder',
      'issuer',
      '',
      0,
      1,
      true,
      {},
      [],
      ['personal']
    ]) {
      const adapted = adaptCurrentUserResponse({
        ...activeUser,
        onboardingIntent: value,
        issuerMemberships: []
      });

      expect(adapted.currentUser.onboardingIntent).toBeNull();
    }
  });

  it('O1: the intent is independent from memberships and from the platform capability', () => {
    const adapted = adaptCurrentUserResponse({
      ...activeUser,
      onboardingIntent: 'institutional',
      platformAdmin: false,
      issuerMemberships: []
    });

    // Elegir "trabajar con una institución" no otorga NADA.
    expect(adapted.currentUser.onboardingIntent).toBe('institutional');
    expect(adapted.currentUser.isPlatformAdmin).toBe(false);
    expect(adapted.issuerMemberships).toEqual([]);
  });

  it('O1: login response never carries the intent', () => {
    // El flag vive solo en /auth/me. `adaptLoginResponse` produce un AuthUserVM.
    const adapted = adaptLoginResponse({
      accessToken: 'token',
      user: { ...activeUser, onboardingIntent: 'institutional' }
    });

    expect('onboardingIntent' in adapted.user).toBe(false);
  });
});
