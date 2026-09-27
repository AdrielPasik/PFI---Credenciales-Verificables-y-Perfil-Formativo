import { StyleSheet, View } from 'react-native';

import { ScopeBadge, type ScopeBadgeTone } from '@/components/ui/badge';
import { ScopeText } from '@/components/ui/text';
import { evidencePresentationFor } from '@/features/reasoning/evidence-presentation';
import { ReasoningEvidenceList } from '@/features/reasoning/reasoning-evidence-list';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import {
  FINAL_STATE_DESCRIPTIONS,
  FINAL_STATE_LABELS,
  type RequirementFinalState,
  type RequirementResultVM
} from '@/types/reasoning-runs';

/**
 * Resultado de UN requisito.
 *
 * El lenguaje se compone de forma determinista desde tres campos estructurados
 * —`finalState`, `supportedWeakerClaim` y `evidence[]`—. Nada se parsea y nada
 * se infiere: el contrato NO trae `explanation` y esta capa no lo espera.
 *
 * NUNCA dice qué le falta a la persona. Describe qué puede justificarse con la
 * evidencia disponible.
 */

/** Tono por estado. El color acompaña al texto; nunca lo reemplaza. */
const STATE_TONES: Record<RequirementFinalState, ScopeBadgeTone> = {
  SUPPORTED: 'issued',
  PARTIALLY_SUPPORTED: 'analysis',
  INSUFFICIENT_EVIDENCE: 'neutral',
  NOT_ASSESSABLE: 'neutral',
  ABSTAIN: 'warning'
};

export function RequirementResultCard({
  result,
  index,
  onOpenCredential
}: {
  result: RequirementResultVM;
  index: number;
  onOpenCredential: (credentialReference: string) => void;
}) {
  const presentation = evidencePresentationFor(
    result.finalState,
    result.evidence.length
  );

  return (
    <View
      style={styles.card}
      testID={`requirement-result-${result.requirementId}`}
    >
      <View style={styles.header}>
        <ScopeText variant="overline" tone="muted">
          Requisito {index + 1}
        </ScopeText>
        <ScopeBadge
          label={FINAL_STATE_LABELS[result.finalState]}
          tone={STATE_TONES[result.finalState]}
        />
      </View>

      <ScopeText variant="bodyStrong" tone="strong">
        {result.requirementText}
      </ScopeText>

      <ScopeText variant="small" tone="muted">
        {FINAL_STATE_DESCRIPTIONS[result.finalState]}
      </ScopeText>

      {/* Sólo aparece cuando el backend lo entregó. Nunca se infiere la parte
          que NO quedó respaldada. */}
      {result.supportedWeakerClaim !== null ? (
        <View
          style={styles.weakerClaim}
          testID={`weaker-claim-${result.requirementId}`}
        >
          <ScopeText variant="smallStrong" tone="strong">
            Lo que sí puede justificarse con la evidencia disponible
          </ScopeText>
          <ScopeText variant="small" tone="default">
            {result.supportedWeakerClaim}
          </ScopeText>
        </View>
      ) : null}

      {presentation.visible ? (
        <View style={styles.evidenceSection}>
          <ScopeText variant="smallStrong" tone="strong">
            {presentation.heading}
          </ScopeText>
          {presentation.clarification ? (
            <ScopeText variant="caption" tone="muted">
              {presentation.clarification}
            </ScopeText>
          ) : null}
          <ReasoningEvidenceList
            evidence={result.evidence}
            onOpenCredential={onOpenCredential}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.lg
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  weakerClaim: {
    gap: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: colors.surface.muted,
    padding: spacing.md
  },
  evidenceSection: {
    gap: spacing.sm,
    marginTop: spacing.sm
  }
});
