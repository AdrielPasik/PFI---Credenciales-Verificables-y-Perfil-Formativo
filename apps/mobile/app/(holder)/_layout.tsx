import { Redirect, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScopeLoadingState } from '@/components/ui/states';
import { useSession } from '@/lib/auth/session-provider';
import { colors, layout, spacing } from '@/lib/theme/tokens';

/**
 * Guardia de navegación del espacio del titular.
 *
 * Ninguna pantalla protegida se monta sin sesión: al cerrar sesión o al
 * vencer el token, esta guardia devuelve a `/login` y la pila protegida deja
 * de existir (sección 32 del encargo).
 *
 * Esto es PRESENTACIÓN, no autorización: la autoridad sigue siendo el backend
 * y cada petición viaja con su Bearer (sección 104).
 */
export default function HolderLayout() {
  const { state } = useSession();

  if (state.status === 'unauthenticated') {
    return <Redirect href="/login" />;
  }

  if (state.status !== 'authenticated') {
    return (
      <View style={styles.centered}>
        <ScopeLoadingState label="Validando tu acceso" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface.card },
        headerTintColor: colors.brand.navy,
        headerTitleStyle: { color: colors.text.strong },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surface.background }
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="credentials/[credentialId]"
        options={{
          title: 'Credencial',
          headerBackTitle: 'Credenciales'
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: layout.screenPaddingHorizontal,
    backgroundColor: colors.surface.background
  }
});
