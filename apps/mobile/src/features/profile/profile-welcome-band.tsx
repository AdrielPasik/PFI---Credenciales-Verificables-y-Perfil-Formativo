import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScopeText } from '@/components/ui/text';
import { AccountMenuButton } from '@/features/auth/account-menu-button';
import { AmbientHalo } from '@/features/profile/ambient-halo';
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { layout, radii, spacing } from '@/lib/theme/tokens';
import type { HolderProfileVM } from '@/types/holder';

/** Lo que se ve debajo de la banda se monta sobre su borde inferior. */
export const WELCOME_BAND_OVERLAP = 36;

const FALLBACK_NARRATIVE =
  'Una vista de tu trayectoria construida a partir de tus credenciales y de los análisis disponibles en Scope.';

/**
 * Primer nombre para el saludo, a partir de la etiqueta que calcula el
 * backend. Si la etiqueta es un correo no se saluda con él: se usa el título
 * de producto. Mismo criterio que el inicio de Scope Web.
 */
export function greetingName(displayLabel: string | null): string | null {
  if (!displayLabel || displayLabel.includes('@')) return null;
  return displayLabel.trim().split(/\s+/)[0] || null;
}

/**
 * Banda de bienvenida del inicio del titular.
 *
 * Reemplaza al encabezado plano de la pestaña Perfil: saludo, frase del
 * perfil, tres métricas y las dos acciones principales sobre el degradado
 * azul tinta de Scope. Es la única superficie inversa grande de la pantalla;
 * lo demás vuelve al fondo del tema.
 *
 * Las métricas salen tal cual del perfil (credenciales, horas oficiales
 * declaradas y áreas principales). Sin perfil todavía, la banda saluda y
 * ofrece las acciones, pero no muestra cifras que no existen.
 */
export function ProfileWelcomeBand({
  displayLabel,
  profile,
  sharePending,
  onAnalyze,
  onShare
}: {
  displayLabel: string | null;
  profile: HolderProfileVM | null;
  sharePending: boolean;
  onAnalyze: () => void;
  onShare: (() => void) | null;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const firstName = greetingName(displayLabel);

  return (
    <View
      testID="profile-welcome-band"
      style={[styles.band, { paddingTop: insets.top + spacing.sm }]}
    >
      <AmbientHalo />

      <View style={styles.inner}>
        <View style={styles.topRow}>
          <View style={styles.wordmark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.wordmarkMark} />
            <ScopeText variant="bodyStrong" style={styles.wordmarkText}>
              Scope
            </ScopeText>
          </View>
          <AccountMenuButton tone="inverse" />
        </View>

        <View style={styles.heading}>
          <ScopeText variant="overline" style={styles.eyebrow}>
            {firstName ? 'Mi perfil formativo' : 'Espacio personal'}
          </ScopeText>
          <ScopeText
            testID="profile-greeting"
            variant="display"
            accessibilityRole="header"
            style={styles.greeting}
          >
            {firstName ? `Hola, ${firstName}` : 'Mi perfil formativo'}
          </ScopeText>
          <ScopeText variant="small" style={styles.narrative}>
            {profile?.narrative ?? FALLBACK_NARRATIVE}
          </ScopeText>
        </View>

        {profile ? (
          <View style={styles.metrics} testID="profile-metrics">
            <Metric
              value={String(profile.credentialsCount)}
              label={profile.credentialsCount === 1 ? 'credencial' : 'credenciales'}
            />
            {profile.totalOfficialHoursValue ? (
              <Metric
                value={`${profile.totalOfficialHoursValue} h`}
                label="oficiales"
                accessibilityLabel={profile.totalOfficialHoursLabel ?? undefined}
              />
            ) : null}
            <Metric
              value={String(profile.areas.length)}
              label={profile.areas.length === 1 ? 'área' : 'áreas'}
              accessibilityLabel={`${profile.areas.length} ${profile.areas.length === 1 ? 'área principal' : 'áreas principales'}`}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            testID="profile-analyze-objective"
            accessibilityRole="button"
            accessibilityLabel="Analizar un objetivo"
            accessibilityHint="Abre la pantalla para preparar un objetivo nuevo"
            onPress={onAnalyze}
            style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
          >
            <Ionicons
              name="compass-outline"
              size={18}
              color={colors.band.onAction}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <ScopeText variant="bodyStrong" style={styles.primaryLabel}>
              Analizar un objetivo
            </ScopeText>
          </Pressable>

          {onShare ? (
            <Pressable
              testID="profile-share-action"
              accessibilityRole="button"
              accessibilityLabel="Compartir perfil"
              accessibilityHint="Genera un enlace a una vista pública y resumida de tu perfil"
              accessibilityState={{ busy: sharePending, disabled: sharePending }}
              disabled={sharePending}
              onPress={onShare}
              style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
            >
              {sharePending ? (
                <ActivityIndicator size="small" color={colors.band.text} />
              ) : (
                <Ionicons
                  name="share-social-outline"
                  size={18}
                  color={colors.band.text}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              )}
              <ScopeText variant="bodyStrong" style={styles.secondaryLabel}>
                Compartir
              </ScopeText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Metric({
  value,
  label,
  accessibilityLabel
}: {
  value: string;
  label: string;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  return (
    <View
      style={styles.metric}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${value} ${label}`}
    >
      <ScopeText variant="screenTitle" style={styles.metricValue}>
        {value}
      </ScopeText>
      <ScopeText variant="caption" style={styles.metricLabel}>
        {label}
      </ScopeText>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  band: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderBottomLeftRadius: radii.dialog + 8,
    borderBottomRightRadius: radii.dialog + 8,
    paddingBottom: spacing.xxl + WELCOME_BAND_OVERLAP,
    backgroundColor: colors.band.end,
    experimental_backgroundImage: `linear-gradient(165deg, ${colors.band.start} 0%, ${colors.band.end} 100%)`
  },
  inner: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    paddingHorizontal: layout.screenPaddingHorizontal,
    gap: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: -spacing.sm
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  wordmarkMark: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: colors.band.action,
    experimental_backgroundImage: `linear-gradient(135deg, ${colors.band.action} 0%, ${colors.band.eyebrow} 100%)`
  },
  wordmarkText: {
    color: colors.band.text
  },
  heading: {
    gap: spacing.xs
  },
  eyebrow: {
    color: colors.band.eyebrow
  },
  greeting: {
    color: colors.band.text
  },
  narrative: {
    color: colors.band.muted,
    marginTop: spacing.xs
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  metric: {
    flex: 1,
    gap: 2,
    borderRadius: radii.control + 2,
    borderWidth: 1,
    borderColor: colors.band.tileBorder,
    backgroundColor: colors.band.tile,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2
  },
  metricValue: {
    color: colors.band.text,
    fontVariant: ['tabular-nums']
  },
  metricLabel: {
    color: colors.band.muted
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  button: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.control,
    borderWidth: 1,
    paddingHorizontal: spacing.lg
  },
  primary: {
    flex: 1,
    backgroundColor: colors.band.action,
    borderColor: colors.band.actionBorder
  },
  primaryLabel: {
    color: colors.band.onAction,
    flexShrink: 1
  },
  secondary: {
    backgroundColor: colors.band.secondary,
    borderColor: colors.band.secondaryBorder
  },
  secondaryLabel: {
    color: colors.band.text
  },
  pressed: {
    opacity: 0.82
  }
}));
