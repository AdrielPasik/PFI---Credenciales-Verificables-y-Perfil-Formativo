import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeButton } from '@/components/ui/button';
import { ScopeText } from '@/components/ui/text';
import { splitAroundRange } from '@/features/objectives/review-draft';
import type { ObjectiveSourceRangeVM } from '@/types/objectives';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';

/**
 * Fragmento exacto del objetivo, con la opción de verlo en su contexto.
 *
 * DOS NIVELES:
 *   1. la cita literal sola;
 *   2. el objetivo completo con la cita resaltada.
 *
 * NUNCA se exponen `candidateId`, `charStart`, `charEnd`, `offsetUnit`, el
 * enum de grounding ni la versión de schema: son estado interno de la
 * propuesta, no información de producto.
 */
export function ObjectiveSourceSheet({
  visible,
  excerpt,
  range,
  sourceText,
  sectionLabel,
  onClose
}: {
  visible: boolean;
  excerpt: string | null;
  range: ObjectiveSourceRangeVM | null;
  sourceText: string;
  sectionLabel: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [showFullSource, setShowFullSource] = useState(false);

  /**
   * El corte es por CODE POINTS, no por unidades UTF-16.
   *
   * `String.prototype.slice` desplazaría el resaltado tras cualquier carácter
   * astral (un emoji pesa 2 unidades UTF-16 y 1 code point), así que la cita
   * quedaría marcada en el lugar equivocado. El backend ancla en code points y
   * acá se corta igual.
   */
  const highlighted = useMemo(() => {
    if (range === null) return null;
    return splitAroundRange(sourceText, range.start, range.end);
  }, [range, sourceText]);

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <ScopeText
              variant="cardTitle"
              tone="strong"
              accessibilityRole="header"
            >
              Fragmento del objetivo
            </ScopeText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar el fragmento"
              onPress={onClose}
              style={styles.close}
            >
              <ScopeText variant="small" tone="teal">
                Cerrar
              </ScopeText>
            </Pressable>
          </View>

          {sectionLabel ? (
            <ScopeText variant="caption" tone="muted">
              {sectionLabel}
            </ScopeText>
          ) : null}

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {!showFullSource ? (
              excerpt !== null ? (
                <View style={styles.excerptBlock}>
                  <ScopeText variant="body" tone="default" testID="objective-source-excerpt">
                    {excerpt}
                  </ScopeText>
                </View>
              ) : (
                <ScopeText variant="small" tone="muted">
                  Este requisito no tiene una cita literal del objetivo.
                </ScopeText>
              )
            ) : (
              <View style={styles.fullSource} testID="objective-source-full">
                {highlighted ? (
                  <ScopeText variant="small" tone="muted">
                    {highlighted.before}
                    <ScopeText variant="smallStrong" style={styles.mark}>
                      {highlighted.highlighted}
                    </ScopeText>
                    {highlighted.after}
                  </ScopeText>
                ) : (
                  <ScopeText variant="small" tone="muted">
                    {sourceText}
                  </ScopeText>
                )}
              </View>
            )}
          </ScrollView>

          {range !== null ? (
            <ScopeButton
              testID="objective-source-toggle"
              variant="secondary"
              fullWidth
              label={
                showFullSource
                  ? 'Ver sólo el fragmento'
                  : 'Ver en el objetivo completo'
              }
              onPress={() => setShowFullSource((value) => !value)}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay
  },
  sheet: {
    maxHeight: '85%',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopLeftRadius: radii.dialog,
    borderTopRightRadius: radii.dialog,
    backgroundColor: colors.surface.card
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border.strong
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  close: {
    minHeight: layout.touchTarget,
    minWidth: layout.touchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  scroll: {
    flexGrow: 0
  },
  scrollContent: {
    paddingBottom: spacing.md
  },
  excerptBlock: {
    borderRadius: radii.control,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.teal,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  fullSource: {
    borderRadius: radii.control,
    backgroundColor: colors.surface.muted,
    padding: spacing.md
  },
  mark: {
    color: colors.brand.navy,
    backgroundColor: colors.brand.cyan
  }
});
