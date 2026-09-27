import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeBadge } from '@/components/ui/badge';
import { ScopeButton } from '@/components/ui/button';
import { ScopeScreenHeading } from '@/components/ui/screen';
import {
  ScopeEmptyState,
  ScopeErrorState,
  ScopeLoadingState
} from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { useObjectives } from '@/features/objectives/use-objectives';
import { mapObjectiveReadError } from '@/lib/errors/objective-error-mapper';
import {
  colors,
  elevation,
  layout,
  radii,
  spacing
} from '@/lib/theme/tokens';
import type { ObjectiveSummaryVM } from '@/types/objectives';

/**
 * Historial de Objetivos.
 *
 * Sólo lectura: montar esta pantalla NUNCA crea una propuesta ni un análisis.
 * Muestra exactamente lo que trae el resumen del backend —título, tipo y
 * fecha— y nada más: un conteo de requisitos no viaja en este DTO, así que
 * fabricarlo sería inventar.
 */
export function ObjectivesListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const objectivesQuery = useObjectives();

  const openObjective = useCallback(
    (objectiveReference: string) => {
      router.push(`/objectives/${encodeURIComponent(objectiveReference)}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: ObjectiveSummaryVM }) => (
      <ObjectiveCard objective={item} onPress={openObjective} />
    ),
    [openObjective]
  );

  return (
    <FlatList
      style={styles.root}
      data={objectivesQuery.data ?? []}
      keyExtractor={(item) => item.objectiveReference}
      renderItem={renderItem}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: spacing.xxxl + insets.bottom }
      ]}
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl
          refreshing={objectivesQuery.isRefetching && !objectivesQuery.isLoading}
          onRefresh={() => void objectivesQuery.refetch()}
          tintColor={colors.brand.teal}
          colors={[colors.brand.teal]}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <ScopeScreenHeading
            eyebrow="Tu contexto"
            title="Mis objetivos"
            description="Cada objetivo describe una oportunidad concreta contra la que Scope puede analizar tu trayectoria."
          />
          <ScopeButton
            testID="objectives-list-new"
            label="Analizar un objetivo"
            onPress={() => router.push('/objectives/new')}
          />
        </View>
      }
      ListEmptyComponent={
        objectivesQuery.isLoading ? (
          <ScopeLoadingState label="Cargando tus objetivos" />
        ) : objectivesQuery.isError ? (
          <ScopeErrorState
            title="No pudimos cargar tus objetivos"
            description={mapObjectiveReadError(objectivesQuery.error)}
            onRetry={() => void objectivesQuery.refetch()}
          />
        ) : (
          <ScopeEmptyState
            icon="compass-outline"
            title="Todavía no preparaste ningún objetivo"
            description="Pegá el texto de una búsqueda laboral, una beca o una convocatoria y Scope va a identificar sus requisitos para que los revises."
          />
        )
      }
    />
  );
}

function ObjectiveCard({
  objective,
  onPress
}: {
  objective: ObjectiveSummaryVM;
  onPress: (objectiveReference: string) => void;
}) {
  return (
    <Pressable
      testID={`objective-card-${objective.objectiveReference}`}
      accessibilityRole="button"
      accessibilityLabel={`${objective.title}. ${objective.objectiveTypeLabel}. Creado el ${objective.createdAtLabel}`}
      accessibilityHint="Abre el objetivo y su análisis"
      onPress={() => onPress(objective.objectiveReference)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardBody}>
        <ScopeBadge label={objective.objectiveTypeLabel} tone="neutral" />
        <ScopeText variant="cardTitle" tone="strong">
          {objective.title}
        </ScopeText>
        <ScopeText variant="caption" tone="subtle">
          {objective.createdAtLabel}
        </ScopeText>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.text.subtle}
        style={styles.chevron}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
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
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.contentMaxWidth
  },
  header: {
    gap: spacing.lg,
    marginBottom: spacing.xl
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    ...elevation.card
  },
  cardPressed: {
    borderColor: colors.brand.teal,
    opacity: 0.92
  },
  cardBody: {
    flex: 1,
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm
  },
  chevron: {
    marginRight: spacing.md
  },
  separator: {
    height: spacing.md
  }
});
