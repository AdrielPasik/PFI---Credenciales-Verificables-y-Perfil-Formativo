import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ScopeText } from '@/components/ui/text';
import { formatSectionLabel } from '@/features/objectives/review-draft';
import {
  colors,
  layout,
  radii,
  spacing,
  typography
} from '@/lib/theme/tokens';
import type { ReviewItem } from '@/types/objectives';

/**
 * Un requisito en revisión.
 *
 * REORDENAR CON BOTONES, no con arrastrar y soltar: el drag-and-drop accesible
 * exige una dependencia nueva y, sobre todo, no es operable con lector de
 * pantalla sin trabajo adicional. "Subir" y "Bajar" con etiqueta funcionan para
 * todo el mundo desde el primer día.
 *
 * ELIMINAR NO PIDE CONFIRMACIÓN: la semántica de producto es eliminar + deshacer,
 * y un diálogo encima de un deshacer sería fricción duplicada.
 *
 * NUNCA se muestran `candidateId`, offsets, el enum de grounding ni la versión
 * de schema.
 */
export function RequirementReviewItem({
  item,
  index,
  total,
  onEdit,
  onRemove,
  onMove,
  onShowSource
}: {
  item: ReviewItem;
  index: number;
  total: number;
  onEdit: (localKey: string, text: string) => void;
  onRemove: (localKey: string) => void;
  onMove: (localKey: string, direction: -1 | 1) => void;
  onShowSource: (item: ReviewItem) => void;
}) {
  const sectionLabel = formatSectionLabel(item.sourceSectionLabel);
  const position = `${index + 1} de ${total}`;

  return (
    <View style={styles.card} testID={`requirement-item-${item.localKey}`}>
      <View style={styles.header}>
        <ScopeText variant="overline" tone="muted">
          Requisito {position}
        </ScopeText>
        <View style={styles.originRow}>
          {item.origin === 'MANUAL' ? (
            <Tag label="Agregado por vos" tone="neutral" />
          ) : null}
          {item.isExactDuplicate ? (
            <Tag label="Repetido" tone="warning" />
          ) : null}
        </View>
      </View>

      <TextInput
        testID={`requirement-input-${item.localKey}`}
        accessibilityLabel={`Texto del requisito ${position}`}
        multiline
        value={item.text}
        onChangeText={(text) => onEdit(item.localKey, text)}
        placeholder="Escribí el requisito"
        placeholderTextColor={colors.text.subtle}
        style={styles.input}
      />

      {sectionLabel ? (
        <ScopeText variant="caption" tone="subtle">
          Sección del objetivo: {sectionLabel}
        </ScopeText>
      ) : null}

      <GroundingNotice item={item} />

      <View style={styles.actions}>
        {item.primaryExcerpt !== null ? (
          <ActionButton
            testID={`requirement-source-${item.localKey}`}
            icon="document-text-outline"
            label="Ver fragmento del objetivo"
            onPress={() => onShowSource(item)}
          />
        ) : null}

        <View style={styles.spacer} />

        <IconAction
          testID={`requirement-up-${item.localKey}`}
          icon="arrow-up"
          label={`Subir el requisito ${position}`}
          disabled={index === 0}
          onPress={() => onMove(item.localKey, -1)}
        />
        <IconAction
          testID={`requirement-down-${item.localKey}`}
          icon="arrow-down"
          label={`Bajar el requisito ${position}`}
          disabled={index === total - 1}
          onPress={() => onMove(item.localKey, 1)}
        />
        <IconAction
          testID={`requirement-remove-${item.localKey}`}
          icon="trash-outline"
          label={`Eliminar el requisito ${position}`}
          tone="error"
          onPress={() => onRemove(item.localKey)}
        />
      </View>
    </View>
  );
}

/**
 * Por qué este requisito puede o no confirmarse como derivado del objetivo.
 *
 * Es lenguaje humano: nunca `UNIQUE` / `AMBIGUOUS` / `NOT_FOUND`. Y nunca dice
 * que el requisito esté mal: dice si la cita ancla o no.
 */
function GroundingNotice({ item }: { item: ReviewItem }) {
  if (item.origin === 'MANUAL') return null;

  if (item.wasEverEdited) {
    return (
      <ScopeText variant="caption" tone="muted">
        Lo editaste, así que se va a guardar como escrito por vos.
      </ScopeText>
    );
  }

  if (item.grounding === 'AMBIGUOUS') {
    return (
      <ScopeText variant="caption" tone="muted">
        La cita aparece más de una vez en el objetivo, así que no se puede
        anclar a un lugar exacto.
      </ScopeText>
    );
  }

  if (item.grounding === 'NOT_FOUND' || item.primaryExcerpt === null) {
    return (
      <ScopeText variant="caption" tone="muted">
        No se encontró una cita literal en el objetivo para este requisito.
      </ScopeText>
    );
  }

  return null;
}

function Tag({
  label,
  tone
}: {
  label: string;
  tone: 'neutral' | 'warning';
}) {
  return (
    <View
      style={[
        styles.tag,
        tone === 'warning' ? styles.tagWarning : styles.tagNeutral
      ]}
    >
      <ScopeText
        variant="caption"
        style={{
          color:
            tone === 'warning' ? colors.status.warning : colors.status.neutral,
          fontSize: 11
        }}
      >
        {label}
      </ScopeText>
    </View>
  );
}

function ActionButton({
  testID,
  icon,
  label,
  onPress
}: {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
    >
      <Ionicons
        name={icon}
        size={15}
        color={colors.brand.teal}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <ScopeText variant="caption" tone="teal">
        Ver fragmento
      </ScopeText>
    </Pressable>
  );
}

function IconAction({
  testID,
  icon,
  label,
  onPress,
  disabled = false,
  tone = 'default'
}: {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'error';
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={tone === 'error' ? colors.status.error : colors.text.muted}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.lg
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap'
  },
  originRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap'
  },
  input: {
    minHeight: 72,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.muted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text.strong,
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily,
    textAlignVertical: 'top'
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs
  },
  spacer: {
    flex: 1
  },
  textAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.touchTarget,
    paddingRight: spacing.sm
  },
  iconAction: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: {
    opacity: 0.6
  },
  disabled: {
    opacity: 0.3
  },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2
  },
  tagNeutral: {
    backgroundColor: colors.status.neutralSoft
  },
  tagWarning: {
    backgroundColor: colors.status.warningSoft
  }
});
