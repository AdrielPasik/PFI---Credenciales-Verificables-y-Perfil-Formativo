import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { LatestObjectiveCard } from '@/features/profile/latest-objective-card';
import {
  ProfileCoverageNotice,
  ProfileTrajectory
} from '@/features/profile/profile-panel';
import {
  ProfileWelcomeBand,
  WELCOME_BAND_OVERLAP
} from '@/features/profile/profile-welcome-band';
import { useLatestObjective } from '@/features/profile/use-latest-objective';
import {
  useCurrentProfile,
  useProfileRebuild
} from '@/features/profile/use-profile';
import { useSession } from '@/lib/auth/session-provider';
import { useProfileShare } from '@/features/sharing/use-share';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { radii, spacing } from '@/lib/theme/tokens';

/** Cuántas credenciales se anticipan en el perfil antes de "Ver todas". */
const CREDENTIAL_PREVIEW_COUNT = 2;

/**
 * Pantalla principal del titular: el inicio.
 *
 * Es el destino por defecto tras iniciar sesión. La promesa del producto es
 * entender la trayectoria, no almacenar tarjetas (sección 115 del encargo).
 *
 * Orden: banda de bienvenida (saludo, métricas, acciones) -> objetivo
 * reciente, montado sobre el borde de la banda -> cobertura -> trayectoria ->
 * credenciales -> perfil público.
 *
 * Pull-to-refresh = RE-CONSULTAR el estado del servidor. Nunca reconstruye el
 * perfil: eso es una mutación aparte y explícita (sección 23).
 */
export function ProfileScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { state: sessionState } = useSession();
  const profileQuery = useCurrentProfile();
  const credentialsQuery = useCredentials();
  const latestObjective = useLatestObjective();
  const rebuild = useProfileRebuild();
  const share = useProfileShare();

  const refreshing =
    (profileQuery.isRefetching || credentialsQuery.isRefetching) &&
    !profileQuery.isLoading &&
    !credentialsQuery.isLoading;

  const onRefresh = useCallback(() => {
    void profileQuery.refetch();
    void credentialsQuery.refetch();
    latestObjective.refetch();
  }, [credentialsQuery, latestObjective, profileQuery]);

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
  const revokedCount = credentials.length - issuedCount;
  const analyzedCount = credentials.filter((credential) => credential.hasAnalysis).length;
  // El fallback manual sólo se ofrece cuando ya sabemos que hay credenciales
  // emitidas: sin ellas no hay nada que recomponer, y el estado vacío de
  // "todavía no recibiste credenciales" explica mejor la situación.
  const canOfferRebuild = credentialsQuery.isSuccess && issuedCount > 0;
  const displayLabel =
    sessionState.status === 'authenticated'
      ? sessionState.currentUser.displayLabel
      : null;
  const profile = profileQuery.isSuccess ? profileQuery.data : null;

  return (
    <>
      {/* La banda es oscura en los dos temas: mientras el inicio está a la
          vista, la barra de estado usa íconos claros. */}
      {focused ? <StatusBar style="light" /> : null}
      <ScopeScreen
        refreshing={refreshing}
        onRefresh={onRefresh}
        hero={
          <ProfileWelcomeBand
            displayLabel={displayLabel}
            profile={profile ?? null}
            sharePending={share.pending}
            onAnalyze={() => router.push('/objectives/new')}
            onShare={profile ? () => void share.share() : null}
          />
        }
      >
        <View style={styles.lifted}>
          <LatestObjectiveCard state={latestObjective.state} />
        </View>

        {profileQuery.isLoading ? (
          <View style={styles.skeletonGroup}>
            <ScopeSkeletonBlock height={72} />
            <ScopeSkeletonBlock height={160} />
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

        {profile ? (
          <>
            <ProfileCoverageNotice profile={profile} />
            <ProfileTrajectory
              profile={profile}
              footer={<RebuildAction rebuild={rebuild} />}
            />
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
          description={
            credentialsQuery.isSuccess && credentials.length > 0
              ? `${issuedCount} ${issuedCount === 1 ? 'emitida' : 'emitidas'} · ${revokedCount} ${revokedCount === 1 ? 'revocada' : 'revocadas'} · ${analyzedCount} con análisis. Son la base de evidencia de tu trayectoria.`
              : 'Estas credenciales forman la base de evidencia de tu trayectoria.'
          }
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

        {profile ? <PublicProfileSection share={share} /> : null}
      </ScopeScreen>
      {/* Fondo fijo detrás de la barra de estado: al desplazar, los íconos
          claros nunca quedan sobre el contenido claro. */}
      <View
        pointerEvents="none"
        style={[
          styles.statusScrim,
          { height: insets.top, backgroundColor: colors.band.start }
        ]}
      />
    </>
  );
}

/**
 * Perfil público. Compartir se inicia desde la banda; acá quedan las
 * acciones sobre ese enlace y su administración, con el mismo texto que
 * explica qué ve quien lo recibe.
 */
function PublicProfileSection({
  share
}: {
  share: ReturnType<typeof useProfileShare>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();

  return (
    <ScopeSection
      title="Perfil público"
      description="Quien reciba el enlace verá una versión pública y resumida de tu perfil. No incluye tu email ni evidencias crudas."
    >
      <ScopeCard style={styles.publicCard} testID="profile-public-section">
        <View style={styles.publicActions}>
          <ScopeButton
            variant="ghost"
            label="Copiar enlace"
            onPress={() => void share.copyLink()}
            disabled={share.pending}
            style={styles.leadingAction}
          />
          <ScopeButton
            variant="ghost"
            label="Ver vista pública"
            onPress={() => void share.openPublicView()}
            disabled={share.pending}
            accessibilityHint="Abre la vista pública en el navegador"
          />
        </View>
        {share.feedback.kind === 'copied' ? (
          <ScopeText variant="small" tone="success" accessibilityLiveRegion="polite">
            Enlace copiado.
          </ScopeText>
        ) : null}
        {share.feedback.kind === 'error' ? (
          <ScopeNotice tone="warning" title="No pudimos compartir">
            <ScopeText variant="small" style={{ color: colors.status.warning }}>
              {share.feedback.message}
            </ScopeText>
          </ScopeNotice>
        ) : null}
        <ScopeButton
          testID="profile-share-management"
          variant="secondary"
          fullWidth
          label="Gestionar enlaces compartidos"
          onPress={() => router.push('/profile-shares')}
          accessibilityHint="Consulta, recupera o revoca enlaces de tu perfil"
          icon={
            <Ionicons
              name="link-outline"
              size={18}
              color={colors.text.strong}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          }
        />
      </ScopeCard>
    </ScopeSection>
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
  const { colors } = useTheme();
  const styles = useStyles();
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
  const styles = useStyles();
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

const useStyles = makeStyles(() => ({
  statusScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0
  },
  lifted: {
    marginTop: -WELCOME_BAND_OVERLAP
  },
  skeletonGroup: {
    gap: spacing.md
  },
  credentialList: {
    gap: spacing.md
  },
  publicCard: {
    gap: spacing.sm,
    borderRadius: radii.card
  },
  publicActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs
  },
  leadingAction: {
    marginLeft: -spacing.lg
  },
  rebuildBlock: {
    gap: spacing.sm
  },
  errorBlock: {
    gap: spacing.md
  }
}));
