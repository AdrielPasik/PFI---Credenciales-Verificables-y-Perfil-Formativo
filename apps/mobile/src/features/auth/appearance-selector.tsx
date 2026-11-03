import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { ScopeText } from '@/components/ui/text';
import type { AppearancePreference } from '@/lib/theme/appearance-storage';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { layout, radii, spacing } from '@/lib/theme/tokens';

const OPTIONS: readonly {
  value: AppearancePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Claro', icon: 'sunny-outline' },
  { value: 'dark', label: 'Oscuro', icon: 'moon-outline' }
];

/**
 * Selector de apariencia del menú de cuenta.
 *
 * Es un grupo de opciones excluyentes: se anuncia como `radiogroup` y cada
 * opción como `radio` con su estado, y la opción elegida se distingue por
 * borde y fondo además del color (nunca sólo por color).
 */
export function AppearanceSelector() {
  const { colors, preference, setPreference } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <ScopeText variant="overline" tone="muted">
        Apariencia
      </ScopeText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Apariencia"
        style={styles.options}
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`appearance-${option.value}`}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => setPreference(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed
              ]}
            >
              <Ionicons
                name={option.icon}
                size={18}
                color={selected ? colors.brand.teal : colors.text.muted}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <ScopeText variant="smallStrong" tone={selected ? 'strong' : 'default'}>
                {option.label}
              </ScopeText>
            </Pressable>
          );
        })}
      </View>
      {preference === 'system' ? (
        <ScopeText variant="caption" tone="subtle">
          Sigue la configuración de apariencia del teléfono.
        </ScopeText>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.sm
  },
  options: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  option: {
    flex: 1,
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.sm
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: colors.brand.teal,
    backgroundColor: colors.brand.tint
  },
  pressed: {
    opacity: 0.8
  }
}));
