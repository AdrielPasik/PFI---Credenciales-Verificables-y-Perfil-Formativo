import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import type { ShareFeedback } from '@/features/sharing/use-share';
import { colors, spacing } from '@/lib/theme/tokens';

/**
 * Acción de compartir.
 *
 * Interacción nativa: un botón primario que abre el share sheet del sistema y
 * dos acciones secundarias discretas (copiar / abrir la vista pública). No
 * reproduce el panel desplegable de Holder Web: es MOBILE-ADAPTED.
 *
 * El icono tiene siempre etiqueta visible: esconder el significado de
 * "compartir" detrás de un icono perjudicaría la descubribilidad
 * (sección 176 del encargo).
 */
export function ShareAction({
  label,
  description,
  pending,
  feedback,
  onShare,
  onCopyLink,
  onOpenPublicView,
  testID
}: {
  label: string;
  description: string;
  pending: boolean;
  feedback: ShareFeedback;
  onShare: () => void;
  onCopyLink: () => void;
  onOpenPublicView: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.root} testID={testID}>
      <ScopeButton
        label={label}
        loadingLabel="Preparando enlace"
        loading={pending}
        onPress={onShare}
        accessibilityHint={description}
        icon={
          <Ionicons
            name="share-social-outline"
            size={18}
            color={colors.text.onInverse}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        }
      />
      <View style={styles.secondaryRow}>
        <ScopeButton
          variant="ghost"
          label="Copiar enlace"
          onPress={onCopyLink}
          disabled={pending}
        />
        <ScopeButton
          variant="ghost"
          label="Ver vista pública"
          onPress={onOpenPublicView}
          disabled={pending}
          accessibilityHint="Abre la vista pública en el navegador"
        />
      </View>
      <ScopeText variant="caption" tone="subtle">
        {description}
      </ScopeText>
      {feedback.kind === 'copied' ? (
        <ScopeText
          variant="small"
          tone="success"
          accessibilityLiveRegion="polite"
        >
          Enlace copiado.
        </ScopeText>
      ) : null}
      {feedback.kind === 'error' ? (
        <ScopeNotice tone="warning" title="No pudimos compartir">
          <ScopeText variant="small" style={{ color: colors.status.warning }}>
            {feedback.message}
          </ScopeText>
        </ScopeNotice>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm
  },
  secondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: -spacing.lg
  }
});
