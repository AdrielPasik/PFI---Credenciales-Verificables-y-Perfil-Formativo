import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import {
  DeclaredTextList,
  TaxonomyList
} from '@/components/ui/content-lists';
import {
  ScopeCard,
  ScopeDivider,
  ScopeSection
} from '@/components/ui/surfaces';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { colors, spacing } from '@/lib/theme/tokens';
import type { HolderProfileVM } from '@/types/holder';

/**
 * Panel del perfil formativo.
 *
 * Jerarquía: resumen -> cobertura -> áreas -> habilidades -> conceptos ->
 * información declarada -> cómo se construye.
 *
 * Reglas epistemológicas que este panel preserva:
 *
 *  - la confianza describe la fiabilidad del ANÁLISIS, no el nivel de
 *    conocimiento de la persona;
 *  - la cobertura parcial es una limitación de la evidencia disponible,
 *    nunca una carencia del titular;
 *  - lo declarado por la institución y lo interpretado por IA se muestran
 *    como cosas distintas y nunca se mezclan;
 *  - no hay ningún puntaje inventado: sólo se muestra lo que el backend
 *    realmente provee (secciones 11, 26 y 119 del encargo).
 */
export function ProfilePanel({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo =
    profile.emittedSkills.length > 0 ||
    profile.emittedCompetencies.length > 0 ||
    profile.emittedLearningOutcomes.length > 0;

  const hasVisibleProvenance =
    profile.areas.some((area) => area.provenance) ||
    profile.skills.some((skill) => skill.provenance);

  const hasCoverageNotice = Boolean(
    profile.hoursCoverageNoticeLabel || profile.semanticCoverageNoticeLabel
  );

  return (
    <View style={styles.root}>
      <SummaryCard profile={profile} />

      {hasCoverageNotice ? (
        <ScopeNotice tone="warning" title="Cobertura del perfil">
          {profile.semanticCoverageNoticeLabel ? (
            <ScopeText variant="small" style={styles.coverageText}>
              {profile.semanticCoverageNoticeLabel}
            </ScopeText>
          ) : null}
          {profile.hoursCoverageNoticeLabel ? (
            <ScopeText variant="small" style={styles.coverageText}>
              {profile.hoursCoverageNoticeLabel}
            </ScopeText>
          ) : null}
          <ScopeText variant="caption" style={styles.coverageText}>
            La distribución por áreas se muestra sólo cuando hay evidencia
            suficiente.
          </ScopeText>
        </ScopeNotice>
      ) : null}

      <ScopeSection
        title="Áreas y habilidades"
        description="Interpretación construida a partir de la evidencia disponible."
      >
        <ScopeCard style={styles.listCard}>
          <TaxonomyList
            testID="profile-areas"
            title="Áreas principales"
            items={profile.areas.map((area) => ({
              key: area.label,
              label: area.label,
              metadata: area.estimatedHoursLabel,
              provenance: area.provenance
            }))}
            emptyLabel="Todavía no hay áreas con evidencia suficiente."
          />
          <ScopeDivider />
          <TaxonomyList
            testID="profile-skills"
            title="Habilidades del perfil"
            items={profile.skills.map((skill) => ({
              key: skill.label,
              label: skill.label,
              metadata: null,
              provenance: skill.provenance
            }))}
            emptyLabel="Todavía no hay habilidades disponibles."
          />
          <ScopeDivider />
          <TaxonomyList
            testID="profile-concepts"
            title="Conceptos relevantes"
            items={profile.concepts.map((concept) => ({
              key: concept,
              label: concept
            }))}
            emptyLabel="Todavía no hay conceptos disponibles."
          />
          {hasVisibleProvenance ? (
            <ScopeText variant="caption" tone="subtle">
              Emisor indica una interpretación revisada por la institución
              emisora. IA indica una interpretación realizada con inteligencia
              artificial.
            </ScopeText>
          ) : null}
        </ScopeCard>
      </ScopeSection>

      {hasDeclaredInstitutionalInfo ? (
        <ScopeSection
          title="Información declarada por instituciones"
          description="Proviene de credenciales emitidas. No es una certificación de la IA."
        >
          <ScopeCard style={styles.listCard}>
            <DeclaredTextList
              testID="profile-emitted-skills"
              title="Habilidades declaradas"
              items={profile.emittedSkills}
            />
            <DeclaredTextList
              testID="profile-emitted-competencies"
              title="Competencias declaradas"
              items={profile.emittedCompetencies}
            />
            <DeclaredTextList
              testID="profile-emitted-learning-outcomes"
              title="Contenido adicional declarado"
              items={profile.emittedLearningOutcomes}
            />
          </ScopeCard>
        </ScopeSection>
      ) : null}

      <ScopeCard tone="muted" style={styles.footerCard}>
        <ScopeText variant="smallStrong" tone="strong">
          Cómo se construye este perfil
        </ScopeText>
        <ScopeText variant="small" tone="muted">
          Resume áreas, habilidades y conceptos presentes en la información
          utilizada para construirlo.
        </ScopeText>
        {profile.reviewedInterpretationNoticeLabel ? (
          <ScopeText variant="small" tone="muted">
            {profile.reviewedInterpretationNoticeLabel}
          </ScopeText>
        ) : null}
        {profile.confidenceLabel ? (
          <ScopeText variant="small" tone="muted">
            Confianza del análisis: {profile.confidenceLabel}.
          </ScopeText>
        ) : null}
        {profile.qualityFlags.length > 0 ? (
          <ScopeText variant="small" tone="muted">
            Observaciones: {profile.qualityFlags.join(', ')}.
          </ScopeText>
        ) : null}
        <ScopeText variant="caption" tone="subtle">
          Actualizado el {profile.generatedAtLabel}.
        </ScopeText>
      </ScopeCard>
    </View>
  );
}

/**
 * Resumen de marca. Usa la superficie navy de Scope, pero acotada a una sola
 * tarjeta: el resto de la pantalla es clara. No es un "hero" de escritorio
 * escalado (secciones 21 y 147 del encargo).
 */
function SummaryCard({ profile }: { profile: HolderProfileVM }) {
  return (
    <ScopeCard tone="inverse" style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View style={styles.summaryIcon}>
          <Ionicons
            name="sparkles-outline"
            size={20}
            color={colors.brand.cyan}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </View>
        <ScopeBadge label="Perfil disponible" tone="inverse" />
      </View>

      <ScopeText variant="sectionTitle" tone="onInverse" accessibilityRole="header">
        Resumen del perfil
      </ScopeText>

      <ScopeText variant="small" tone="onInverseMuted">
        Reúne información de {profile.credentialsCount}{' '}
        {profile.credentialsCount === 1 ? 'credencial' : 'credenciales'}
        {profile.totalOfficialHoursLabel
          ? ` y ${profile.totalOfficialHoursLabel}`
          : ''}
        . La confianza describe la fiabilidad del análisis disponible, no tu
        nivel de conocimiento.
      </ScopeText>

      {profile.narrative ? (
        <ScopeText variant="body" tone="onInverse" style={styles.narrative}>
          {profile.narrative}
        </ScopeText>
      ) : null}

      <View style={styles.summaryStats}>
        <SummaryStat
          label="Credenciales"
          value={String(profile.credentialsCount)}
        />
        {profile.totalOfficialHoursLabel ? (
          <SummaryStat
            label="Horas oficiales declaradas"
            value={profile.totalOfficialHoursLabel}
            hint="Suma de horas informadas por las credenciales emitidas. No es una distribución por área."
          />
        ) : null}
        {profile.confidenceLabel ? (
          <SummaryStat
            label="Contexto del análisis"
            value={profile.confidenceLabel}
          />
        ) : null}
      </View>
    </ScopeCard>
  );
}

function SummaryStat({
  label,
  value,
  hint
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <View style={styles.summaryStat}>
      <ScopeText variant="overline" tone="onInverseMuted">
        {label}
      </ScopeText>
      <ScopeText variant="bodyStrong" tone="onInverse">
        {value}
      </ScopeText>
      {hint ? (
        <ScopeText variant="caption" tone="onInverseMuted">
          {hint}
        </ScopeText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xxl
  },
  summaryCard: {
    gap: spacing.md
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  summaryIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.onInverse,
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  },
  narrative: {
    marginTop: spacing.xs
  },
  summaryStats: {
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.onInverse
  },
  summaryStat: {
    gap: 2
  },
  listCard: {
    gap: spacing.lg
  },
  footerCard: {
    gap: spacing.sm
  },
  coverageText: {
    color: colors.status.warning
  }
});
