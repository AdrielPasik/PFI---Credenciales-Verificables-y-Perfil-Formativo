import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { colors, typography } from '@/lib/theme/tokens';

export type ScopeTextVariant = keyof typeof typography;
export type ScopeTextTone =
  | 'strong'
  | 'default'
  | 'muted'
  | 'subtle'
  | 'teal'
  | 'onInverse'
  | 'onInverseMuted'
  | 'warning'
  | 'error'
  | 'success';

const TONE_COLORS: Record<ScopeTextTone, string> = {
  strong: colors.text.strong,
  default: colors.text.default,
  muted: colors.text.muted,
  subtle: colors.text.subtle,
  teal: colors.brand.teal,
  onInverse: colors.text.onInverse,
  onInverseMuted: colors.text.onInverseMuted,
  warning: colors.status.warning,
  error: colors.status.error,
  success: colors.status.success
};

export interface ScopeTextProps extends TextProps {
  variant?: ScopeTextVariant;
  tone?: ScopeTextTone;
}

/**
 * Único componente de texto de la app.
 *
 * No fija alturas: el texto debe poder crecer con el escalado de fuente del
 * sistema sin romper el layout (sección 33 del encargo).
 */
export function ScopeText({
  variant = 'body',
  tone = 'default',
  style,
  ...props
}: ScopeTextProps) {
  const variantStyle = typography[variant] as TextStyle;

  return (
    <RNText
      {...props}
      style={[variantStyle, { color: TONE_COLORS[tone] }, style]}
    />
  );
}
