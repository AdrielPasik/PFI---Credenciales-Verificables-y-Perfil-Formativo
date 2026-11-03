import { Redirect, Stack, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScopeLoadingState } from '@/components/ui/states';
import { useSession } from '@/lib/auth/session-provider';
import { safeHolderDestination } from '@/lib/navigation/return-destination';
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
  const pathname = usePathname();

  if (state.status === 'unauthenticated') {
    // Enlace profundo sin sesion: el destino viaja al login para volver a el.
    const next = safeHolderDestination(pathname);
    return <Redirect href={next ? { pathname: '/login', params: { next } } : '/login'} />;
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
        name="objectives/index"
        options={{ title: 'Mis objetivos', headerBackTitle: 'Perfil' }}
      />
      <Stack.Screen
        name="objectives/new"
        options={{ title: 'Nuevo objetivo', headerBackTitle: 'Objetivos' }}
      />
      <Stack.Screen
        name="objectives/[objectiveId]"
        options={{ title: 'Objetivo', headerBackTitle: 'Objetivos' }}
      />
      <Stack.Screen
        name="credentials/[credentialId]"
        options={{
          title: 'Credencial',
          headerBackTitle: 'Credenciales'
        }}
      />
      <Stack.Screen
        name="profile-shares"
        options={{ title: 'Enlaces compartidos', headerBackTitle: 'Perfil' }}
      />
      <Stack.Screen
        name="profile-shares/[shareId]/verification-policy"
        options={{ title: 'Análisis contextual', headerBackTitle: 'Enlaces' }}
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
