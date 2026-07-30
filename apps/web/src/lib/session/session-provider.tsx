'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react';

import {
  currentUserRequest,
  loginRequest,
  type LoginCommand
} from '@/lib/api/auth-api';
import {
  adaptCurrentUserResponse,
  adaptLoginResponse
} from '@/lib/adapters/auth.adapter';
import { mapAuthError } from '@/lib/errors/auth-error-mapper';
import {
  BrowserSessionStore,
  type SessionStore
} from '@/lib/session/session-store';
import type {
  AuthFeedback,
  AuthSessionState
} from '@/models/auth-session';
import { deriveIssuerContext } from '@/models/issuer-context';

interface SessionContextValue {
  state: AuthSessionState;
  login(command: LoginCommand): Promise<AuthFeedback | null>;
  retry(): Promise<void>;
  logout(): void;
  selectIssuer(issuerReference: string): boolean;
  clearSelectedIssuer(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
  children: ReactNode;
  store?: SessionStore;
}

export function SessionProvider({
  children,
  store: providedStore
}: SessionProviderProps) {
  const [store] = useState<SessionStore>(
    () => providedStore ?? new BrowserSessionStore()
  );
  const [state, setState] = useState<AuthSessionState>({
    status: 'booting'
  });

  async function resolveSession(accessToken: string) {
    setState({ status: 'resolving-context' });

    try {
      const response = await currentUserRequest(accessToken);
      const adapted = adaptCurrentUserResponse(response);
      const selectedIssuerReference = store.getSelectedIssuerReference();
      const issuerContext = deriveIssuerContext(
        adapted.issuerMemberships,
        selectedIssuerReference
      );
      const selectionStillValid =
        selectedIssuerReference === null ||
        issuerContext.operationalIssuerContexts.some(
          (membership) =>
            membership.issuerReference === selectedIssuerReference
        );

      if (!selectionStillValid) {
        store.clearSelectedIssuerReference();
      }

      setState({
        status: 'authenticated',
        currentUser: adapted.currentUser,
        issuerContext
      });
    } catch (error) {
      const feedback = mapAuthError(error, 'session');

      if (feedback.code === 'session_expired') {
        store.clear();
        setState({
          status: 'expired',
          error: feedback
        });
        return;
      }

      setState({
        status: 'recoverable-error',
        error: feedback
      });
    }
  }

  useEffect(() => {
    async function hydrateSession() {
      const accessToken = store.getAccessToken();

      if (!accessToken) {
        setState({ status: 'unauthenticated' });
        return;
      }

      await resolveSession(accessToken);
    }

    void hydrateSession();
    // The store instance is stable for the lifetime of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  async function login(command: LoginCommand) {
    setState({ status: 'authenticating' });

    try {
      const response = await loginRequest(command);
      const adapted = adaptLoginResponse(response);

      store.clear();
      store.setAccessToken(adapted.accessToken);
      await resolveSession(adapted.accessToken);
      return null;
    } catch (error) {
      const feedback = mapAuthError(error, 'login');
      store.clear();
      setState({ status: 'unauthenticated' });
      return feedback;
    }
  }

  async function retry() {
    const accessToken = store.getAccessToken();

    if (!accessToken) {
      setState({ status: 'unauthenticated' });
      return;
    }

    await resolveSession(accessToken);
  }

  function logout() {
    store.clear();
    setState({ status: 'unauthenticated' });
  }

  function selectIssuer(issuerReference: string) {
    if (state.status !== 'authenticated') {
      return false;
    }

    const issuerExists = state.issuerContext.operationalIssuerContexts.some(
      (membership) => membership.issuerReference === issuerReference
    );

    if (!issuerExists) {
      return false;
    }

    store.setSelectedIssuerReference(issuerReference);
    setState({
      ...state,
      issuerContext: deriveIssuerContext(
        state.issuerContext.issuerContexts,
        issuerReference
      )
    });
    return true;
  }

  function clearSelectedIssuer() {
    store.clearSelectedIssuerReference();

    if (state.status !== 'authenticated') {
      return;
    }

    setState({
      ...state,
      issuerContext: deriveIssuerContext(
        state.issuerContext.issuerContexts,
        null
      )
    });
  }

  return (
    <SessionContext.Provider
      value={{
        state,
        login,
        retry,
        logout,
        selectIssuer,
        clearSelectedIssuer
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession debe utilizarse dentro de SessionProvider.');
  }

  return context;
}
