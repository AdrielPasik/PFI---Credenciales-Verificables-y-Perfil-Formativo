import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeChip } from '@/components/ui/badge';
import { ScopeText } from '@/components/ui/text';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import type { HolderProfileProvenanceVM } from '@/types/holder';

/**
 * Contenido declarado por una institución.
 *
 * Estos valores llegan a 500 caracteres: se renderizan como filas de texto
 * multilínea, NUNCA como chips ni pastillas de una sola línea, y nunca se
 * truncan por defecto (secciones 21, 180 y 181 del encargo).
 */
export function DeclaredTextList({
  title,
  items,
  testID
}: {
  title: string;
  items: string[];
  testID?: string;
}) {
  if (items.length === 0) return null;

  return (
    <View style={styles.block} testID={testID}>
      <ScopeText variant="smallStrong" tone="strong">
        {title}
      </ScopeText>
      <View style={styles.declaredList}>
        {items.map((item, index) => (
          <View key={`${item}-${index}`} style={styles.declaredItem}>
            <ScopeText variant="small" tone="default">
              {item}
            </ScopeText>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Taxonomía (áreas, habilidades, conceptos). Etiquetas cortas -> chips que
 * envuelven. Nunca scroll horizontal para evitar el salto de línea.
 */
export interface TaxonomyItem {
  key: string;
  label: string;
  metadata?: string | null;
  provenance?: HolderProfileProvenanceVM | null;
}

export function TaxonomyList({
  title,
  items,
  emptyLabel,
  testID
}: {
  title: string;
  items: TaxonomyItem[];
  emptyLabel?: string;
  testID?: string;
}) {
  if (items.length === 0 && !emptyLabel) return null;

  return (
    <View style={styles.block} testID={testID}>
      <ScopeText variant="smallStrong" tone="strong">
        {title}
      </ScopeText>
      {items.length === 0 ? (
        <ScopeText variant="small" tone="muted">
          {emptyLabel}
        </ScopeText>
      ) : (
        <View style={styles.chipWrap}>
          {items.map((item) => (
            <ScopeChip
              key={item.key}
              label={item.label}
              metadata={item.metadata}
              provenance={
                item.provenance ? (
                  <ProvenanceIndicator provenance={item.provenance} />
                ) : null
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Procedencia de un área o habilidad.
 *
 * El texto ("Emisor" / "IA") es visible SIEMPRE: en táctil no hay hover, así
 * que un tooltip no sería una explicación accesible. El detalle completo va
 * en `accessibilityLabel` para el lector de pantalla. No se usa la palabra
 * "verificado": en Scope significa autenticidad/integridad de credencial.
 */
export function ProvenanceIndicator({
  provenance
}: {
  provenance: HolderProfileProvenanceVM;
}) {
  return (
    <View style={styles.provenanceRow}>
      {provenance.issuerReviewedLabel ? (
        <View
          accessible
          accessibilityLabel={provenance.issuerReviewedLabel}
          style={[styles.provenancePill, styles.provenanceIssuer]}
        >
          <ScopeText
            variant="caption"
            style={{ color: colors.brand.navyStrong, fontSize: 10 }}
          >
            Emisor
          </ScopeText>
        </View>
      ) : null}
      {provenance.aiInferredLabel ? (
        <View
          accessible
          accessibilityLabel={provenance.aiInferredLabel}
          style={[styles.provenancePill, styles.provenanceAi]}
        >
          <ScopeText
            variant="caption"
            style={{ color: colors.brand.teal, fontSize: 10 }}
          >
            IA
          </ScopeText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Valor técnico (hash canónico, DID, transacción).
 *
 * Envuelve en varias líneas y es visualmente más silencioso que el contenido
 * formativo: la integridad importa, pero es secundaria (secciones 25 y 150).
 */
export function TechnicalValue({
  label,
  value,
  onCopy,
  copyAccessibilityLabel
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copyAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.technicalRow}>
      <ScopeText variant="overline" tone="muted">
        {label}
      </ScopeText>
      <View style={styles.technicalValueRow}>
        <ScopeText
          variant="technical"
          tone="default"
          style={styles.technicalValue}
          // Un hash largo se lee mejor por partes que carácter por carácter.
          accessibilityLabel={`${label}: ${value}`}
        >
          {value}
        </ScopeText>
        {onCopy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copyAccessibilityLabel ?? `Copiar ${label}`}
            onPress={onCopy}
            style={({ pressed }) => [
              styles.copyButton,
              pressed && styles.copyButtonPressed
            ]}
          >
            <Ionicons
              name="copy-outline"
              size={18}
              color={colors.brand.teal}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm
  },
  declaredList: {
    gap: spacing.sm
  },
  declaredItem: {
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  provenanceRow: {
    flexDirection: 'row',
    gap: spacing.xs
  },
  provenancePill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2
  },
  provenanceIssuer: {
    backgroundColor: colors.brand.tint
  },
  provenanceAi: {
    backgroundColor: colors.status.analysisSoft
  },
  technicalRow: {
    gap: spacing.xs
  },
  technicalValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm
  },
  technicalValue: {
    flex: 1
  },
  copyButton: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0
  },
  copyButtonPressed: {
    opacity: 0.6
  }
});
