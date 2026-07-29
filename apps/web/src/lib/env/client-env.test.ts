import { describe, expect, it } from 'vitest';

import { parseApiBaseUrl } from './client-env';

describe('parseApiBaseUrl', () => {
  it('normalizes a valid HTTP or HTTPS URL', () => {
    expect(parseApiBaseUrl('  http://127.0.0.1:3001/  ')).toBe(
      'http://127.0.0.1:3001'
    );
    expect(parseApiBaseUrl('https://api.traza.example/v1')).toBe(
      'https://api.traza.example/v1'
    );
  });

  it('rejects a missing value', () => {
    expect(() => parseApiBaseUrl(undefined)).toThrow(
      'NEXT_PUBLIC_API_BASE_URL es requerida.'
    );
  });

  it('rejects an invalid URL', () => {
    expect(() => parseApiBaseUrl('not-a-url')).toThrow(
      'NEXT_PUBLIC_API_BASE_URL debe ser una URL válida.'
    );
  });

  it('rejects protocols other than HTTP or HTTPS', () => {
    expect(() => parseApiBaseUrl('ftp://files.example.com')).toThrow(
      'NEXT_PUBLIC_API_BASE_URL debe usar protocolo HTTP o HTTPS.'
    );
  });
});
