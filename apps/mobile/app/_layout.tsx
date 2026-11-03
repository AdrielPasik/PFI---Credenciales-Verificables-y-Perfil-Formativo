import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts
} from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useMemo } from 'react';

import { ConfigErrorScreen } from '@/app-shell/config-error-screen';
import { AppProviders } from '@/app-shell/providers';
import { resolveAppConfig } from '@/lib/config/app-config';
import { ThemeProvider, useTheme } from '@/lib/theme/theme-provider';

/**
 * Layout raíz.
 *
 * Secuencia de arranque (sección 137 del encargo):
 *
 *   splash -> fuentes + configuración -> restauración de sesión ->
 *   perfil (si hay sesión válida) o acceso.
 *
 * El splash se mantiene hasta que las fuentes y la apariencia guardada están
 * listas, así nunca se ve un instante de tipografía rota ni un cambio de tema. La restauración de sesión ocurre por
 * detrás, y `app/index.tsx` decide el destino: no hay un "flash" de la
 * pantalla de acceso para alguien que ya tiene sesión válida.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { colors, scheme, ready: themeReady } = useTheme();
  const configResult = useMemo(() => resolveAppConfig(), []);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold
  });

  // Una fuente que no carga NO debe dejar la app en el splash para siempre:
  // React Native cae a la tipografía del sistema y la app sigue siendo usable.
  const ready = (fontsLoaded || Boolean(fontError)) && themeReady;

  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (ready) hideSplash();
  }, [hideSplash, ready]);

  // Fondo de la vista raíz nativa: es lo que se ve detrás de las
  // transiciones y al abrir el teclado. Debe acompañar al tema.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.surface.background).catch(() => undefined);
  }, [colors.surface.background]);

  // El contenedor de navegación pinta sus propias tarjetas y bordes: se le
  // pasa la paleta de Scope para que nunca asome el blanco por defecto.
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.brand.teal,
        background: colors.surface.background,
        card: colors.surface.card,
        text: colors.text.strong,
        border: colors.border.default,
        notification: colors.status.error
      }
    };
  }, [colors, scheme]);

  if (!ready) return null;

  const statusBarStyle = scheme === 'dark' ? 'light' : 'dark';

  if (configResult.status === 'misconfigured') {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <ConfigErrorScreen error={configResult.error} />
      </>
    );
  }

  return (
    <AppProviders config={configResult.config}>
      <NavigationThemeProvider value={navigationTheme}>
        <StatusBar style={statusBarStyle} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface.card },
            headerTintColor: colors.brand.navy,
            headerTitleStyle: { color: colors.text.strong },
            contentStyle: { backgroundColor: colors.surface.background }
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
          <Stack.Screen name="(holder)" options={{ headerShown: false }} />
        </Stack>
      </NavigationThemeProvider>
    </AppProviders>
  );
}
