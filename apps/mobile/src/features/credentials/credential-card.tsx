import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import { ScopeText } from '@/components/ui/text';
import {
  colors,
  elevation,
  layout,
  radii,
  spacing
} from '@/lib/theme/tokens';
import type { HolderCredentialListItemVM } from '@/types/holder';

/**
 * Tarjeta de credencial.
 *
 * La tarjeta ENTERA navega al detalle: en táctil, obligar a apuntar a un
 * "Ver" chico sería un objetivo pobre (sección 178 del encargo). El rol y la
 * etiqueta accesibles describen la credencial completa, no "botón".
 *
 * Una credencial revocada se marca con claridad pero NO se atenúa hasta
 * volverse ilegible: sigue siendo información que el titular puede consultar
 * (secciones 121 y 179).
 */
export function CredentialCard({
  credential,
  onPress
}: {
  credential: HolderCredentialListItemVM;
  onPress: (credentialReference: string) => void;
}) {
  const revoked = credential.status === 'revoked';
  const accessibilityLabel = [
    credential.title,
    credential.typeLabel,
    `Emitida por ${credential.issuerName}`,
    credential.statusLabel,
    credential.issuedAtLabel
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Abre el detalle de la credencial"
      onPress={() => onPress(credential.credentialReference)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      testID={`credential-card-${credential.credentialReference}`}
    >
      <View
        style={[
          styles.statusStripe,
          { backgroundColor: revoked ? colors.status.revoked : colors.brand.teal }
        ]}
      />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <ScopeBadge
            label={credential.statusLabel}
            tone={revoked ? 'revoked' : 'issued'}
          />
          <ScopeText variant="caption" tone="muted" style={styles.typeLabel}>
            {credential.typeLabel}
          </ScopeText>
        </View>

        <View style={styles.identity}>
          <ScopeText variant="cardTitle" tone="strong">
            {credential.title}
          </ScopeText>
          <ScopeText variant="small" tone="muted">
            Emitida por {credential.issuerName}
          </ScopeText>
        </View>

        <View style={styles.metaRow}>
          {credential.issuedAtLabel ? (
            <ScopeText variant="caption" tone="subtle">
              {credential.issuedAtLabel}
            </ScopeText>
          ) : null}
          {credential.hasIntegrityEvidence ? (
            <MetaTag icon="shield-checkmark-outline" label="Integridad" />
          ) : null}
          {credential.hasAnalysis ? (
            <MetaTag icon="sparkles-outline" label="Con análisis" />
          ) : null}
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.text.subtle}
        style={styles.chevron}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

function MetaTag({
  icon,
  label
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.metaTag}>
      <Ionicons
        name={icon}
        size={13}
        color={colors.brand.teal}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <ScopeText variant="caption" tone="muted">
        {label}
      </ScopeText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    ...elevation.card
  },
  cardPressed: {
    borderColor: colors.brand.teal,
    opacity: 0.92
  },
  statusStripe: {
    width: 4,
    alignSelf: 'stretch'
  },
  body: {
    flex: 1,
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  typeLabel: {
    flexShrink: 1
  },
  identity: {
    gap: spacing.xs
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md
  },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  chevron: {
    marginRight: spacing.md
  }
});
