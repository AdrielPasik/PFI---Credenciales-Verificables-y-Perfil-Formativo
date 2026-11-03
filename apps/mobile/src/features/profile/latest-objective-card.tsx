import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeSkeletonBlock } from '@/components/ui/states';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeText } from '@/components/ui/text';
import type {
  LatestObjectiveAnalysis,
  LatestObjectiveState
} from '@/features/profile/use-latest-objective';
import { STATE_DESCRIPTORS } from '@/features/reasoning/objective-synthesis-overview';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { radii, spacing } from '@/lib/theme/tokens';
import type { ScopeColors } from '@/lib/theme/tokens';
import type { ObjectiveSynthesisStateSummaryVM } from '@/types/reasoning-runs';

/**
 * Objetivo reciente, montado sobre el borde de la banda de bienvenida.
 *
 * Es lo próximo que la persona quiere retomar. Muestra tipo, título y el
 * estado del último análisis con los MISMOS recuentos descriptivos de la
 * síntesis: no se dividen por el total ni se dibujan como una barra de
 * avance, porque una proporción ("50 % respaldado") sería una afirmación
 * sobre la persona que el análisis no sostiene.
 *
 * Sin objetivos, la tarjeta invita a preparar el primero. Ninguna acción
 * llama al proveedor: sólo navegan.
 */
export function LatestObjectiveCard({ state }: { state: LatestObjectiveState }) {
  const styles = useStyles();
  const router = useRouter();

  if (state.status === 'loading') {
    return <ScopeSkeletonBlock height={124} />;
  }

  if (state.status === 'empty' || state.status === 'unavailable') {
    const empty = state.status === 'empty';
    return (
      <ScopeCard style={styles.card} testID="latest-objective-card">
        <ScopeText variant="overline" tone="teal">
          Objetivos
        </ScopeText>
        <ScopeText variant="cardTitle" tone="strong" accessibilityRole="header">
          {empty ? 'Analizá tu trayectoria en contexto' : 'Tus objetivos'}
        </ScopeText>
        <ScopeText variant="small" tone="muted">
          {empty
            ? 'Usá una búsqueda laboral, beca o admisión para ver qué podés justificar con tus credenciales.'
            : 'No pudimos cargar tu objetivo más reciente. Tus objetivos siguen disponibles.'}
        </ScopeText>
        <View style={styles.emptyFooter}>
          <ScopeButton
            testID={empty ? 'latest-objective-first' : 'latest-objective-list'}
            variant="secondary"
            label={empty ? 'Preparar mi primer objetivo' : 'Ver mis objetivos'}
            onPress={() => router.push(empty ? '/objectives/new' : '/objectives')}
          />
        </View>
      </ScopeCard>
    );
  }

  const { objective, analysis } = state;
  const openObjective = () =>
    router.push(`/objectives/${encodeURIComponent(objective.objectiveReference)}`);

  const dateLabel =
    analysis.kind === 'completed'
      ? `Analizado el ${analysis.analyzedAtLabel}`
      : `Creado el ${objective.createdAtLabel}`;

  return (
    <ScopeCard style={styles.card} testID="latest-objective-card">
      <ScopeText variant="overline" tone="teal">
        Objetivo reciente
      </ScopeText>
      <View style={styles.titleBlock}>
        <ScopeText variant="cardTitle" tone="strong" accessibilityRole="header">
          {objective.title}
        </ScopeText>
        <ScopeText variant="caption" tone="subtle">
          {objective.objectiveTypeLabel} · {dateLabel}
        </ScopeText>
      </View>

      <AnalysisStatus analysis={analysis} />

      <View style={styles.footer}>
        <ScopeButton
          testID="latest-objective-list"
          variant="ghost"
          label="Ver todos"
          onPress={() => router.push('/objectives')}
          accessibilityHint="Abre la lista de tus objetivos"
          style={styles.leadingAction}
        />
        <ScopeButton
          testID="latest-objective-open"
          variant="secondary"
          label="Ver objetivo"
          onPress={openObjective}
          accessibilityHint={`Abre ${objective.title}`}
        />
      </View>
    </ScopeCard>
  );
}

function AnalysisStatus({ analysis }: { analysis: LatestObjectiveAnalysis }) {
  const styles = useStyles();

  switch (analysis.kind) {
    case 'loading':
      return (
        <ScopeText variant="small" tone="subtle">
          Consultando el estado del análisis…
        </ScopeText>
      );
    case 'unavailable':
      return null;
    case 'none':
      return (
        <ScopeText variant="small" tone="muted">
          Todavía no analizaste tu trayectoria frente a este objetivo.
        </ScopeText>
      );
    case 'in-progress':
      return (
        <ScopeText variant="small" tone="muted">
          Hay un análisis en curso.
        </ScopeText>
      );
    case 'failed':
      return (
        <ScopeText variant="small" tone="warning">
          El último análisis no terminó. Podés volver a intentarlo desde el objetivo.
        </ScopeText>
      );
    case 'completed':
      return analysis.stateSummary ? (
        <StateCounts summary={analysis.stateSummary} />
      ) : (
        <ScopeText variant="small" tone="muted">
          Este objetivo ya tiene un análisis.
        </ScopeText>
      );
    default:
      return <View style={styles.flexOne} />;
  }
}

/**
 * Un recuento por estado presente, cada uno con su punto de color Y su texto:
 * el estado nunca se comunica sólo por color.
 */
function StateCounts({ summary }: { summary: ObjectiveSynthesisStateSummaryVM }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const present = STATE_DESCRIPTORS.filter((descriptor) => summary[descriptor.key] > 0);

  if (present.length === 0) {
    return (
      <ScopeText variant="small" tone="muted">
        El análisis no tiene requisitos evaluados.
      </ScopeText>
    );
  }

  return (
    <View style={styles.counts} testID="latest-objective-counts">
      {present.map((descriptor) => (
        <View key={descriptor.key} style={styles.count}>
          <View
            style={[styles.dot, { backgroundColor: stateColor(colors, descriptor.key) }]}
          />
          <ScopeText variant="small" tone="default">
            {descriptor.label(summary[descriptor.key])}
          </ScopeText>
        </View>
      ))}
    </View>
  );
}

function stateColor(
  colors: ScopeColors,
  key: keyof ObjectiveSynthesisStateSummaryVM
): string {
  switch (key) {
    case 'supportedCount':
      return colors.status.success;
    case 'partiallySupportedCount':
      return colors.status.analysis;
    case 'insufficientEvidenceCount':
      return colors.status.warning;
    case 'abstainCount':
      return colors.status.neutral;
    default:
      return colors.border.strong;
  }
}

const useStyles = makeStyles((colors, elevation) => ({
  card: {
    gap: spacing.sm,
    borderRadius: radii.card + 2,
    ...elevation.raised
  },
  titleBlock: {
    gap: 2
  },
  counts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    columnGap: spacing.md
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.border.default
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  emptyFooter: {
    marginTop: spacing.xs
  },
  leadingAction: {
    marginLeft: -spacing.lg
  },
  flexOne: {
    flex: 1
  }
}));
