import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { Alert, Linking, Share, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { ScopeButton } from '@/components/ui/button';
import { ScopeScreen } from '@/components/ui/screen';
import { ScopeCard, ScopeSection } from '@/components/ui/surfaces';
import { ScopeEmptyState, ScopeErrorState, ScopeLoadingState, ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import {
  createProfileShareRequest,
  listMyProfileSharesRequest,
  recoverProfileShareLinkRequest,
  revokeProfileShareRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { useAppConfig } from '@/lib/config/app-config-provider';
import { queryKeys } from '@/lib/query/query-client';
import { buildProfileShareMessage, buildProfileShareUrl, isSafeExternalUrl } from '@/features/sharing/share-links';
import { colors, spacing } from '@/lib/theme/tokens';
import type { ProfileShareSummaryVM } from '@/types/sharing';

/** Gestión holder-only: los tokens no se cargan ni persisten con la lista. */
export function ProfileShareManagementScreen() {
  const request = useAuthenticatedRequest();
  const { webBaseUrl } = useAppConfig();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: queryKeys.profileShares,
    queryFn: () => listMyProfileSharesRequest(request)
  });

  const create = useMutation({
    mutationFn: () => createProfileShareRequest(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profileShares });
      setNotice('Creaste un enlace nuevo. Podés administrarlo desde esta lista.');
    }
  });

  const recover = useCallback(
    async (share: ProfileShareSummaryVM) => {
      if (share.status !== 'ACTIVE') {
        setNotice('Este enlace ya no está disponible para recuperar.');
        return null;
      }

      const link = await recoverProfileShareLinkRequest(request, share.shareId);
      const url = link.shareUrl ?? buildProfileShareUrl(webBaseUrl, link.sharePath);
      if (!isSafeExternalUrl(url)) throw new Error('invalid-share-url');
      return url;
    },
    [request, webBaseUrl]
  );

  const revoke = useMutation({
    mutationFn: (shareId: string) => revokeProfileShareRequest(request, shareId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profileShares });
      setNotice('El enlace fue revocado. Ya no permite abrir el perfil compartido.');
    }
  });

  if (shares.isLoading) {
    return <ScopeScreen><ScopeLoadingState label="Cargando tus enlaces compartidos" /></ScopeScreen>;
  }

  if (shares.isError) {
    return (
      <ScopeScreen>
        <ScopeErrorState
          title="No pudimos cargar tus enlaces"
          description="Intentá nuevamente en unos minutos."
          onRetry={() => void shares.refetch()}
        />
      </ScopeScreen>
    );
  }

  const shareList = shares.data ?? [];

  return (
    <ScopeScreen refreshing={shares.isRefetching} onRefresh={() => void shares.refetch()}>
      <ScopeSection
        title="Enlaces compartidos"
        description="Cada enlace abre una versión pública y resumida de tu perfil. Copiarlo o compartirlo no crea otro enlace."
      >
        <View style={styles.stack}>
          {notice ? <ScopeNotice tone="info" title="Información"><ScopeText variant="small">{notice}</ScopeText></ScopeNotice> : null}
          {shareList.length === 0 ? (
            <ScopeEmptyState
              icon="share-social-outline"
              title="Todavía no compartiste tu perfil"
              description="Creá un enlace sólo cuando quieras dar acceso a una versión pública resumida de tu perfil."
            />
          ) : (
            shareList.map((share) => (
              <ShareCard
                key={share.shareId}
                share={share}
                recover={recover}
                revoke={revoke}
                onConfigurePolicy={() =>
                  router.push({
                    pathname: '/profile-shares/[shareId]/verification-policy',
                    params: { shareId: share.shareId }
                  })
                }
              />
            ))
          )}
          <ScopeButton
            testID="profile-shares-create"
            label="Crear nuevo enlace"
            variant="secondary"
            loading={create.isPending}
            loadingLabel="Creando"
            onPress={() => void create.mutateAsync().catch(() => setNotice('No pudimos crear el enlace. Intentá nuevamente.'))}
          />
        </View>
      </ScopeSection>
    </ScopeScreen>
  );
}

function ShareCard({
  share,
  recover,
  revoke,
  onConfigurePolicy
}: {
  share: ProfileShareSummaryVM;
  recover: (share: ProfileShareSummaryVM) => Promise<string | null>;
  revoke: ReturnType<typeof useMutation<void, Error, string>>;
  onConfigurePolicy: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = share.status === 'ACTIVE';

  const withRecoveredLink = useCallback(async (action: (url: string) => Promise<void>) => {
    if (busy || !active) return;
    setBusy(true);
    setMessage(null);
    try {
      const url = await recover(share);
      if (url !== null) await action(url);
    } catch {
      setMessage('No pudimos recuperar este enlace. Creá uno nuevo para volver a compartirlo.');
    } finally {
      setBusy(false);
    }
  }, [active, busy, recover, share]);

  const confirmRevoke = useCallback(() => {
    if (busy || !active || revoke.isPending) return;
    Alert.alert(
      'Revocar enlace',
      'Las personas que tengan este enlace ya no podrán abrir tu perfil compartido.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revocar enlace',
          style: 'destructive',
          onPress: () => void revoke.mutateAsync(share.shareId).catch(() =>
            setMessage('No pudimos revocar el enlace. Intentá nuevamente.')
          )
        }
      ]
    );
  }, [active, busy, revoke, share.shareId]);

  return (
    <ScopeCard style={styles.card}>
      <ScopeText variant="cardTitle" tone="strong">Enlace compartido</ScopeText>
      <ScopeText variant="smallStrong" tone={active ? 'success' : 'muted'}>{share.statusLabel}</ScopeText>
      <ScopeText variant="caption" tone="muted">Creado el {share.createdAtLabel}</ScopeText>
      {share.expiresAtLabel ? <ScopeText variant="caption" tone="muted">Vence el {share.expiresAtLabel}</ScopeText> : null}
      {share.revokedAtLabel ? <ScopeText variant="caption" tone="muted">Revocado el {share.revokedAtLabel}</ScopeText> : null}
      {share.lastUsedAtLabel ? <ScopeText variant="caption" tone="muted">Último uso: {share.lastUsedAtLabel}</ScopeText> : null}
      {active ? (
        <View style={styles.actions}>
          <ScopeButton label="Copiar enlace" variant="secondary" loading={busy} onPress={() => void withRecoveredLink(async (url) => { await Clipboard.setStringAsync(url); setMessage('Enlace copiado.'); })} />
          <ScopeButton label="Compartir" variant="secondary" disabled={busy} onPress={() => void withRecoveredLink(async (url) => { await Share.share({ message: buildProfileShareMessage(url), url }); })} />
          <ScopeButton label="Abrir en navegador" variant="ghost" disabled={busy} onPress={() => void withRecoveredLink(async (url) => { await Linking.openURL(url); })} />
          {share.supportsContextualVerification ? (
            <ScopeButton label="Configurar análisis contextual" variant="ghost" disabled={busy} onPress={onConfigurePolicy} />
          ) : null}
          <ScopeButton label="Revocar enlace" variant="ghost" disabled={busy || revoke.isPending} onPress={confirmRevoke} />
        </View>
      ) : (
        <ScopeText variant="small" tone="muted">Este enlace no puede recuperarse ni compartirse nuevamente.</ScopeText>
      )}
      {message ? <ScopeNotice tone="warning" title="No se pudo completar la acción"><ScopeText variant="small" style={{ color: colors.status.warning }}>{message}</ScopeText></ScopeNotice> : null}
    </ScopeCard>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { gap: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.xs }
});
