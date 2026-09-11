import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScopeButton } from '@/components/ui/button';
import { ScopeScreen } from '@/components/ui/screen';
import { ScopeCard, ScopeSection } from '@/components/ui/surfaces';
import {
  ScopeEmptyState,
  ScopeErrorState,
  ScopeLoadingState,
  ScopeNotice,
  ScopeSkeletonBlock
} from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { CredentialCard } from '@/features/credentials/credential-card';
import { mapHolderError } from '@/features/credentials/holder-error-mapper';
import { useCredentials } from '@/features/credentials/use-credentials';
import { ProfilePanel } from '@/features/profile/profile-panel';
import {
  useCurrentProfile,
  useProfileRebuild
} from '@/features/profile/use-profile';
import { ShareAction } from '@/features/sharing/share-action';
import { useSession } from '@/lib/auth/session-provider';
import { useProfileShare } from '@/features/sharing/use-share';
import { colors, spacing } from '@/lib/theme/tokens';

/** Cuántas credenciales se anticipan en el perfil antes de "Ver todas". */
const CREDENTIAL_PREVIEW_COUNT = 2;

/**
 * Pantalla principal del titular: "Mi perfil formativo".
 *
 * Es el destino por defecto tras iniciar sesión. La promesa del producto es
 * entender la trayectoria, no almacenar tarjetas (sección 115 del encargo).
 *
 * Pull-to-refresh = RE-CONSULTAR el estado del servidor. Nunca reconstruye el
 * perfil: eso es una mutación aparte y explícita (sección 23).
 */
export function ProfileScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const profileQuery = useCurrentProfile();
  const credentialsQuery = useCredentials();
  const rebuild = useProfileRebuild();
  const share = useProfileShare();

  const refreshing =
    (profileQuery.isRefetching || credentialsQuery.isRefetching) &&
    !profileQuery.isLoading &&
    !credentialsQuery.isLoading;

  const onRefresh = useCallback(() => {
    void profileQuery.refetch();
    void credentialsQuery.refetch();
  }, [credentialsQuery, profileQuery]);

  const openCredential = useCallback(
    (credentialReference: string) => {
      router.push(`/credentials/${encodeURIComponent(credentialReference)}`);
    },
    [router]
  );

  const credentials = credentialsQuery.data ?? [];
  const issuedCount = credentials.filter(
    (credential) => credential.status === 'issued'
  ).length;
  // El fallback manual sólo se ofrece cuando ya sabemos que hay credenciales
  // emitidas: sin ellas no hay nada que recomponer, y el estado vacío de
  // "todavía no recibiste credenciales" explica mejor la situación.
  const canOfferRebuild = credentialsQuery.isSuccess && issuedCount > 0;
  const displayLabel =
    sessionState.status === 'authenticated'
      ? sessionState.currentUser.displayLabel
      : null;

  return (
    <ScopeScreen refreshing={refreshing} onRefresh={onRefresh}>
      <ProfileHeading displayLabel={displayLabel} />

      {profileQuery.isLoading ? (
        <View style={styles.skeletonGroup}>
          <ScopeSkeletonBlock height={190} />
          <ScopeSkeletonBlock height={120} />
        </View>
      ) : null}

      {profileQuery.isError ? (
        <ProfileErrorBlock
          error={profileQuery.error}
          onRetry={() => void profileQuery.refetch()}
          rebuildAction={
            canOfferRebuild ? <RebuildAction rebuild={rebuild} /> : null
          }
        />
      ) : null}

      {profileQuery.isSuccess && profileQuery.data ? (
        <>
          <ProfilePanel profile={profileQuery.data} />
          <ScopeSection
            title="Acciones de tu perfil"
            description="Compartir genera una vista pública resumida. Actualizar recompone tu perfil con la información ya disponible."
          >
            <ScopeCard style={styles.actionsCard}>
              <ShareAction
                testID="profile-share-action"
                label="Compartir perfil"
                description="Quien reciba el enlace verá una versión pública y resumida de tu perfil. No incluye tu email ni evidencias crudas."
                pending={share.pending}
                feedback={share.feedback}
                onShare={() => void share.share()}
                onCopyLink={() => void share.copyLink()}
                onOpenPublicView={() => void share.openPublicView()}
              />
              <RebuildAction rebuild={rebuild} />
            </ScopeCard>
          </ScopeSection>
        </>
      ) : null}

      {profileQuery.isSuccess && !profileQuery.data ? (
        <ScopeEmptyState
          icon="analytics-outline"
          title="Tu perfil todavía no está disponible"
          description="Scope construye tu perfil a partir de las credenciales que te emiten. El análisis semántico lo enriquece con áreas, habilidades y conceptos cuando está disponible."
          action={canOfferRebuild ? <RebuildAction rebuild={rebuild} /> : null}
        />
      ) : null}

      <ScopeSection
        title="Tus credenciales"
        description="Las credenciales que respaldan tu trayectoria."
        action={
          credentials.length > 0 ? (
            <ScopeButton
              variant="ghost"
              label="Ver todas"
              onPress={() => router.push('/credentials')}
              accessibilityHint="Abre la lista completa de tus credenciales"
            />
          ) : null
        }
      >
        {credentialsQuery.isLoading ? (
          <ScopeLoadingState label="Cargando credenciales" />
        ) : null}

        {credentialsQuery.isError ? (
          <CredentialsErrorBlock
            error={credentialsQuery.error}
            onRetry={() => void credentialsQuery.refetch()}
          />
        ) : null}

        {credentialsQuery.isSuccess && credentials.length === 0 ? (
          <ScopeEmptyState
            icon="document-text-outline"
            title="Todavía no tenés credenciales formativas"
            description="Cuando una institución emita una credencial a tu nombre, aparecerá en este espacio."
          />
        ) : null}

        {credentialsQuery.isSuccess && credentials.length > 0 ? (
          <View style={styles.credentialList}>
            {credentials
              .slice(0, CREDENTIAL_PREVIEW_COUNT)
              .map((credential) => (
                <CredentialCard
                  key={credential.credentialReference}
                  credential={credential}
                  onPress={openCredential}
                />
              ))}
          </View>
        ) : null}
      </ScopeSection>
    </ScopeScreen>
  );
}

