import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeText } from '@/components/ui/text';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';

export type ScopeNoticeTone = 'warning' | 'error' | 'info' | 'success';

const NOTICE_STYLES: Record<
  ScopeNoticeTone,
  { background: string; border: string; text: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  warning: {
    background: colors.status.warningSoft,
    border: colors.status.warningBorder,
    text: colors.status.warning,
    icon: 'alert-circle-outline'
  },
  error: {
    background: colors.status.errorSoft,
    border: colors.status.errorBorder,
    text: colors.status.error,
    icon: 'close-circle-outline'
  },
  info: {
    background: colors.brand.tint,
    border: colors.brand.cyan,
    text: colors.brand.navyStrong,
    icon: 'information-circle-outline'
  },
  success: {
    background: colors.status.successSoft,
    border: colors.status.success,
    text: colors.status.success,
    icon: 'checkmark-circle-outline'
  }
};

/** Aviso inline. El icono refuerza, nunca reemplaza al texto. */
export function ScopeNotice({
  tone = 'warning',
  title,
  children,
  action
}: {
  tone?: ScopeNoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const palette = NOTICE_STYLES[tone];

  return (
    <View
      accessible
      accessibilityRole="alert"
      style={[
        styles.notice,
        { backgroundColor: palette.background, borderColor: palette.border }
      ]}
    >
      <View style={styles.noticeHeading}>
        <Ionicons
          name={palette.icon}
          size={18}
          color={palette.text}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <ScopeText variant="bodyStrong" style={{ color: palette.text, flexShrink: 1 }}>
          {title}
        </ScopeText>
      </View>
      {children ? <View style={styles.noticeBody}>{children}</View> : null}
      {action ? <View style={styles.noticeAction}>{action}</View> : null}
    </View>
  );
}

/**
 * Carga inicial. Se usa sólo cuando todavía no hay nada que mostrar: un
 * refetch no debe bloquear la pantalla entera (sección 37 del encargo).
 */
export function ScopeLoadingState({ label }: { label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
      <ActivityIndicator color={colors.brand.teal} />
      <ScopeText variant="small" tone="muted">
        {label}
      </ScopeText>
    </View>
  );
}

/** Bloque de esqueleto, para evitar saltos de layout al cargar. */
export function ScopeSkeletonBlock({ height = 96 }: { height?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { height }]}
    />
  );
}

export function ScopeEmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  action
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <ScopeCard style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Ionicons
          name={icon}
          size={22}
          color={colors.brand.teal}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <ScopeText variant="cardTitle" tone="strong" accessibilityRole="header">
        {title}
      </ScopeText>
      <ScopeText variant="small" tone="muted">
        {description}
      </ScopeText>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </ScopeCard>
  );
}

export function ScopeErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Reintentar'
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <ScopeNotice
      tone="error"
      title={title}
      action={
        onRetry ? (
          <ScopeButton
            variant="secondary"
            label={retryLabel}
            onPress={onRetry}
          />
        ) : null
      }
    >
      <ScopeText variant="small" style={{ color: colors.status.error }}>
        {description}
      </ScopeText>
    </ScopeNotice>
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: spacing.sm,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  noticeHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  noticeBody: {
    gap: spacing.xs
  },
  noticeAction: {
    marginTop: spacing.xs
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card
  },
  skeleton: {
    borderRadius: radii.card,
    backgroundColor: colors.border.default,
    opacity: 0.5
  },
  emptyCard: {
    gap: spacing.sm
  },
  emptyIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.surface.muted
  },
  emptyAction: {
    marginTop: spacing.md
  }
});
