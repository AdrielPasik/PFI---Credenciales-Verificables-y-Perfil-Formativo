import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { ScopeText } from '@/components/ui/text';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';

export type ScopeButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ScopeButtonProps {
  label: string;
  onPress: () => void;
  variant?: ScopeButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Se anuncia al lector de pantalla cuando `loading` es true. */
  loadingLabel?: string;
  accessibilityHint?: string;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ScopeButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  loadingLabel,
  accessibilityHint,
  icon,
  fullWidth = false,
  style,
  testID
}: ScopeButtonProps) {
  const isDisabled = disabled || loading;
  const palette = PALETTE[variant];
  const visibleLabel = loading ? (loadingLabel ?? label) : label;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={visibleLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.background,
          borderColor: palette.border
        },
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={palette.foreground} />
        ) : (
          icon
        )}
        <ScopeText
          variant="bodyStrong"
          style={[styles.label, { color: palette.foreground }]}
        >
          {visibleLabel}
        </ScopeText>
      </View>
    </Pressable>
  );
}

const PALETTE: Record<
  ScopeButtonVariant,
  { background: string; border: string; foreground: string }
> = {
  primary: {
    background: colors.brand.navy,
    border: colors.brand.navy,
    foreground: colors.text.onInverse
  },
  secondary: {
    background: colors.surface.card,
    border: colors.border.strong,
    foreground: colors.text.strong
  },
  ghost: {
    background: 'transparent',
    border: 'transparent',
    foreground: colors.brand.teal
  }
};

const styles = StyleSheet.create({
  base: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  fullWidth: {
    alignSelf: 'stretch'
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm
  },
  label: {
    // Permite que el texto crezca con el escalado de fuente sin desbordar.
    flexShrink: 1,
    textAlign: 'center'
  },
  pressed: {
    opacity: 0.82
  },
  disabled: {
    opacity: 0.55
  }
});
