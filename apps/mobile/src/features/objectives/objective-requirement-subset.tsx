import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeCard } from '@/components/ui/surfaces';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import {
  buildSubsetObjectiveBody,
  MAX_OBJECTIVE_REQUIREMENTS
} from '@/features/objectives/review-draft';
import { createObjectiveRequest } from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { mapObjectiveCreateError } from '@/lib/errors/objective-error-mapper';
import { queryKeys } from '@/lib/query/query-client';
import { spacing } from '@/lib/theme/tokens';
import type { ObjectiveDetailVM } from '@/types/objectives';

/**
 * Objetivos guardados antes del tope de 15 requisitos — P0.
 *
 * Mismo contrato que la web: el objetivo original NO se toca (sus análisis
 * completados se siguen leyendo); se crea uno NUEVO con hasta 15 de sus
 * requisitos, exactos. Sin preselección por orden de aparición.
 */
export function ObjectiveRequirementSubset({
  objective
}: {
  objective: ObjectiveDetailVM;
}) {
  const router = useRouter();
  const request = useAuthenticatedRequest();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = selected.length >= MAX_OBJECTIVE_REQUIREMENTS;

  function toggle(requirementId: string) {
    setSelected((current) =>
      current.includes(requirementId)
        ? current.filter((id) => id !== requirementId)
        : current.length >= MAX_OBJECTIVE_REQUIREMENTS
          ? current
          : [...current, requirementId]
    );
  }

  async function create() {
    if (creating || selected.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createObjectiveRequest(
        request,
        buildSubsetObjectiveBody(objective, selected)
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.objectives });
      router.replace(
        `/objectives/${encodeURIComponent(created.objectiveReference)}`
      );
    } catch (requestError) {
      setError(mapObjectiveCreateError(requestError).message);
      setCreating(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScopeNotice
        tone="warning"
        title="Este objetivo tiene más requisitos de los que se analizan"
      >
        <ScopeText variant="small" testID="objective-subset-notice">
          Tiene {objective.requirements.length} requisitos y un análisis admite
          hasta {MAX_OBJECTIVE_REQUIREMENTS}. Podés seguir viendo este objetivo
          y sus análisis anteriores. Para analizarlo de nuevo, elegí hasta{' '}
          {MAX_OBJECTIVE_REQUIREMENTS} requisitos: se crea un objetivo nuevo y
          este queda como está.
        </ScopeText>
      </ScopeNotice>

      {open ? (
        <ScopeCard tone="muted" style={styles.card}>
          <ScopeText variant="small" testID="objective-subset-counter">
            {selected.length} de hasta {MAX_OBJECTIVE_REQUIREMENTS} elegidos
          </ScopeText>
          {objective.requirements.map((requirement) => {
            const checked = selected.includes(requirement.requirementId);
            const disabled = !checked && full;
            return (
              <Pressable
                key={requirement.requirementId}
                testID={`objective-subset-${requirement.requirementId}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                onPress={() => toggle(requirement.requirementId)}
                style={styles.row}
              >
                <ScopeText variant="small" tone={disabled ? 'subtle' : 'default'}>
                  {checked ? '☑' : '☐'} {requirement.requirementText}
                </ScopeText>
              </Pressable>
            );
          })}
          {error ? (
            <ScopeText variant="caption" tone="subtle">
              {error}
            </ScopeText>
          ) : null}
          <ScopeButton
            testID="objective-subset-create"
            fullWidth
            label="Crear objetivo con los elegidos"
            loadingLabel="Creando"
            loading={creating}
            disabled={selected.length === 0}
            onPress={() => void create()}
          />
          <ScopeButton
            testID="objective-subset-cancel"
            variant="ghost"
            fullWidth
            label="Cancelar"
            onPress={() => setOpen(false)}
          />
        </ScopeCard>
      ) : (
        <ScopeButton
          testID="objective-subset-open"
          variant="secondary"
          fullWidth
          label={`Elegir hasta ${MAX_OBJECTIVE_REQUIREMENTS} requisitos para analizar`}
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  card: { gap: spacing.sm },
  row: { paddingVertical: spacing.xs }
});
