import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import { ScopeScreen } from '@/components/ui/screen';
import { ScopeCard, ScopeSection } from '@/components/ui/surfaces';
import {
  ScopeErrorState,
  ScopeLoadingState,
  ScopeSkeletonBlock
} from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { useObjectiveDetail } from '@/features/objectives/use-objectives';
import { ObjectiveReasoningPanel } from '@/features/reasoning/objective-reasoning-panel';
import { mapObjectiveReadError } from '@/lib/errors/objective-error-mapper';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import type { ObjectiveDetailVM } from '@/types/objectives';

/**
 * Objetivo persistido.
 *
 * JERARQUÍA: una vez que existe un análisis, el análisis es la capacidad
 * principal. Los requisitos confirmados y el texto original pasan a ser
 * material de referencia, plegado, para que la pantalla no sea un scroll
 * interminable.
 *
 *   1. identidad del objetivo
 *   2. análisis de trayectoria
 *   3. requisitos confirmados       (plegado)
 *   4. texto original del objetivo  (plegado)
 *
 * NUNCA se muestran `requirementId`, los enums de procedencia ni versiones de
 * schema.
 */
export function ObjectiveDetailScreen({
  objectiveReference
}: {
  objectiveReference: string;
}) {
  const query = useObjectiveDetail(objectiveReference);

  if (query.isLoading) {
    return (
      <ScopeScreen>
        <ScopeSkeletonBlock height={120} />
        <ScopeLoadingState label="Cargando el objetivo" />
      </ScopeScreen>
    );
  }

  if (query.isError) {
    return (
      <ScopeScreen>
        <ScopeErrorState
          title="No pudimos mostrar el objetivo"
          description={mapObjectiveReadError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </ScopeScreen>
    );
  }

  if (!query.data) return null;

  return <ObjectiveDetailView objective={query.data} />;
}

export function ObjectiveDetailView({
  objective
}: {
  objective: ObjectiveDetailVM;
}) {
  return (
    <ScopeScreen>
      <View style={styles.identity}>
        <ScopeBadge label={objective.objectiveTypeLabel} tone="neutral" />
        <ScopeText
          variant="screenTitle"
          tone="strong"
          accessibilityRole="header"
        >
          {objective.title}
        </ScopeText>
        <ScopeText variant="caption" tone="subtle">
          Confirmado el {objective.createdAtLabel} ·{' '}
          {objective.requirements.length}{' '}
          {objective.requirements.length === 1 ? 'requisito' : 'requisitos'}
        </ScopeText>
      </View>

      {/* El análisis es lo primero: es la capacidad que la persona vino a usar. */}
      <ObjectiveReasoningPanel
        objectiveReference={objective.objectiveReference}
      />

      <Disclosure
        testID="objective-requirements-disclosure"
        title="Requisitos confirmados"
        hint="Son los requisitos contra los que se analiza tu trayectoria."
      >
        <View style={styles.requirementList}>
          {objective.requirements.map((requirement, index) => (
            <View
              key={requirement.requirementId}
              style={styles.requirementRow}
              testID={`objective-requirement-${index}`}
            >
              <ScopeText variant="small" tone="default">
                {requirement.requirementText}
              </ScopeText>
              <ScopeText variant="caption" tone="subtle">
                {requirement.originLabel}
              </ScopeText>
              {requirement.sourceQuote !== null ? (
                <View style={styles.quote}>
                  <ScopeText variant="caption" tone="muted">
                    {requirement.sourceQuote}
                  </ScopeText>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Disclosure>

      {objective.sourceOriginalText !== null ? (
        <Disclosure
          testID="objective-source-disclosure"
          title="Texto original del objetivo"
          hint="El texto exacto que pegaste cuando preparaste este objetivo."
        >
          <ScopeCard tone="muted">
            <ScopeText variant="small" tone="muted">
              {objective.sourceOriginalText}
            </ScopeText>
          </ScopeCard>
        </Disclosure>
      ) : null}
    </ScopeScreen>
  );
}

function Disclosure({
  title,
  hint,
  children,
  testID
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  testID: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ScopeSection title={title} description={hint}>
      <ScopeCard tone="muted" style={styles.disclosureCard}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={title}
          accessibilityHint={expanded ? 'Oculta el contenido' : 'Muestra el contenido'}
          onPress={() => setExpanded((value) => !value)}
          style={styles.disclosureHeader}
        >
          <ScopeText variant="smallStrong" tone="strong" style={styles.flexOne}>
            {expanded ? 'Ocultar' : 'Ver'}
          </ScopeText>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.text.muted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
        {expanded ? children : null}
      </ScopeCard>
    </ScopeSection>
  );
}

const styles = StyleSheet.create({
  identity: {
    gap: spacing.sm
  },
  disclosureCard: {
    gap: spacing.md
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.touchTarget
  },
  flexOne: {
    flex: 1
  },
  requirementList: {
    gap: spacing.md
  },
  requirementRow: {
    gap: spacing.xs,
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.md
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.cyan,
    paddingLeft: spacing.sm,
    marginTop: spacing.xs
  }
});
