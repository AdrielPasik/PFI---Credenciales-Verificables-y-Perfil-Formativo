import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HttpClient } from '@/lib/api/http-client';
import { SessionProvider } from '@/lib/auth/session-provider';
import type { AppConfig } from '@/lib/config/app-config';
import { AppConfigProvider } from '@/lib/config/app-config-provider';
import { createQueryClient } from '@/lib/query/query-client';

/**
 * Árbol de providers de la app, de afuera hacia adentro:
 *
 *   SafeAreaProvider   -> insets de pantalla (notch, barra de estado, home)
 *   AppConfigProvider  -> URLs de entorno ya validadas
 *   QueryClientProvider-> estado de servidor
 *   SessionProvider    -> sesión (necesita el QueryClient para limpiarlo al
 *                         cerrar sesión, por eso va por dentro)
 *
 * El router y la carga de fuentes viven en `app/_layout.tsx`, que es el punto
 * de entrada de Expo Router.
 */
export function AppProviders({
  config,
  children
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  const [queryClient] = useState(createQueryClient);
  const [httpClient] = useState(() => new HttpClient(config.apiBaseUrl));

  return (
    <SafeAreaProvider>
      <AppConfigProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider httpClient={httpClient}>{children}</SessionProvider>
        </QueryClientProvider>
      </AppConfigProvider>
    </SafeAreaProvider>
  );
}
