import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { Appearance, StyleSheet, useColorScheme } from 'react-native';

import {
  SecureAppearanceStorage,
  type AppearancePreference,
  type AppearanceStorage
} from '@/lib/theme/appearance-storage';
import {
  createElevation,
  darkColors,
  lightColors,
  type ScopeColors,
  type ScopeElevation
} from '@/lib/theme/tokens';

export type ColorScheme = 'light' | 'dark';

export interface ScopeThemeValue {
  /** Esquema efectivo, ya resuelto contra el sistema. */
  scheme: ColorScheme;
  /** Lo que eligió el titular. */
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
  /** La preferencia guardada ya se leyó (o no había ninguna). */
  ready: boolean;
  colors: ScopeColors;
  elevation: ScopeElevation;
}

const PALETTES: Record<ColorScheme, { colors: ScopeColors; elevation: ScopeElevation }> = {
  light: { colors: lightColors, elevation: createElevation(lightColors) },
  dark: { colors: darkColors, elevation: createElevation(darkColors) }
};

/**
 * Sin provider (tests de componentes aislados) se usa el tema claro: es la
 * apariencia original de la app y no requiere montar nada más.
 */
const ThemeContext = createContext<ScopeThemeValue>({
  scheme: 'light',
  preference: 'light',
  setPreference: () => undefined,
  ready: true,
  ...PALETTES.light
});

export function resolveColorScheme(
  preference: AppearancePreference,
  systemScheme: string | null | undefined
): ColorScheme {
  if (preference !== 'system') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

/**
 * Fija el esquema de los componentes nativos (alertas, teclado, selectores)
 * para que coincidan con la elección. Con "sistema" se libera el override y
 * React Native vuelve a informar la apariencia del dispositivo.
 */
function applyNativeScheme(preference: AppearancePreference) {
  try {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Plataformas sin soporte de override: sólo cambia la UI de la app.
  }
}

/**
 * Apariencia de la app.
 *
 * La preferencia guardada se lee al arrancar; hasta entonces `ready` es
 * false y el layout raíz mantiene el splash, así nunca se pinta un tema y se
 * cambia al guardado un instante después. Sin preferencia, se sigue al
 * sistema.
 */
export function ThemeProvider({
  children,
  storage
}: {
  children: ReactNode;
  storage?: AppearanceStorage;
}) {
  const [store] = useState<AppearanceStorage>(() => storage ?? new SecureAppearanceStorage());
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    void store.getPreference().then((saved) => {
      if (cancelled) return;
      if (saved) setPreferenceState(saved);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => {
    applyNativeScheme(preference);
  }, [preference]);

  const setPreference = useCallback(
    (next: AppearancePreference) => {
      setPreferenceState(next);
      void store.setPreference(next);
    },
    [store]
  );

  const scheme = resolveColorScheme(preference, systemScheme);

  const value = useMemo<ScopeThemeValue>(
    () => ({ scheme, preference, setPreference, ready, ...PALETTES[scheme] }),
    [preference, ready, scheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ScopeThemeValue {
  return useContext(ThemeContext);
}

/**
 * Hoja de estilos dependiente del tema. Se crea una sola vez por paleta y se
 * reutiliza: cambiar de tema no recrea estilos en cada render.
 *
 *   const useStyles = makeStyles((colors) => ({ card: { backgroundColor: colors.surface.card } }));
 *   function Card() { const styles = useStyles(); ... }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ScopeColors, elevation: ScopeElevation) => T
): () => T {
  const cache = new Map<ScopeColors, T>();
  return function useStyles() {
    const { colors, elevation } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors, elevation));
      cache.set(colors, styles);
    }
    return styles;
  };
}
