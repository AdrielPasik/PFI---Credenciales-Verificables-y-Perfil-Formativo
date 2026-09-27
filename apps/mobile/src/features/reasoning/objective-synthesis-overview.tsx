import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeText } from '@/components/ui/text';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import {
  CREDENTIAL_CURRENT_STATUS_LABELS,
  FINAL_STATE_LABELS,
  type ObjectiveSynthesisVM,
  type RequirementFinalState
} from '@/types/reasoning-runs';

/**
 * Síntesis del objetivo.
 *
 * El backend ya resolvió esta agregación de forma determinista y la entrega en
 * `synthesis` (`objective_synthesis_v1`). Acá NO se recalcula nada: no se
 * cuentan estados, no se derivan "fortalezas" y no se escriben conclusiones
 * nuevas. Se presenta exactamente lo que el servidor afirmó, en su orden.
 *
 * Los recuentos son DESCRIPTIVOS. No se dividen por el total, no se convierten
 * en porcentaje y no se comparan entre objetivos: "5 respaldados" describe la
 * evidencia; "78 % de compatibilidad" sería una afirmación sobre la persona que
 * el sistema no puede sostener.
 */

const VISIBLE_CONCLUSIONS = 3;

const STATE_DESCRIPTORS: {
  key: keyof ObjectiveSynthesisVM['stateSummary'];
  label: (count: number) => string;
}[] = [
  {
    key: 'supportedCount',
    label: (count) => `${count} ${count === 1 ? 'respaldado' : 'respaldados'}`
  },
  {
    key: 'partiallySupportedCount',
    label: (count) =>
      `${count} ${count === 1 ? 'respaldado parcialmente' : 'respaldados parcialmente'}`
  },
  {
    key: 'insufficientEvidenceCount',
    label: (count) => `${count} con evidencia insuficiente`
  },
  {
    key: 'abstainCount',
    label: (count) => `${count} sin conclusión confiable`
  },
  {
    key: 'notAssessableCount',
    label: (count) => `${count} no evaluables con evidencia formativa`
  }
];

function requirementNoun(count: number) {
  return count === 1 ? 'requisito' : 'requisitos';
}

/** Copy determinista, derivado sólo de los recuentos que trae el servidor. */
function overviewCopy(synthesis: ObjectiveSynthesisVM): string[] {
  const summary = synthesis.stateSummary;
  const total = Object.values(summary).reduce(
    (value, count) => value + count,
    0
  );

  if (total > 0 && summary.notAssessableCount === total) {
    return [
      'Los requisitos de este objetivo no pueden evaluarse con evidencia formativa disponible.'
    ];
  }

  if (summary.supportedCount > 0) {
    return [
      `Este análisis encontró respaldo formativo para ${summary.supportedCount} ${requirementNoun(summary.supportedCount)}${
        summary.partiallySupportedCount > 0
          ? ` y respaldo parcial para ${summary.partiallySupportedCount} ${requirementNoun(summary.partiallySupportedCount)}`
          : ''
      }.`
    ];
  }

  if (summary.partiallySupportedCount > 0) {
    return [
      `Este análisis encontró respaldo formativo parcial para ${summary.partiallySupportedCount} ${requirementNoun(summary.partiallySupportedCount)}.`
    ];
  }

  return [
    'Este análisis no identificó requisitos respaldados ni parcialmente respaldados con la evidencia formativa disponible.',
    'Esto describe únicamente la evidencia disponible en tus credenciales para este objetivo.'
  ];
}

