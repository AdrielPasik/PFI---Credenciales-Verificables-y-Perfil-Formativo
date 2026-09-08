import {
  AppConfigError,
  parseBaseUrl,
  readAppConfig,
  resolveAppConfig
} from '@/lib/config/app-config';

describe('parseBaseUrl', () => {
  it('normaliza quitando la barra final', () => {
    expect(parseBaseUrl('https://api.scope.test/', 'X')).toBe(
      'https://api.scope.test'
    );
  });

  it('acepta http para desarrollo local y LAN', () => {
    expect(parseBaseUrl('http://10.0.2.2:3001', 'X')).toBe(
      'http://10.0.2.2:3001'
    );
    expect(parseBaseUrl('http://192.168.0.10:3001', 'X')).toBe(
      'http://192.168.0.10:3001'
    );
  });

  it.each([
    ['', 'es requerida.'],
    ['   ', 'es requerida.'],
    ['no-es-una-url', 'debe ser una URL válida.'],
    ['ftp://api.scope.test', 'debe usar protocolo HTTP o HTTPS.'],
    ['https://user:pass@api.scope.test', 'no debe incluir credenciales, query ni fragmento.'],
    ['https://api.scope.test?token=1', 'no debe incluir credenciales, query ni fragmento.'],
    ['https://api.scope.test#x', 'no debe incluir credenciales, query ni fragmento.']
  ])('rechaza %s', (value, reason) => {
    expect(() => parseBaseUrl(value, 'EXPO_PUBLIC_API_BASE_URL')).toThrow(
      reason
    );
  });

  it('rechaza el valor ausente', () => {
    expect(() => parseBaseUrl(undefined, 'X')).toThrow(AppConfigError);
  });
});

describe('readAppConfig', () => {
  it('exige las dos URLs', () => {
    expect(() =>
      readAppConfig({ EXPO_PUBLIC_API_BASE_URL: 'https://api.scope.test' })
    ).toThrow('EXPO_PUBLIC_WEB_BASE_URL');
  });

  it('devuelve ambas bases normalizadas', () => {
    expect(
      readAppConfig({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.scope.test/',
        EXPO_PUBLIC_WEB_BASE_URL: 'https://scope.test/'
      })
    ).toEqual({
      apiBaseUrl: 'https://api.scope.test',
      webBaseUrl: 'https://scope.test'
    });
  });
});

describe('resolveAppConfig', () => {
  it('nunca cae en silencio a localhost cuando falta configuración', () => {
    const result = resolveAppConfig({});

    expect(result.status).toBe('misconfigured');
    if (result.status === 'misconfigured') {
      expect(result.error.variableName).toBe('EXPO_PUBLIC_API_BASE_URL');
    }
  });

  it('informa configuración lista cuando ambas variables son válidas', () => {
    const result = resolveAppConfig({
      EXPO_PUBLIC_API_BASE_URL: 'https://api.scope.test',
      EXPO_PUBLIC_WEB_BASE_URL: 'https://scope.test'
    });

    expect(result.status).toBe('ready');
  });
});
