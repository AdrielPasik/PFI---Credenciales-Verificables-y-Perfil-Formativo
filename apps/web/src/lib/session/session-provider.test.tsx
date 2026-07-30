import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';
import {
  SessionProvider,
  useSession
} from '@/lib/session/session-provider';
import type { SessionStore } from '@/lib/session/session-store';

const authApiMocks = vi.hoisted(() => ({
  currentUserRequest: vi.fn(),
  loginRequest: vi.fn()
}));

vi.mock('@/lib/api/auth-api', () => authApiMocks);

class MemorySessionStore implements SessionStore {
  constructor(
    private accessToken: string | null = null,
    private selectedIssuerReference: string | null = null
  ) {}

  getAccessToken() {
    return this.accessToken;
  }

  setAccessToken(accessToken: string) {
    this.accessToken = accessToken;
  }

  getSelectedIssuerReference() {
    return this.selectedIssuerReference;
  }

  setSelectedIssuerReference(issuerReference: string) {
    this.selectedIssuerReference = issuerReference;
  }

  clearSelectedIssuerReference() {
    this.selectedIssuerReference = null;
  }

  clear() {
    this.accessToken = null;
    this.selectedIssuerReference = null;
  }
}

const operationalMembership = {
  issuerId: 'issuer-1',
  issuerName: 'Institución Uno',
  issuerDid: null,
  issuerAuthorizationStatus: 'authorized',
  role: 'admin',
  status: 'active'
};

const currentUserResponse = {
  id: 'user-reference',
  email: 'persona@example.com',
  did: null,
  status: 'active',
  issuerMemberships: [operationalMembership]
};

function SessionObserver() {
  const session = useSession();
  const selectedIssuer =
    session.state.status === 'authenticated'
      ? session.state.issuerContext.selectedIssuer?.issuerReference ?? 'none'
      : 'none';

  return (
    <>
      <output data-testid="session-status">{session.state.status}</output>
      <output data-testid="selected-issuer">{selectedIssuer}</output>
      <button
        type="button"
        onClick={() =>
          void session.login({
            email: 'persona@example.com',
            password: '[REDACTED]'
          })
        }
      >
        Login
      </button>
      <button type="button" onClick={session.logout}>
        Logout
      </button>
      <button
        type="button"
        onClick={() => session.selectIssuer('issuer-2')}
      >
        Select valid
      </button>
      <button
        type="button"
        onClick={() => session.selectIssuer('issuer-unknown')}
      >
        Select invalid
      </button>
    </>
  );
}

function renderProvider(store: SessionStore) {
  return render(
    <SessionProvider store={store}>
      <SessionObserver />
    </SessionProvider>
  );
}

describe('SessionProvider', () => {
  beforeEach(() => {
    authApiMocks.currentUserRequest.mockReset();
    authApiMocks.loginRequest.mockReset();
  });

  it('finishes unauthenticated when there is no initial token', async () => {
    renderProvider(new MemorySessionStore());

    await waitFor(() => {
      expect(screen.getByTestId('session-status').textContent).toBe(
        'unauthenticated'
      );
    });
    expect(authApiMocks.currentUserRequest).not.toHaveBeenCalled();
  });

  it('rehydrates a token through /auth/me and becomes authenticated', async () => {
    const store = new MemorySessionStore('[REDACTED]');
    authApiMocks.currentUserRequest.mockResolvedValue(currentUserResponse);

    renderProvider(store);

    await waitFor(() => {
      expect(screen.getByTestId('session-status').textContent).toBe(
        'authenticated'
      );
    });
    expect(authApiMocks.currentUserRequest).toHaveBeenCalledWith(
      '[REDACTED]'
    );
  });

  it('stores a successful login token and validates it through /auth/me', async () => {
    const store = new MemorySessionStore();
    authApiMocks.loginRequest.mockResolvedValue({
      accessToken: '[REDACTED]',
      user: {
        id: 'user-reference',
        email: 'persona@example.com',
        did: null,
        status: 'active'
      }
    });
    authApiMocks.currentUserRequest.mockResolvedValue(currentUserResponse);

    renderProvider(store);
    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe(
        'unauthenticated'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByTestId('session-status').textContent).toBe(
        'authenticated'
      );
    });
    expect(store.getAccessToken()).toBe('[REDACTED]');
    expect(authApiMocks.currentUserRequest).toHaveBeenCalledWith(
      '[REDACTED]'
    );
  });

  it('clears token and issuer selection when /auth/me returns 401', async () => {
    const store = new MemorySessionStore('[REDACTED]', 'issuer-1');
    authApiMocks.currentUserRequest.mockRejectedValue(
      new ApiError('unauthorized', 'http', 401)
    );

    renderProvider(store);

    await waitFor(() => {
      expect(screen.getByTestId('session-status').textContent).toBe(
        'expired'
      );
    });
    expect(store.getAccessToken()).toBeNull();
    expect(store.getSelectedIssuerReference()).toBeNull();
  });

  it('keeps the token after a network failure and exposes a recoverable error', async () => {
    const store = new MemorySessionStore('[REDACTED]');
    authApiMocks.currentUserRequest.mockRejectedValue(
      new ApiError('network detail', 'network')
    );

    renderProvider(store);

    await waitFor(() => {
      expect(screen.getByTestId('session-status').textContent).toBe(
        'recoverable-error'
      );
    });
    expect(store.getAccessToken()).toBe('[REDACTED]');
  });

  it('logout clears token, issuer selection and in-memory state', async () => {
    const store = new MemorySessionStore('[REDACTED]', 'issuer-1');
    authApiMocks.currentUserRequest.mockResolvedValue(currentUserResponse);

    renderProvider(store);
    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe(
        'authenticated'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(screen.getByTestId('session-status').textContent).toBe(
      'unauthenticated'
    );
    expect(store.getAccessToken()).toBeNull();
    expect(store.getSelectedIssuerReference()).toBeNull();
  });

  it('persists only a valid issuer selection', async () => {
    const store = new MemorySessionStore('[REDACTED]');
    authApiMocks.currentUserRequest.mockResolvedValue({
      ...currentUserResponse,
      issuerMemberships: [
        operationalMembership,
        {
          ...operationalMembership,
          issuerId: 'issuer-2',
          issuerName: 'Institución Dos',
          role: 'operator'
        }
      ]
    });

    renderProvider(store);
    await waitFor(() =>
      expect(screen.getByTestId('session-status').textContent).toBe(
        'authenticated'
      )
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select invalid' })
    );
    expect(store.getSelectedIssuerReference()).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select valid' })
    );
    expect(store.getSelectedIssuerReference()).toBe('issuer-2');
    expect(screen.getByTestId('selected-issuer').textContent).toBe(
      'issuer-2'
    );
  });
});