function ProfileHeading({ displayLabel }: { displayLabel: string | null }) {
  return (
    <View style={styles.profileHeading}>
      <ScopeText variant="overline" tone="teal">
        Espacio personal
      </ScopeText>
      {displayLabel ? (
        <ScopeText testID="profile-current-user-label" variant="smallStrong" tone="strong">
          {displayLabel}
        </ScopeText>
      ) : null}
      <ScopeText variant="screenTitle" tone="strong" accessibilityRole="header">
        Mi perfil formativo
      </ScopeText>
      <ScopeText variant="small" tone="muted">
        Tu trayectoria construida a partir de tus credenciales y de los análisis disponibles en Scope.
      </ScopeText>
    </View>
  );
}

/**
 * "Actualizar perfil" con etiqueta explícita, nunca un icono de refresh
 * ambiguo (sección 177 del encargo).
 */
function RebuildAction({
  rebuild
}: {
  rebuild: ReturnType<typeof useProfileRebuild>;
}) {
  return (
    <View style={styles.rebuildBlock}>
      <ScopeButton
        testID="profile-rebuild-action"
        variant="secondary"
        label="Actualizar perfil"
        loadingLabel="Actualizando"
        loading={rebuild.pending}
        onPress={() => void rebuild.rebuild()}
        accessibilityHint="Recompone tu perfil con la información ya disponible en Scope"
      />
      {rebuild.error ? (
        <ScopeNotice tone="warning" title="No pudimos actualizar tu perfil">
          <ScopeText variant="small" style={{ color: colors.status.warning }}>
            {rebuild.error}
          </ScopeText>
        </ScopeNotice>
      ) : null}
    </View>
  );
}

function ProfileErrorBlock({
  error,
  onRetry,
  rebuildAction
}: {
  error: unknown;
  onRetry: () => void;
  rebuildAction: React.ReactNode;
}) {
  const state = mapHolderError(error, 'profile');

  return (
    <View style={styles.errorBlock}>
      <ScopeErrorState
        title={state.title}
        description={`${state.description} Tus credenciales siguen disponibles más abajo.`}
        onRetry={state.retryable ? onRetry : undefined}
      />
      {rebuildAction}
    </View>
  );
}

function CredentialsErrorBlock({
  error,
  onRetry
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const state = mapHolderError(error, 'credentials');

  return (
    <ScopeErrorState
      title={state.title}
      description={state.description}
      onRetry={state.retryable ? onRetry : undefined}
    />
  );
}

const styles = StyleSheet.create({
  profileHeading: {
    gap: spacing.xs
  },
  skeletonGroup: {
    gap: spacing.md
  },
  credentialList: {
    gap: spacing.md
  },
  actionsCard: {
    gap: spacing.lg
  },
  rebuildBlock: {
    gap: spacing.sm
  },
  errorBlock: {
    gap: spacing.md
  }
});
