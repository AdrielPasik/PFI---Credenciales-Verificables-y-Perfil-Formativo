import { StyleSheet, View } from 'react-native';

import { ScopeText } from '@/components/ui/text';
import type { AppConfigError } from '@/lib/config/app-config';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';

/**
 * Arranque con configuración inválida o ausente.
 *
 * En desarrollo se muestra la variable exacta y el motivo, para que el
 * problema se resuelva en segundos. En una build de producción se muestra un
 * mensaje genérico: el detalle técnico de configuración no va a la persona
 * usuaria (sección 92 del encargo).
 *
 * Lo que NUNCA se hace es caer en silencio a `localhost`.
 */
export function ConfigErrorScreen({ error }: { error: AppConfigError }) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
          Scope no está configurado
        </ScopeText>
        {__DEV__ ? (
          <>
            <ScopeText variant="small" tone="muted">
              Falta configuración de entorno para conectar con el backend.
            </ScopeText>
            <View style={styles.detail}>
              <ScopeText variant="technical" tone="strong">
                {error.variableName}
              </ScopeText>
              <ScopeText variant="small" tone="muted">
                {error.reason}
              </ScopeText>
            </View>
            <ScopeText variant="caption" tone="subtle">
              Copiá `.env.example` a `.env` en `apps/mobile` y reiniciá el
              servidor de desarrollo con la caché limpia.
            </ScopeText>
          </>
        ) : (
          <ScopeText variant="small" tone="muted">
            No pudimos iniciar la aplicación. Volvé a intentar más tarde o
            actualizá Scope desde la tienda.
          </ScopeText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.screenPaddingHorizontal,
    backgroundColor: colors.surface.background
  },
  card: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card
  },
  detail: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.surface.muted
  }
});
