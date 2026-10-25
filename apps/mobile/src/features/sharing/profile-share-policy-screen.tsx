import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ScopeButton } from '@/components/ui/button';
import { ScopeScreen } from '@/components/ui/screen';
import { ScopeCard, ScopeSection } from '@/components/ui/surfaces';
import { ScopeErrorState, ScopeLoadingState, ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import {
  getMyCredentialsRequest,
  getShareVerificationPolicyRequest,
  replaceShareVerificationPolicyRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { queryKeys } from '@/lib/query/query-client';
import { colors, radii, spacing } from '@/lib/theme/tokens';
import type { ShareVerificationPolicyVM } from '@/types/sharing';

interface PolicyDraft {
  enabled: boolean;
  credentialIds: string[];
}

function draftOf(policy: ShareVerificationPolicyVM): PolicyDraft {
  return { enabled: policy.enabled, credentialIds: policy.authorizedCredentialIds };
}

function sameDraft(left: PolicyDraft, right: PolicyDraft): boolean {
  if (left.enabled !== right.enabled || left.credentialIds.length !== right.credentialIds.length) {
    return false;
  }
  return left.credentialIds.every((id) => right.credentialIds.includes(id));
}

/**
 * Edición explícita del consentimiento contextual. Sólo se monta después de
 * leer la selección autoritativa: el PUT reemplaza el conjunto completo.
 */
export function ProfileSharePolicyScreen() {
  const rawShareId = useLocalSearchParams<{ shareId?: string | string[] }>().shareId;
  const shareId = typeof rawShareId === 'string' ? rawShareId.trim() : '';
  const request = useAuthenticatedRequest();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<ShareVerificationPolicyVM | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [loadedShareId, setLoadedShareId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const policy = useQuery({
    queryKey: queryKeys.profileSharePolicy(shareId),
    queryFn: () => getShareVerificationPolicyRequest(request, shareId),
    enabled: shareId.length > 0
  });
  const credentials = useQuery({
    queryKey: queryKeys.credentials,
    queryFn: () => getMyCredentialsRequest(request),
    enabled: shareId.length > 0
  });

  useEffect(() => {
    if (policy.data && loadedShareId !== shareId) {
      // React Query entrega un snapshot externo. Se difiere su adopción un
      // microtask para no encadenar un render dentro del efecto y para no
      // sobrescribir un borrador ya iniciado por la persona.
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setSaved(policy.data as ShareVerificationPolicyVM);
          setDraft(draftOf(policy.data as ShareVerificationPolicyVM));
          setLoadedShareId(shareId);
        }
      });
      return () => { cancelled = true; };
    }
  }, [loadedShareId, policy.data, shareId]);

  const credentialList = useMemo(() => credentials.data ?? [], [credentials.data]);
  const knownIds = useMemo(
    () => new Set(credentialList.map((credential) => credential.credentialReference)),
    [credentialList]
  );
  const unknownSavedIds = useMemo(
    () => (draft?.credentialIds ?? []).filter((id) => !knownIds.has(id)),
    [draft?.credentialIds, knownIds]
  );
  const dirty = saved !== null && draft !== null && !sameDraft(draft, draftOf(saved));
  const blocked = draft === null || (draft.enabled && draft.credentialIds.length === 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || unknownSavedIds.length > 0) throw new Error('unsafe-policy-state');
      return replaceShareVerificationPolicyRequest(request, shareId, draft);
    },
    onSuccess: async (next) => {
      setSaved(next);
      setDraft(draftOf(next));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.profileShares }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profileSharePolicy(shareId) })
      ]);
      setNotice('La configuración se guardó correctamente.');
    }
  });

  if (!shareId) {
    return <ScopeScreen><ScopeErrorState title="Enlace no válido" description="Volvé a la lista de enlaces e intentá nuevamente." /></ScopeScreen>;
  }

  if (policy.isError || credentials.isError) {
    return (
      <ScopeScreen>
        <ScopeErrorState
          title="No pudimos cargar la configuración"
          description="No se modificó ninguna autorización. Intentá nuevamente antes de editar."
          onRetry={() => void Promise.all([policy.refetch(), credentials.refetch()])}
        />
      </ScopeScreen>
    );
  }

  // Un error terminal siempre prevalece sobre la ausencia de datos locales.
  // Así un fallo inicial no puede quedar disfrazado de carga indefinida.
  if (policy.isLoading || credentials.isLoading || saved === null || draft === null || loadedShareId !== shareId) {
    return <ScopeScreen><ScopeLoadingState label="Cargando la configuración guardada" /></ScopeScreen>;
  }

  const toggleCredential = (credentialId: string, canAdd: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const selected = current.credentialIds.includes(credentialId);
      if (!selected && !canAdd) return current;
      return {
        ...current,
        credentialIds: selected
          ? current.credentialIds.filter((id) => id !== credentialId)
          : [...current.credentialIds, credentialId]
      };
    });
  };

  const confirmSave = () => {
    if (blocked || !dirty || save.isPending || unknownSavedIds.length > 0) return;
    Alert.alert(
      'Guardar configuración',
      'Al guardar se reemplazará la selección completa de este enlace por la que ves en pantalla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar', onPress: () => void save.mutateAsync().catch(() => setNotice('No pudimos guardar la configuración. La selección guardada no cambió.')) }
      ]
    );
  };

  return (
    <ScopeScreen>
      <ScopeSection
        title="Análisis contextual"
        description="Elegí qué credenciales puede usar Scope para este enlace cuando un tercero consulte su propio objetivo."
      >
        <View style={styles.stack}>
          {notice ? <ScopeNotice tone="info" title="Información"><ScopeText variant="small">{notice}</ScopeText></ScopeNotice> : null}
          {!saved.configured ? (
            <ScopeNotice tone="info" title="Sin configuración previa"><ScopeText variant="small">Todavía no guardaste una política para este enlace.</ScopeText></ScopeNotice>
          ) : null}
          <ScopeCard style={styles.stack}>
            <View style={styles.toggleRow}>
              <View style={styles.copy}>
                <ScopeText variant="smallStrong" tone="strong">Permitir análisis contextual</ScopeText>
                <ScopeText variant="caption" tone="muted">La autorización se aplica sólo a este enlace.</ScopeText>
              </View>
              <Switch
                value={draft.enabled}
                onValueChange={(enabled) => setDraft((current) => current ? { ...current, enabled } : current)}
                accessibilityLabel="Permitir análisis contextual"
              />
            </View>
            <ScopeText variant="small" tone="muted">
              No se guarda nada hasta que confirmes. Si activás esta opción, debés seleccionar al menos una credencial emitida.
            </ScopeText>
          </ScopeCard>

          <ScopeCard style={styles.stack}>
            <ScopeText variant="smallStrong" tone="strong">Credenciales autorizadas</ScopeText>
            {credentialList.length === 0 ? (
              <ScopeText variant="small" tone="muted">No tenés credenciales disponibles para mostrar.</ScopeText>
            ) : credentialList.map((credential) => {
              const selected = draft.credentialIds.includes(credential.credentialReference);
              const canAdd = credential.status === 'issued';
              return (
                <Pressable
                  key={credential.credentialReference}
                  accessibilityRole="checkbox"
                  accessibilityLabel={credential.title}
                  accessibilityState={{ checked: selected, disabled: !selected && !canAdd }}
                  disabled={!selected && !canAdd}
                  onPress={() => toggleCredential(credential.credentialReference, canAdd)}
                  style={[styles.credential, !selected && !canAdd && styles.disabled]}
                >
                  <View style={[styles.checkbox, selected && styles.checkboxSelected]} />
                  <View style={styles.copy}>
                    <ScopeText variant="smallStrong" tone="strong">{credential.title}</ScopeText>
                    <ScopeText variant="caption" tone="muted">{credential.issuerName} · {credential.statusLabel}</ScopeText>
                  </View>
                </Pressable>
              );
            })}
          </ScopeCard>

          {unknownSavedIds.length > 0 ? (
            <ScopeNotice tone="warning" title="Configuración sin confirmar"><ScopeText variant="small">No se puede editar hasta volver a cargar todas las credenciales autorizadas. No enviaremos una selección incompleta.</ScopeText></ScopeNotice>
          ) : null}
          {blocked ? <ScopeNotice tone="warning" title="Falta una selección"><ScopeText variant="small">Seleccioná al menos una credencial para habilitar el análisis contextual.</ScopeText></ScopeNotice> : null}
          {save.isError ? <ScopeNotice tone="warning" title="No se pudo guardar"><ScopeText variant="small">La configuración persistida no se confirmó como modificada. Volvé a cargar antes de intentar otra vez.</ScopeText></ScopeNotice> : null}

          <View style={styles.actions}>
            <ScopeButton label="Cancelar cambios" variant="secondary" disabled={!dirty || save.isPending} onPress={() => { setDraft(draftOf(saved)); setNotice('Se descartaron los cambios pendientes.'); }} />
            <ScopeButton label="Guardar configuración" disabled={!dirty || blocked || save.isPending || unknownSavedIds.length > 0} loading={save.isPending} loadingLabel="Guardando" onPress={confirmSave} />
            <ScopeButton label="Volver a enlaces" variant="ghost" disabled={save.isPending} onPress={() => router.back()} />
          </View>
        </View>
      </ScopeSection>
    </ScopeScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  actions: { gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
  credential: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: radii.control },
  checkbox: { width: 18, height: 18, borderWidth: 2, borderColor: colors.border.strong, borderRadius: 4 },
  checkboxSelected: { backgroundColor: colors.brand.teal, borderColor: colors.brand.teal },
  disabled: { opacity: 0.55 }
});
