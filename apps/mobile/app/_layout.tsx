import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo } from 'react';

import { ConfigErrorScreen } from '@/app-shell/config-error-screen';
import { AppProviders } from '@/app-shell/providers';
import { resolveAppConfig } from '@/lib/config/app-config';
import { colors } from '@/lib/theme/tokens';

/**
 * Layout raíz.
 *
 * Secuencia de arranque (sección 137 del encargo):
 *
 *   splash -> fuentes + configuración -> restauración de sesión ->
 *   perfil (si hay sesión válida) o acceso.
 *
 * El splash se mantiene hasta que las fuentes están listas, así nunca se ve
 * un instante de tipografía rota. La restauración de sesión ocurre por
 * detrás, y `app/index.tsx` decide el destino: no hay un "flash" de la
 * pantalla de acceso para alguien que ya tiene sesión válida.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const configResult = useMemo(() => resolveAppConfig(), []);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold
  });

  // Una fuente que no carga NO debe dejar la app en el splash para siempre:
  // React Native cae a la tipografía del sistema y la app sigue siendo usable.
  const ready = fontsLoaded || Boolean(fontError);

  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    if (ready) hideSplash();
  }, [hideSplash, ready]);

  if (!ready) return null;

  if (configResult.status === 'misconfigured') {
    return (
      <>
        <StatusBar style="dark" />
        <ConfigErrorScreen error={configResult.error} />
      </>
    );
  }

  return (
    <AppProviders config={configResult.config}>
      <StatusBar style="dark" />
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
        <Stack.Screen name="(holder)" options={{ headerShown: false }} />
      </Stack>
    </AppProviders>
  );
}
