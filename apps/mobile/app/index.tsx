import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeErrorState, ScopeLoadingState } from '@/components/ui/states';
import { useSession } from '@/lib/auth/session-provider';
import { colors, layout, spacing } from '@/lib/theme/tokens';

/**
 * Punto de entrada: decide el destino según el estado de la sesión.
 *
 * Mientras la sesión se está restaurando NO se muestra la pantalla de acceso:
 * eso produciría un parpadeo a quien ya tiene sesión válida (sección 137).
 *
 * Si existe material de sesión pero el servidor no responde, no se expulsa a
 * la persona: se ofrece reintentar o cerrar sesión (sección 138).
 */
export default function BootRoute() {
  const { state, retry, logout } = useSession();

  if (state.status === 'authenticated') {
    return <Redirect href="/(holder)/(tabs)" />;
  }

  if (state.status === 'unauthenticated') {
    return <Redirect href="/login" />;
  }

  if (state.status === 'recoverable-error') {
    return (
      <View style={styles.centered}>
        <ScopeErrorState
          title="No pudimos validar tu sesión"
          description={state.error.message}
          onRetry={() => void retry()}
        />
        <ScopeButton
          variant="ghost"
          label="Cerrar sesión"
          onPress={() => void logout()}
        />
      </View>
    );
  }

  return (
    <View style={styles.centered}>
      <ScopeLoadingState label="Validando tu acceso" />
    </View>
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
