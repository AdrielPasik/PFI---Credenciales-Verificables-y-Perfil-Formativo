import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeScreenHeading } from '@/components/ui/screen';
import {
  ScopeEmptyState,
  ScopeErrorState,
  ScopeLoadingState
} from '@/components/ui/states';
import { CredentialCard } from '@/features/credentials/credential-card';
import { mapHolderError } from '@/features/credentials/holder-error-mapper';
import { useCredentials } from '@/features/credentials/use-credentials';
import { colors, layout, spacing } from '@/lib/theme/tokens';
import type { HolderCredentialListItemVM } from '@/types/holder';

/**
 * Biblioteca de credenciales.
 *
 * Usa `FlatList` (no un ScrollView con un `map`) para que la lista escale sin
 * renderizar todo de golpe. No incorpora búsqueda ni filtros: Holder Web
 * tampoco los tiene y agregarlos acá crearía una diferencia de capacidad que
 * nadie pidió (sección 24 del encargo).
 */
export function CredentialsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const credentialsQuery = useCredentials();

  const openCredential = useCallback(
    (credentialReference: string) => {
      router.push(`/credentials/${encodeURIComponent(credentialReference)}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: HolderCredentialListItemVM }) => (
      <CredentialCard credential={item} onPress={openCredential} />
    ),
    [openCredential]
  );

  const state = credentialsQuery.isError
    ? mapHolderError(credentialsQuery.error, 'credentials')
    : null;

  return (
    <FlatList
      style={styles.root}
      data={credentialsQuery.data ?? []}
      keyExtractor={(item) => item.credentialReference}
      renderItem={renderItem}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: spacing.xxxl + insets.bottom }
      ]}
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl
          refreshing={
            credentialsQuery.isRefetching && !credentialsQuery.isLoading
          }
          onRefresh={() => void credentialsQuery.refetch()}
          tintColor={colors.brand.teal}
          colors={[colors.brand.teal]}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <ScopeScreenHeading
            eyebrow="Credenciales de respaldo"
            title="Mis credenciales"
            description="Consultá las credenciales que respaldan tu trayectoria formativa."
          />
        </View>
      }
      ListEmptyComponent={
        credentialsQuery.isLoading ? (
          <ScopeLoadingState label="Cargando credenciales" />
        ) : state ? (
          <ScopeErrorState
            title={state.title}
            description={state.description}
            onRetry={
              state.retryable
                ? () => void credentialsQuery.refetch()
                : undefined
            }
          />
        ) : (
          <ScopeEmptyState
            icon="document-text-outline"
            title="Todavía no tenés credenciales formativas"
            description="Cuando una institución emita una credencial a tu nombre, aparecerá en este espacio."
          />
        )
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface.background
  },
  content: {
    paddingTop: spacing.xl,
    paddingHorizontal: layout.screenPaddingHorizontal,
    // En pantallas anchas (tablet) el contenido queda centrado en vez de
    // estirarse de borde a borde.
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.contentMaxWidth
  },
  header: {
    marginBottom: spacing.xl
  },
  separator: {
    height: spacing.md
  }
});
