import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpClient } from '@/lib/api/http-client';
import { SessionProvider } from '@/lib/auth/session-provider';
import { InMemorySessionStorage } from '@/lib/auth/session-storage';
import type { AppConfig } from '@/lib/config/app-config';
import { AppConfigProvider } from '@/lib/config/app-config-provider';
import { createQueryClient } from '@/lib/query/query-client';
import { createRoutedFetchStub, type RouteMap } from '@/test/http';

export const TEST_CONFIG: AppConfig = {
  apiBaseUrl: 'https://api.scope.test',
  webBaseUrl: 'https://scope.test'
};

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 }
};

/**
 * Monta un componente con el árbol real de providers de la app, con la red
 * simulada por rutas y una sesión ya autenticada.
 *
 * `render` es asíncrono en React Native Testing Library 14: siempre se espera.
 * El reintento de consultas se desactiva para que un test de error no deje
 * temporizadores vivos al terminar.
 */
export async function renderWithProviders(
  ui: ReactElement,
  {
    routes = {},
    accessToken = 'jwt-de-test',
    fetchImplementation
  }: {
    routes?: RouteMap;
    accessToken?: string | null;
    fetchImplementation?: typeof fetch;
  } = {}
) {
  const stub = createRoutedFetchStub(routes);
  const httpClient = new HttpClient(
    TEST_CONFIG.apiBaseUrl,
    fetchImplementation ?? stub.fetchImplementation
  );
  const queryClient = createQueryClient({ retry: false });
  const storage = new InMemorySessionStorage(accessToken);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <AppConfigProvider config={TEST_CONFIG}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider httpClient={httpClient} storage={storage}>
              {children}
            </SessionProvider>
          </QueryClientProvider>
        </AppConfigProvider>
      </SafeAreaProvider>
    );
  }

  const view = await render(ui, { wrapper: Wrapper });

  return { view, calls: stub.calls, queryClient, storage };
}
