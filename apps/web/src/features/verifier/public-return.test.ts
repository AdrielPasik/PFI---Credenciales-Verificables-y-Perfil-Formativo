import { describe, expect, it } from 'vitest';

import {
  buildCredentialVerifyHref,
  buildProfileReturnPath,
  parsePublicReturn
} from '@/features/verifier/analysis-return';

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('regreso desde la verificacion publica', () => {
  it('acepta el perfil compartido y su analisis, cada uno con su etiqueta', () => {
    expect(parsePublicReturn(`/share/profile/${TOKEN}`)).toEqual({
      path: `/share/profile/${TOKEN}`,
      label: 'Volver al perfil compartido'
    });
    expect(parsePublicReturn(`/share/profile/${TOKEN}/analysis`)).toEqual({
      path: `/share/profile/${TOKEN}/analysis`,
      label: 'Volver al análisis'
    });
  });

  it.each([
    ['URL absoluta', `https://evil.example/share/profile/${TOKEN}`],
    ['protocol-relative', `//evil.example/share/profile/${TOKEN}`],
    ['query extra', `/share/profile/${TOKEN}?next=/admin`],
    ['fragmento', `/share/profile/${TOKEN}#x`],
    ['traversal', `/share/profile/${TOKEN}/../../admin`],
    ['barra invertida', `/share/profile/${TOKEN}\\admin`],
    ['token corto', '/share/profile/abc'],
    ['otra ruta interna', '/wallet'],
    ['vacio', '']
  ])('rechaza %s', (_label, raw) => {
    expect(parsePublicReturn(raw)).toBeNull();
  });

  it('el enlace "Ver credencial" del perfil compartido lleva el regreso al perfil', () => {
    expect(buildCredentialVerifyHref('cred-1', buildProfileReturnPath(TOKEN))).toBe(
      `/verify?credential=cred-1&returnTo=%2Fshare%2Fprofile%2F${TOKEN}`
    );
  });

  it('un token fuera del alfabeto no produce regreso', () => {
    expect(buildProfileReturnPath('no/valido')).toBeNull();
    expect(buildCredentialVerifyHref('cred-1', buildProfileReturnPath('no/valido'))).toBe(
      '/verify?credential=cred-1'
    );
  });
});
