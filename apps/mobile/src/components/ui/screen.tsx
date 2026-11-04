import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeText } from '@/components/ui/text';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { layout, spacing } from '@/lib/theme/tokens';

/**
 * Contenedor de pantalla.
 *
 * Resuelve de una sola vez el fondo, el padding horizontal, el ancho máximo
 * de lectura (para que en tablet el texto no se estire de borde a borde) y el
 * respeto del área segura inferior.
 *
 * El área segura superior la maneja el header de Expo Router; acá sólo se
 * agrega el inset inferior, que las barras de tabs no siempre cubren.
 *
 * `hero` es una franja a todo el ancho que se desplaza con el contenido (la
 * banda de bienvenida del inicio). Cuando existe, la pantalla no tiene header
 * propio y el área segura superior pasa a ser responsabilidad de esa franja.
 */
export function ScopeScreen({
  children,
  scrollable = true,
  refreshing,
  onRefresh,
  contentContainerStyle,
  hero
}: {
  children: ReactNode;
  hero?: ReactNode;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
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
        hero ? styles.scrollContentWithHero : null,
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
      {hero}
      <View style={[styles.content, hero ? styles.contentWithHero : null]}>
        {children}
      </View>
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
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
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
  scrollContentWithHero: {
    paddingTop: 0,
    paddingHorizontal: 0
  },
  contentWithHero: {
    paddingHorizontal: layout.screenPaddingHorizontal
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
}));
