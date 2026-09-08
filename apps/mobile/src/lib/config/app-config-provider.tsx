import { createContext, useContext, type ReactNode } from 'react';

import type { AppConfig } from '@/lib/config/app-config';

/**
 * La configuración se resuelve UNA vez en el layout raíz y se inyecta.
 * Ningún componente vuelve a leer `process.env` por su cuenta.
 */
const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({
  config,
  children
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);

  if (!config) {
    throw new Error('useAppConfig debe usarse dentro de AppConfigProvider.');
  }

  return config;
}
