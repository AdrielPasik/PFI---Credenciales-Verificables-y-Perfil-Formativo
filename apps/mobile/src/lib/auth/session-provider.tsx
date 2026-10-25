import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import {
  mapAuthError,
  SESSION_EXPIRED_FEEDBACK
} from '@/lib/auth/auth-error-mapper';
import {
  SecureSessionStorage,
  type SessionStorage
} from '@/lib/auth/session-storage';
import type {
  AuthenticatedRequest,
  HttpRequestOptions
} from '@/lib/api/http-client';
import { HttpClient } from '@/lib/api/http-client';
import {
  currentUserRequest,
  loginRequest,
  registerRequest,
  type LoginCommand,
  type RegisterCommand
} from '@/lib/api/scope-api';
import { ApiError } from '@/lib/errors/api-error';
import type { AuthFeedback, AuthSessionState } from '@/types/auth';

/**
 * Sesión nativa de Scope.
 *
 * Contrato real inspeccionado en el backend (NestJS):
 *
 *   POST /auth/login  -> { accessToken, user }   (JWT Bearer, sin refresh)
 *   GET  /auth/me     -> usuario + issuerMemberships (Authorization: Bearer)
 *
 * No hay cookies, ni CSRF, ni ningún mecanismo que dependa del navegador: el
 * contrato es directamente utilizable desde un cliente nativo. El token vive
 * en `expo-secure-store` y en memoria; la contraseña NUNCA se persiste.
 *
 * Sin refresh token: cuando el JWT vence (`JWT_EXPIRES_IN`, 1 h por defecto),
 * la primera respuesta 401 limpia la sesión y devuelve a login con un aviso.
 */

