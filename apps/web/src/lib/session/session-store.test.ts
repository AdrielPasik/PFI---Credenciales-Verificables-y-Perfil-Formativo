import { describe, expect, it } from 'vitest';

import { BrowserSessionStore } from '@/lib/session/session-store';

function createMemoryStorage() {
  const entries = new Map<string, string>();

  return {
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
    removeItem(key: string) {
      entries.delete(key);
    }
  };
}

describe('BrowserSessionStore', () => {
  it('stores and retrieves only the access token and issuer reference', () => {
    const storage = createMemoryStorage();
    const store = new BrowserSessionStore(() => storage);

    store.setAccessToken('[REDACTED]');
    store.setSelectedIssuerReference('issuer-reference');

    expect(store.getAccessToken()).toBe('[REDACTED]');
    expect(store.getSelectedIssuerReference()).toBe('issuer-reference');
  });

  it('clears only the selected issuer when requested', () => {
    const storage = createMemoryStorage();
    const store = new BrowserSessionStore(() => storage);

    store.setAccessToken('[REDACTED]');
    store.setSelectedIssuerReference('issuer-reference');
    store.clearSelectedIssuerReference();

    expect(store.getAccessToken()).toBe('[REDACTED]');
    expect(store.getSelectedIssuerReference()).toBeNull();
  });

  it('clears the complete demo session', () => {
    const storage = createMemoryStorage();
    const store = new BrowserSessionStore(() => storage);

    store.setAccessToken('[REDACTED]');
    store.setSelectedIssuerReference('issuer-reference');
    store.clear();

    expect(store.getAccessToken()).toBeNull();
    expect(store.getSelectedIssuerReference()).toBeNull();
  });

  it('is safe when browser storage is unavailable', () => {
    const store = new BrowserSessionStore(() => null);

    expect(() => {
      store.setAccessToken('[REDACTED]');
      store.setSelectedIssuerReference('issuer-reference');
      store.clearSelectedIssuerReference();
      store.clear();
    }).not.toThrow();
    expect(store.getAccessToken()).toBeNull();
    expect(store.getSelectedIssuerReference()).toBeNull();
  });
});
