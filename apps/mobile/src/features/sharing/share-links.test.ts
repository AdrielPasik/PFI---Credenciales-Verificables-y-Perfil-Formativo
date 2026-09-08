import {
  buildCredentialShareMessage,
  buildCredentialVerificationUrl,
  buildProfileShareMessage,
  buildProfileShareUrl,
  isSafeExternalUrl
} from '@/features/sharing/share-links';

describe('enlaces públicos', () => {
  it('compone el enlace de perfil con la ruta opaca del backend', () => {
    expect(
      buildProfileShareUrl('https://scope.test', '/share/profile/abc123')
    ).toBe('https://scope.test/share/profile/abc123');
  });

  it('compone el enlace de credencial con la vista pública de verificación', () => {
    expect(
      buildCredentialVerificationUrl('https://scope.test', 'cred-001')
    ).toBe('https://scope.test/verify?credential=cred-001');
  });

  it('codifica la referencia de credencial', () => {
    expect(
      buildCredentialVerificationUrl('https://scope.test', 'cred/001&x=1')
    ).toBe('https://scope.test/verify?credential=cred%2F001%26x%3D1');
  });

  it('respeta la base web configurada, sin adivinar un dominio', () => {
    expect(
      buildProfileShareUrl('http://192.168.0.10:3000', '/share/profile/abc')
    ).toBe('http://192.168.0.10:3000/share/profile/abc');
  });
});

describe('mensajes del share sheet', () => {
  it('el mensaje de perfil es breve y sólo contiene el enlace público', () => {
    const message = buildProfileShareMessage(
      'https://scope.test/share/profile/abc'
    );

    expect(message).toBe(
      'Mi perfil formativo en Scope: https://scope.test/share/profile/abc'
    );
    expect(message).not.toMatch(/@/);
  });

  it('el mensaje de credencial nombra la credencial y su enlace', () => {
    expect(
      buildCredentialShareMessage(
        'Sistemas Operativos',
        'https://scope.test/verify?credential=cred-001'
      )
    ).toBe(
      'Credencial "Sistemas Operativos" en Scope: https://scope.test/verify?credential=cred-001'
    );
  });
});

describe('isSafeExternalUrl', () => {
  it.each(['https://scope.test/x', 'http://192.168.0.10:3000/y'])(
    'acepta %s',
    (value) => {
      expect(isSafeExternalUrl(value)).toBe(true);
    }
  );

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'no-es-una-url',
    ''
  ])('rechaza %s', (value) => {
    expect(isSafeExternalUrl(value)).toBe(false);
  });
});
