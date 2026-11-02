'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  readPreference,
  readResolvedTheme,
  setAppearancePreference,
  subscribeAppearance,
  type AppearancePreference,
  type ResolvedTheme
} from '@/lib/appearance/appearance';

interface AppearanceState {
  /** `null` en el servidor y en la hidratacion: el servidor no conoce la eleccion. */
  preference: AppearancePreference | null;
  theme: ResolvedTheme | null;
  setPreference: (preference: AppearancePreference) => void;
  /** Alterna claro/oscuro desde el tema visible; fija la eleccion. */
  toggle: () => void;
}

const getServerSnapshot = () => null;

export function useAppearance(): AppearanceState {
  const preference = useSyncExternalStore(
    subscribeAppearance,
    readPreference,
    getServerSnapshot
  );
  const theme = useSyncExternalStore(
    subscribeAppearance,
    readResolvedTheme,
    getServerSnapshot
  );

  const toggle = useCallback(() => {
    setAppearancePreference(readResolvedTheme() === 'dark' ? 'light' : 'dark');
  }, []);

  return { preference, theme, setPreference: setAppearancePreference, toggle };
}

/**
 * Mantiene el tema sincronizado con el sistema y con otras pestanas en
 * cualquier pantalla, tenga o no un selector montado (404, carga, error).
 */
export function AppearanceSync() {
  useSyncExternalStore(subscribeAppearance, readPreference, getServerSnapshot);
  return null;
}
