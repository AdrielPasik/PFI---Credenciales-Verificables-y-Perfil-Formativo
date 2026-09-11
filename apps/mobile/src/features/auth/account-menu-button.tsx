import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeButton } from '@/components/ui/button';
import { ScopeDivider } from '@/components/ui/surfaces';
import { ScopeText } from '@/components/ui/text';
import { useSession } from '@/lib/auth/session-provider';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';

/**
 * Menú de cuenta del encabezado.
 *
 * Cerrar sesión tiene que ser encontrable pero no dominante (sección 116):
 * vive detrás de un botón de cuenta con etiqueta accesible, junto a la
 * identidad de la persona, y no ocupa una pestaña propia.
 *
 * Se muestra sólo lo que el API realmente devuelve (`displayLabel`, `email`,
 * `did`): no se infiere un nombre a partir del correo (sección 196).
 */
export function AccountMenuButton() {
  const { state, logout } = useSession();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (state.status !== 'authenticated') return null;

  const { currentUser } = state;
  const showEmail =
    currentUser.displayLabel.trim().toLowerCase() !==
    currentUser.email.trim().toLowerCase();

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cuenta de ${currentUser.displayLabel}`}
        accessibilityHint="Abre la información de tu cuenta y la opción de cerrar sesión"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        testID="account-menu-button"
      >
        <Ionicons
          name="person-circle-outline"
          size={26}
          color={colors.brand.navy}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar el menú de cuenta"
          style={styles.backdrop}
          onPress={() => setOpen(false)}
        >
          <Pressable
            // Absorbe el toque para que tocar el panel no lo cierre.
            onPress={() => undefined}
            style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}
          >
            <View style={styles.handle} />
            <ScopeText variant="cardTitle" tone="strong" accessibilityRole="header">
              {currentUser.displayLabel}
            </ScopeText>
            {showEmail ? (
              <ScopeText variant="small" tone="muted">
                {currentUser.email}
              </ScopeText>
            ) : null}
            {currentUser.did ? (
              <>
                <ScopeText variant="overline" tone="muted">
                  Identificador descentralizado
                </ScopeText>
                <ScopeText variant="technical" tone="subtle">
                  {currentUser.did}
                </ScopeText>
              </>
            ) : null}

            <ScopeDivider style={styles.divider} />

            <ScopeButton
              testID="logout-button"
              fullWidth
              variant="secondary"
              label="Cerrar sesión"
              onPress={() => {
                setOpen(false);
                void logout();
              }}
              icon={
                <Ionicons
                  name="log-out-outline"
                  size={18}
                  color={colors.text.strong}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center'
  },
  pressed: {
    opacity: 0.6
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay
  },
  sheet: {
    gap: spacing.sm,
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
    backgroundColor: colors.border.strong,
    marginBottom: spacing.md
  },
  divider: {
    marginVertical: spacing.md
  }
});