interface SessionContextValue {
  state: AuthSessionState;
  login(command: LoginCommand): Promise<AuthFeedback | null>;
  register(command: RegisterCommand): Promise<AuthFeedback | null>;
  logout(): Promise<void>;
  retry(): Promise<void>;
  requestAuthenticated: AuthenticatedRequest;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Una respuesta puede llegar después de logout o de la autenticación de otra
 * persona. No es un error de servidor: es material de una sesión obsoleta y
 * jamás debe alimentar cachés o callbacks de éxito del titular actual.
 */
export class StaleAuthenticatedResponseError extends Error {
  constructor() {
    super('La respuesta pertenece a una sesión que ya no está activa.');
    this.name = 'StaleAuthenticatedResponseError';
  }
}

interface SessionProviderProps {
  children: ReactNode;
  httpClient: HttpClient;
  storage?: SessionStorage;
}

export function SessionProvider({
  children,
  httpClient,
  storage: providedStorage
}: SessionProviderProps) {
  const queryClient = useQueryClient();
  const [storage] = useState<SessionStorage>(
    () => providedStorage ?? new SecureSessionStorage()
  );
  const [state, setState] = useState<AuthSessionState>({ status: 'booting' });
  // Copia en memoria para no golpear el almacenamiento seguro en cada
  // petición. `storage` sigue siendo la fuente de verdad entre arranques.
  const accessTokenRef = useRef<string | null>(null);
  // Invalida respuestas de una sesión anterior. Un logout debe ganar incluso
  // si `/auth/me` o una petición de datos termina después.
  const sessionEpochRef = useRef(0);
  // El bloqueo visual evita el doble toque; éste cubre además dos invocaciones
  // programáticas dentro del mismo tick sin duplicar login/registro.
  const authenticationInFlightRef = useRef<Promise<AuthFeedback | null> | null>(null);

  const clearSession = useCallback(async () => {
    sessionEpochRef.current += 1;
    accessTokenRef.current = null;
    await storage.clear();
    // Los datos del titular no deben sobrevivir a un cierre de sesión.
    queryClient.clear();
  }, [queryClient, storage]);

  const resolveSession = useCallback(
    async (
      accessToken: string,
      expectedEpoch: number = sessionEpochRef.current
    ): Promise<AuthFeedback | null> => {
      try {
        const currentUser = await currentUserRequest(httpClient, accessToken);
        if (expectedEpoch !== sessionEpochRef.current) return null;
        accessTokenRef.current = accessToken;
        setState({ status: 'authenticated', currentUser });
        return null;
      } catch (error) {
        if (expectedEpoch !== sessionEpochRef.current) return null;
        const feedback = mapAuthError(error, 'session');

        if (feedback.recoverable) {
          // Red o servicio caído con un token que puede seguir siendo válido:
          // no se destruye la sesión, se ofrece reintentar.
          setState({ status: 'recoverable-error', error: feedback });
          return feedback;
        }

        await clearSession();
        setState({ status: 'unauthenticated', notice: feedback });
        return feedback;
      }
    },
    [clearSession, httpClient]
  );

  useEffect(() => {
    let active = true;

    async function restore() {
      const epoch = sessionEpochRef.current;
      const accessToken = await storage.getAccessToken();

      if (!active || epoch !== sessionEpochRef.current) return;

      if (!accessToken) {
        setState({ status: 'unauthenticated', notice: null });
        return;
      }

      await resolveSession(accessToken, epoch);
    }

    void restore();

    return () => {
      active = false;
    };
  }, [resolveSession, storage]);

  const activateAuthentication = useCallback(
    async (
      authenticate: () => ReturnType<typeof loginRequest>,
      operation: 'login' | 'register'
    ): Promise<AuthFeedback | null> => {
      if (authenticationInFlightRef.current) return authenticationInFlightRef.current;

      const operationPromise = (async (): Promise<AuthFeedback | null> => {
        const epoch = sessionEpochRef.current + 1;
        sessionEpochRef.current = epoch;
        accessTokenRef.current = null;
        queryClient.clear();
        setState({ status: 'authenticating' });

        try {
          const response = await authenticate();
          if (epoch !== sessionEpochRef.current) return null;

          await storage.setAccessToken(response.accessToken);
          if (epoch !== sessionEpochRef.current) return null;

          accessTokenRef.current = response.accessToken;
          // El usuario ya viene en la respuesta de login: no hace falta un
          // segundo viaje a /auth/me para entrar.
          setState({ status: 'authenticated', currentUser: response.user });
          return null;
        } catch (error) {
          if (epoch !== sessionEpochRef.current) return null;
          const feedback = mapAuthError(error, operation);
          await clearSession();
          setState({ status: 'unauthenticated', notice: null });
          return feedback;
        }
      })();

      authenticationInFlightRef.current = operationPromise;
      void operationPromise.finally(() => {
        if (authenticationInFlightRef.current === operationPromise) {
          authenticationInFlightRef.current = null;
        }
      });
      return operationPromise;
    },
    [clearSession, queryClient, storage]
  );

  const login = useCallback(
    (command: LoginCommand): Promise<AuthFeedback | null> =>
      activateAuthentication(() => loginRequest(httpClient, command), 'login'),
    [activateAuthentication, httpClient]
  );

  const register = useCallback(
    (command: RegisterCommand): Promise<AuthFeedback | null> =>
      activateAuthentication(
        () => registerRequest(httpClient, command),
        'register'
      ),
    [activateAuthentication, httpClient]
  );

  const logout = useCallback(async () => {
    await clearSession();
    setState({ status: 'unauthenticated', notice: null });
  }, [clearSession]);

  const retry = useCallback(async () => {
    const accessToken =
      accessTokenRef.current ?? (await storage.getAccessToken());

    if (!accessToken) {
      setState({ status: 'unauthenticated', notice: null });
      return;
    }

    const epoch = sessionEpochRef.current;
    setState({ status: 'booting' });
    await resolveSession(accessToken, epoch);
  }, [resolveSession, storage]);

  const requestAuthenticated = useCallback<AuthenticatedRequest>(
    async (path, options: Omit<HttpRequestOptions, 'token'> = {}) => {
      const accessToken =
        accessTokenRef.current ?? (await storage.getAccessToken());
      const epoch = sessionEpochRef.current;

      if (!accessToken) {
        await clearSession();
        setState({
          status: 'unauthenticated',
          notice: SESSION_EXPIRED_FEEDBACK
        });
        throw new ApiError('La sesión no está disponible.', 'http', 401);
      }

      try {
        const response = await httpClient.request(path, {
          ...options,
          token: accessToken
        });
        if (
          epoch !== sessionEpochRef.current ||
          // Durante la restauración inicial el token todavía puede vivir sólo
          // en SecureStore. `null` no identifica otra sesión; un token no nulo
          // distinto sí. Logout/login siempre incrementan la época.
          (accessTokenRef.current !== null && accessTokenRef.current !== accessToken)
        ) {
          throw new StaleAuthenticatedResponseError();
        }
        return response;
      } catch (error) {
        // Un 401 sólo expira la sesión que inició ESTA petición. Una respuesta
        // vieja no puede cerrar la cuenta que acaba de iniciar otra persona.
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          epoch === sessionEpochRef.current &&
          accessTokenRef.current === accessToken
        ) {
          await clearSession();
          setState({
            status: 'unauthenticated',
            notice: SESSION_EXPIRED_FEEDBACK
          });
        }

        throw error;
      }
    },
    [clearSession, httpClient, storage]
  );

  const value = useMemo<SessionContextValue>(
    () => ({ state, login, register, logout, retry, requestAuthenticated }),
    [state, login, register, logout, retry, requestAuthenticated]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession debe usarse dentro de SessionProvider.');
  }

  return context;
}

/**
 * Acceso a la petición autenticada para hooks de datos. Se separa de
 * `useSession` para que un componente de datos no dependa del estado completo
 * de sesión y se re-renderice de más.
 */
export function useAuthenticatedRequest(): AuthenticatedRequest {
  return useSession().requestAuthenticated;
}
