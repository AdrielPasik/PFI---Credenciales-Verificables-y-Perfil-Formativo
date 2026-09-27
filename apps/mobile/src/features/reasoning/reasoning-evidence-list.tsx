import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import { ScopeText } from '@/components/ui/text';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import {
  COVERAGE_NOTICES,
  groupEvidenceByCredential,
  SOURCE_KIND_LABELS,
  type ReasoningEvidenceVM
} from '@/types/reasoning-runs';

/**
 * Evidencia de un requisito, agrupada por credencial.
 *
 * La agrupación usa `credentialReference`, que es identidad AUTORITATIVA del
 * servidor. Nunca por título, emisor ni parecido: eso sería emparejamiento
 * heurístico en el cliente.
 *
 * Jerarquía de cada tarjeta:
 *   1. qué credencial     (título, emisor, tipo, estado actual)
 *   2. qué dice exactamente (la cita verbatim)
 *   3. dónde              (sección y página, cuando se conocen)
 *   4. ver la credencial
 *
 * NUNCA se muestran `sourceId`, `evidenceUnitId`, `src_NN`, `eu_NN`, offsets,
 * digests ni claves de storage: el DTO directamente no los transporta.
 */
export function ReasoningEvidenceList({
  evidence,
  onOpenCredential
}: {
  evidence: readonly ReasoningEvidenceVM[];
  onOpenCredential: (credentialReference: string) => void;
}) {
  const groups = groupEvidenceByCredential(evidence);

  return (
    <View style={styles.list}>
      {groups.map((group, groupIndex) => (
        <View
          key={`${group.credential?.credentialReference ?? 'sin-credencial'}-${groupIndex}`}
          style={styles.group}
          testID={`evidence-group-${groupIndex}`}
        >
          {group.credential ? (
            <View style={styles.credentialHeader}>
              <ScopeText variant="smallStrong" tone="strong">
                {group.credential.title}
              </ScopeText>
              <ScopeText variant="caption" tone="muted">
                {group.credential.issuerName} · {group.credential.credentialType}
              </ScopeText>
              <View style={styles.statusRow}>
                <ScopeBadge
                  label={group.credential.currentStatusLabel}
                  tone={
                    group.credential.currentStatus === 'revoked'
                      ? 'revoked'
                      : 'issued'
                  }
                />
                <ScopeText variant="caption" tone="subtle">
                  Estado actual de la credencial
                </ScopeText>
              </View>
            </View>
          ) : (
            <ScopeText variant="caption" tone="muted">
              Esta cita no pudo vincularse a una credencial concreta.
            </ScopeText>
          )}

          {group.items.map((item, index) => (
            <EvidenceItem key={`${groupIndex}-${index}`} evidence={item} />
          ))}

          {group.credential ? (
            <Pressable
              testID={`evidence-open-credential-${group.credential.credentialReference}`}
              accessibilityRole="button"
              accessibilityLabel={`Ver la credencial ${group.credential.title}`}
              onPress={() =>
                onOpenCredential(group.credential!.credentialReference)
              }
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <ScopeText variant="small" tone="teal">
                Ver credencial
              </ScopeText>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={colors.brand.teal}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function EvidenceItem({ evidence }: { evidence: ReasoningEvidenceVM }) {
  const location = [
    evidence.sectionLabel,
    // `pageNumber` null es legítimo y frecuente: toda fuente de texto lo tiene
    // así. No se sustituye por 1 ni por "desconocida".
    evidence.pageNumber === null ? null : `Página ${evidence.pageNumber}`
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const coverageNotice = COVERAGE_NOTICES[evidence.coverage];

  return (
    <View style={styles.evidenceBlock}>
      <View style={styles.excerpt}>
        <ScopeText variant="small" tone="default">
          {evidence.excerpt}
        </ScopeText>
      </View>

      <View style={styles.metaRow}>
        <ScopeText variant="caption" tone="subtle">
          {SOURCE_KIND_LABELS[evidence.sourceKind]}
          {location ? ` · ${location}` : ''}
        </ScopeText>
      </View>

      {coverageNotice ? (
        <ScopeText variant="caption" tone="warning">
          {coverageNotice}
        </ScopeText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md
  },
  group: {
    gap: spacing.sm,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.lg
  },
  credentialHeader: {
    gap: spacing.xs
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  evidenceBlock: {
    gap: spacing.xs
  },
  excerpt: {
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.cyan,
    backgroundColor: colors.surface.muted,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: layout.touchTarget
  },
  pressed: {
    opacity: 0.6
  }
});
