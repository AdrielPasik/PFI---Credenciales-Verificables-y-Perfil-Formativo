import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeText } from '@/components/ui/text';
import { colors, layout, spacing } from '@/lib/theme/tokens';

/**
 * Contenedor de pantalla.
 *
 * Resuelve de una sola vez el fondo, el padding horizontal, el ancho máximo
 * de lectura (para que en tablet el texto no se estire de borde a borde) y el
 * respeto del área segura inferior.
 *
 * El área segura superior la maneja el header de Expo Router; acá sólo se
 * agrega el inset inferior, que las barras de tabs no siempre cubren.
 */
export function ScopeScreen({
  children,
  scrollable = true,
  refreshing,
  onRefresh,
  contentContainerStyle
}: {
  children: ReactNode;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const bottomPadding = spacing.xxxl + insets.bottom;

  if (!scrollable) {
    return (
      <View style={[styles.root, styles.staticRoot, { paddingBottom: bottomPadding }]}>
        <View style={[styles.content, contentContainerStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: bottomPadding },
        contentContainerStyle
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={colors.brand.teal}
            colors={[colors.brand.teal]}
          />
        ) : undefined
      }
    >
      <View style={styles.content}>{children}</View>
    </ScrollView>
  );
}

/**
 * Encabezado de contenido. Es el ÚNICO título grande de la pantalla: la barra
 * de navegación usa una etiqueta corta ("Perfil") y el cuerpo el título de
 * producto ("Mi perfil formativo"), sin repetirlo tres veces.
 */
export function ScopeScreenHeading({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        {eyebrow ? (
          <ScopeText variant="overline" tone="teal">
            {eyebrow}
          </ScopeText>
        ) : null}
        <ScopeText
          variant="screenTitle"
          tone="strong"
          accessibilityRole="header"
        >
          {title}
        </ScopeText>
        {description ? (
          <ScopeText variant="small" tone="muted">
            {description}
          </ScopeText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface.background
  },
  staticRoot: {
    paddingTop: spacing.xl,
    paddingHorizontal: layout.screenPaddingHorizontal,
    alignItems: 'center'
  },
  scrollContent: {
    paddingTop: spacing.xl,
    paddingHorizontal: layout.screenPaddingHorizontal,
    alignItems: 'center'
  },
  content: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    gap: spacing.xxl
  },
  heading: {
    gap: spacing.md
  },
  headingText: {
    gap: spacing.xs
  }
});
