import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { ScopeText } from '@/components/ui/text';
import {
  colors,
  elevation,
  layout,
  radii,
  spacing
} from '@/lib/theme/tokens';

/** Tarjeta base. Radio moderado y elevación discreta, nunca sombras web. */
export function ScopeCard({
  children,
  style,
  tone = 'surface'
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'surface' | 'inverse' | 'muted';
}) {
  return (
    <View
      style={[
        styles.card,
        tone === 'inverse' && styles.cardInverse,
        tone === 'muted' && styles.cardMuted,
        style
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Sección con título. La jerarquía de pantalla es: título de pantalla (uno
 * solo) -> secciones -> contenido. No se repite el mismo título dos veces
 * (sección 175 del encargo).
 */
export function ScopeSection({
  title,
  description,
  action,
  children,
  style
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeading}>
          <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
            {title}
          </ScopeText>
          {description ? (
            <ScopeText variant="small" tone="muted" style={styles.sectionDescription}>
              {description}
            </ScopeText>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function ScopeDivider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/**
 * Fila de definición: etiqueta arriba, valor abajo. Preferida frente a una
 * tarjeta por campo, que en una pantalla angosta genera ruido (sección 149).
 */
export function ScopeDefinitionRow({
  label,
  value,
  technical = false
}: {
  label: string;
  value: string | null;
  technical?: boolean;
}) {
  if (!value) return null;

  return (
    <View style={styles.definitionRow}>
      <ScopeText variant="overline" tone="muted">
        {label}
      </ScopeText>
      <ScopeText
        variant={technical ? 'technical' : 'bodyStrong'}
        tone="strong"
        style={styles.definitionValue}
      >
        {value}
      </ScopeText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface.card,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    padding: spacing.xl,
    ...elevation.card
  },
  cardInverse: {
    backgroundColor: colors.surface.inverse,
    borderColor: colors.brand.navyStrong
  },
  cardMuted: {
    backgroundColor: colors.surface.muted,
    borderColor: colors.border.default,
    ...elevation.none
  },
  section: {
    gap: spacing.md
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  sectionHeading: {
    flex: 1,
    gap: spacing.xs
  },
  sectionDescription: {
    marginTop: 2
  },
  divider: {
    height: layout.hairline,
    backgroundColor: colors.border.default
  },
  definitionRow: {
    gap: spacing.xs
  },
  definitionValue: {
    // Los valores técnicos largos (DID, hash) deben envolver, nunca recortarse.
    flexShrink: 1
  }
});
