interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StorageResolver = () => SessionStorageLike | null;

const ACCESS_TOKEN_KEY = 'traza.session.access-token';
const SELECTED_ISSUER_KEY = 'traza.session.selected-issuer';

export interface SessionStore {
  getAccessToken(): string | null;
  setAccessToken(accessToken: string): void;
  getSelectedIssuerReference(): string | null;
  setSelectedIssuerReference(issuerReference: string): void;
  clearSelectedIssuerReference(): void;
  clear(): void;
}

function resolveBrowserSessionStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export class BrowserSessionStore implements SessionStore {
  constructor(
    private readonly resolveStorage: StorageResolver =
      resolveBrowserSessionStorage
  ) {}

  getAccessToken() {
    return this.resolveStorage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
  }

  setAccessToken(accessToken: string) {
    this.resolveStorage()?.setItem(ACCESS_TOKEN_KEY, accessToken);
  }

  getSelectedIssuerReference() {
    return this.resolveStorage()?.getItem(SELECTED_ISSUER_KEY) ?? null;
  }

  setSelectedIssuerReference(issuerReference: string) {
    this.resolveStorage()?.setItem(SELECTED_ISSUER_KEY, issuerReference);
  }

  clearSelectedIssuerReference() {
    this.resolveStorage()?.removeItem(SELECTED_ISSUER_KEY);
  }

  clear() {
    const storage = this.resolveStorage();
    storage?.removeItem(ACCESS_TOKEN_KEY);
    storage?.removeItem(SELECTED_ISSUER_KEY);
  }
}
