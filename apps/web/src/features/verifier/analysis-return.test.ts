/**
 * `returnTo` acepta UNA forma: la ruta de un analisis publico. Nada mas.
 * Estos casos son la defensa contra el open redirect.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisReturnPath,
  buildCredentialVerifyHref,
  parseAnalysisReturnPath
} from './analysis-return';

const SHARE_TOKEN = 'AbC_d-EfGhIjKlMnOpQrStUvWxYz0123456789abcde';
const ANALYSIS_PATH = `/share/profile/${SHARE_TOKEN}/analysis`;

describe('parseAnalysisReturnPath', () => {
  it('acepta la ruta exacta de un analisis publico', () => {
    expect(parseAnalysisReturnPath(ANALYSIS_PATH)).toBe(ANALYSIS_PATH);
  });

  it.each([
    ['ausente', null],
    ['vacio', ''],
    ['URL absoluta externa', 'https://evil.example/share/profile/x/analysis'],
    ['URL absoluta a la misma ruta', `https://scope.example${ANALYSIS_PATH}`],
    ['protocol-relative', `//evil.example${ANALYSIS_PATH}`],
    ['protocol-relative corto', '//evil.example'],
    ['barra invertida', `/\\evil.example${ANALYSIS_PATH}`],
    ['javascript:', 'javascript:alert(1)'],
    ['relativa sin barra', `share/profile/${SHARE_TOKEN}/analysis`],
    ['otra ruta interna', '/wallet'],
    ['perfil sin analisis', `/share/profile/${SHARE_TOKEN}`],
    ['traversal', `/share/profile/${SHARE_TOKEN}/../../wallet/analysis`],
    ['traversal codificado', `/share/profile/%2e%2e/analysis`],
    ['con query', `${ANALYSIS_PATH}?next=//evil.example`],
    ['con fragmento', `${ANALYSIS_PATH}#x`],
    ['barra final', `${ANALYSIS_PATH}/`],
    ['token con caracteres ajenos', '/share/profile/abc<script>defghijklmno/analysis'],
    ['token demasiado corto', '/share/profile/abc/analysis'],
    ['salto de linea', `${ANALYSIS_PATH}\n`]
  ])('rechaza %s', (_caso, value) => {
    expect(parseAnalysisReturnPath(value)).toBeNull();
  });
});

describe('buildCredentialVerifyHref', () => {
  it('sin contexto es el enlace generico de siempre', () => {
    expect(buildCredentialVerifyHref('cred-1', null)).toBe('/verify?credential=cred-1');
  });

  it('desde un analisis lleva la ruta de regreso, y solo esa', () => {
    const href = buildCredentialVerifyHref('cred-1', ANALYSIS_PATH);
    const url = new URL(href, 'https://scope.example');

    expect(url.pathname).toBe('/verify');
    expect(url.searchParams.get('credential')).toBe('cred-1');
    expect(url.searchParams.get('returnTo')).toBe(ANALYSIS_PATH);
    expect([...url.searchParams.keys()].sort()).toEqual(['credential', 'returnTo']);
  });

  it('un regreso invalido se descarta en lugar de propagarse', () => {
    expect(buildCredentialVerifyHref('cred-1', 'https://evil.example')).toBe('/verify?credential=cred-1');
  });

  it('buildAnalysisReturnPath no fabrica una ruta con un token invalido', () => {
    expect(buildAnalysisReturnPath(SHARE_TOKEN)).toBe(ANALYSIS_PATH);
    expect(buildAnalysisReturnPath('../wallet')).toBeNull();
  });
});
