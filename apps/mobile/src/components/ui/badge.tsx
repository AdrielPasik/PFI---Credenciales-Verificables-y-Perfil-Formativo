import { StyleSheet, View } from 'react-native';

import { ScopeText } from '@/components/ui/text';
import { colors, radii, spacing } from '@/lib/theme/tokens';

export type ScopeBadgeTone =
  | 'issued'
  | 'revoked'
  | 'analysis'
  | 'neutral'
  | 'warning'
  | 'inverse';

const TONES: Record<ScopeBadgeTone, { background: string; text: string }> = {
  issued: {
    background: colors.status.issuedSoft,
    text: colors.status.issued
  },
  revoked: {
    background: colors.status.revokedSoft,
    text: colors.status.revoked
  },
  analysis: {
    background: colors.status.analysisSoft,
    text: colors.status.analysis
  },
  neutral: {
    background: colors.status.neutralSoft,
    text: colors.status.neutral
  },
  warning: {
    background: colors.status.warningSoft,
    text: colors.status.warning
  },
  inverse: {
    background: 'rgba(255, 255, 255, 0.14)',
    text: colors.text.onInverse
  }
};

/**
 * Estado como texto, no sólo como color: nunca se comunica un estado
 * únicamente por color (sección 35 del encargo).
 */
export function ScopeBadge({
  label,
  tone = 'neutral'
}: {
  label: string;
  tone?: ScopeBadgeTone;
}) {
  const palette = TONES[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.background }]}>
      <ScopeText variant="caption" style={{ color: palette.text }}>
        {label}
      </ScopeText>
    </View>
  );
}

/**
 * Chip de taxonomía (área, habilidad, concepto). Envuelve en varias líneas
 * cuando la etiqueta es larga: NUNCA se recorta ni se fuerza scroll
 * horizontal (secciones 21 y 181 del encargo).
 *
 * Los chips son para etiquetas cortas. Un párrafo declarado va en
 * `DeclaredTextList`, no acá.
 */
export function ScopeChip({
  label,
  metadata,
  provenance
}: {
  label: string;
  metadata?: string | null;
  provenance?: React.ReactNode;
}) {
  return (
    <View style={styles.chipRow}>
      <View style={styles.chip}>
        <ScopeText variant="small" tone="strong" style={styles.chipLabel}>
          {label}
        </ScopeText>
        {provenance}
      </View>
      {metadata ? (
        <ScopeText variant="caption" tone="muted" style={styles.chipMetadata}>
          {metadata}
        </ScopeText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    maxWidth: '100%'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: spacing.xs,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipLabel: {
    flexShrink: 1
  },
  chipMetadata: {
    flexShrink: 1
  }
});