export function ObjectiveSynthesisOverview({
  synthesis,
  completedAtLabel
}: {
  synthesis: ObjectiveSynthesisVM;
  completedAtLabel: string | null;
}) {
  const [showRemaining, setShowRemaining] = useState(false);

  const visibleConclusions = showRemaining
    ? synthesis.positiveConclusions
    : synthesis.positiveConclusions.slice(0, VISIBLE_CONCLUSIONS);
  const remaining =
    synthesis.positiveConclusions.length - visibleConclusions.length;

  return (
    <View style={styles.root} testID="objective-synthesis">
      <ScopeCard tone="inverse" style={styles.summaryCard}>
        <ScopeText
          variant="sectionTitle"
          tone="onInverse"
          accessibilityRole="header"
        >
          Resumen del análisis
        </ScopeText>

        {overviewCopy(synthesis).map((paragraph, index) => (
          <ScopeText key={index} variant="small" tone="onInverseMuted">
            {paragraph}
          </ScopeText>
        ))}

        <View style={styles.counters}>
          {STATE_DESCRIPTORS.filter(
            (descriptor) => synthesis.stateSummary[descriptor.key] > 0
          ).map((descriptor) => (
            <View key={descriptor.key} style={styles.counter}>
              <ScopeText variant="caption" tone="onInverse">
                {descriptor.label(synthesis.stateSummary[descriptor.key])}
              </ScopeText>
            </View>
          ))}
        </View>

        {completedAtLabel ? (
          <ScopeText variant="caption" tone="onInverseMuted">
            Analizado el {completedAtLabel}.
          </ScopeText>
        ) : null}
      </ScopeCard>

      {synthesis.positiveConclusions.length > 0 ? (
        <View style={styles.conclusions}>
          <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
            Lo que puede justificarse
          </ScopeText>

          {visibleConclusions.map((conclusion) => (
            <PositiveConclusion
              key={conclusion.requirementId}
              conclusion={conclusion}
              synthesis={synthesis}
            />
          ))}

          {remaining > 0 || showRemaining ? (
            <ScopeButton
              testID="synthesis-toggle-conclusions"
              variant="ghost"
              label={
                showRemaining
                  ? 'Ocultar conclusiones restantes'
                  : `Ver ${remaining} ${remaining === 1 ? 'conclusión' : 'conclusiones'} más`
              }
              onPress={() => setShowRemaining((value) => !value)}
            />
          ) : null}
        </View>
      ) : null}

      {synthesis.credentialsSupportingPositiveConclusions.length > 0 ? (
        <View style={styles.conclusions}>
          <ScopeText variant="sectionTitle" tone="strong" accessibilityRole="header">
            Credenciales que aportan respaldo
          </ScopeText>
          {synthesis.credentialsSupportingPositiveConclusions.map(
            (credential) => (
              <View
                key={credential.credentialReference}
                style={styles.credentialRow}
              >
                <ScopeText variant="smallStrong" tone="strong">
                  {credential.credentialDisplay.title}
                </ScopeText>
                <ScopeText variant="caption" tone="muted">
                  {credential.credentialDisplay.issuerName} ·{' '}
                  {credential.credentialDisplay.credentialType} ·{' '}
                  {CREDENTIAL_CURRENT_STATUS_LABELS[
                    credential.credentialDisplay.currentStatus
                  ] ?? credential.credentialDisplay.currentStatus}
                </ScopeText>
                <ScopeText variant="caption" tone="subtle">
                  {describeCredentialContribution(credential)}
                </ScopeText>
              </View>
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

function describeCredentialContribution(
  credential: ObjectiveSynthesisVM['credentialsSupportingPositiveConclusions'][number]
): string {
  const parts: string[] = [];
  const supported = credential.supportedRequirementIds.length;
  const partial = credential.partiallySupportedRequirementIds.length;

  if (supported > 0) {
    parts.push(`${supported} ${requirementNoun(supported)} respaldados`);
  }
  if (partial > 0) {
    parts.push(
      `${partial} ${requirementNoun(partial)} respaldados parcialmente`
    );
  }

  return `Aporta a ${parts.join(' y ')}.`;
}

function PositiveConclusion({
  conclusion,
  synthesis
}: {
  conclusion: ObjectiveSynthesisVM['positiveConclusions'][number];
  synthesis: ObjectiveSynthesisVM;
}) {
  // Se resuelve POR REFERENCIA contra lo que el servidor ya vinculó. Nunca por
  // título ni por parecido.
  const supportingCredentials = conclusion.supportingCredentialReferences
    .map((reference) =>
      synthesis.credentialsSupportingPositiveConclusions.find(
        (candidate) => candidate.credentialReference === reference
      )
    )
    .filter(
      (
        credential
      ): credential is ObjectiveSynthesisVM['credentialsSupportingPositiveConclusions'][number] =>
        credential !== undefined
    );

  return (
    <View
      style={styles.conclusionCard}
      testID={`synthesis-conclusion-${conclusion.requirementId}`}
    >
      <ScopeText variant="caption" tone="teal">
        {FINAL_STATE_LABELS[conclusion.finalState as RequirementFinalState]}
      </ScopeText>
      <ScopeText variant="bodyStrong" tone="strong">
        {conclusion.requirementText}
      </ScopeText>

      {conclusion.supportedWeakerClaim !== null ? (
        <View style={styles.weakerClaim}>
          <ScopeText variant="smallStrong" tone="strong">
            Lo que sí puede justificarse
          </ScopeText>
          <ScopeText variant="small" tone="default">
            {conclusion.supportedWeakerClaim}
          </ScopeText>
        </View>
      ) : null}

      {supportingCredentials.map((credential) => (
        <ScopeText
          key={credential.credentialReference}
          variant="caption"
          tone="muted"
        >
          {credential.credentialDisplay.title} ·{' '}
          {credential.credentialDisplay.issuerName}
        </ScopeText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xl
  },
  summaryCard: {
    gap: spacing.sm
  },
  counters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  counter: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border.onInverse,
    paddingHorizontal: spacing.md,
    paddingVertical: 4
  },
  conclusions: {
    gap: spacing.md
  },
  conclusionCard: {
    gap: spacing.xs,
    borderRadius: radii.card,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.lg
  },
  weakerClaim: {
    gap: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: colors.surface.muted,
    padding: spacing.md,
    marginTop: spacing.xs
  },
  credentialRow: {
    gap: spacing.xs,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.md
  }
});
