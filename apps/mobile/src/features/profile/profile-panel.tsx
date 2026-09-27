import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import {
  DeclaredTextList,
  TaxonomyList,
  type TaxonomyItem
} from '@/components/ui/content-lists';
import {
  ScopeCard,
  ScopeDivider,
  ScopeSection
} from '@/components/ui/surfaces';
import { ScopeNotice } from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { colors, layout, spacing } from '@/lib/theme/tokens';
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
/**
 * Cuántas etiquetas se muestran de entrada en cada taxonomía.
 *
 * Los mismos valores que Holder Web, para que las dos superficies muestren
 * el mismo nivel de detalle por defecto. Lo que queda afuera NO se descarta:
 * vive en el detalle desplegable, completo y en el orden del backend.
 */
const PRIMARY_AREAS_LIMIT = 6;
const PRIMARY_SKILLS_LIMIT = 12;

export function ProfilePanel({ profile }: { profile: HolderProfileVM }) {
  const hasDeclaredInstitutionalInfo =
    profile.emittedSkills.length > 0 ||
    profile.emittedCompetencies.length > 0 ||
    profile.emittedLearningOutcomes.length > 0;

  const hasVisibleProvenance =
    profile.areas.some((area) => area.provenance) ||
    profile.skills.some((skill) => skill.provenance);

  const areaItems: TaxonomyItem[] = profile.areas.map((area) => ({
    key: area.label,
    label: area.label,
    metadata: area.estimatedHoursLabel,
    provenance: area.provenance
  }));
  const skillItems: TaxonomyItem[] = profile.skills.map((skill) => ({
    key: skill.label,
    label: skill.label,
    metadata: null,
    provenance: skill.provenance
  }));
  const conceptItems: TaxonomyItem[] = profile.concepts.map((concept) => ({
    key: concept,
    label: concept
  }));
  const remainingAreas = Math.max(0, areaItems.length - PRIMARY_AREAS_LIMIT);
  const remainingSkills = Math.max(0, skillItems.length - PRIMARY_SKILLS_LIMIT);

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
        description="Una vista resumida de los contenidos que aparecen en tus credenciales y análisis."
      >
        <ScopeCard style={styles.listCard}>
          <TaxonomyList
            testID="profile-areas"
            title="Áreas principales"
            items={areaItems.slice(0, PRIMARY_AREAS_LIMIT)}
            emptyLabel="Todavía no hay áreas con evidencia suficiente."
          />
          {remainingAreas > 0 ? (
            <ScopeText variant="caption" tone="subtle">
              + {remainingAreas} más en el detalle del perfil.
            </ScopeText>
          ) : null}
          <ScopeDivider />
          <TaxonomyList
            testID="profile-skills"
            title="Habilidades identificadas"
            items={skillItems.slice(0, PRIMARY_SKILLS_LIMIT)}
            emptyLabel="Todavía no hay habilidades disponibles."
          />
          {remainingSkills > 0 ? (
            <ScopeText variant="caption" tone="subtle">
              + {remainingSkills} más en el detalle del perfil.
            </ScopeText>
          ) : null}
          {hasVisibleProvenance ? (
            <ScopeText variant="caption" tone="subtle">
              Emisor indica una interpretación revisada por la institución
              emisora. IA indica una interpretación realizada con inteligencia
              artificial.
            </ScopeText>
          ) : null}
        </ScopeCard>
      </ScopeSection>

      {/*
        DETALLE BAJO DEMANDA.

        El perfil completo puede traer decenas de áreas, habilidades y
        conceptos. Mostrarlos todos de entrada convierte la pantalla principal
        en un muro de taxonomía y empuja las credenciales —y los objetivos—
        fuera de vista.

        No hay filtrado semántico, ni ranking, ni deduplicación: se muestran
        TODOS, en el orden autoritativo del backend, sólo que en dos niveles.
      */}
      <ProfileDetailDisclosure
        areaItems={areaItems}
        skillItems={skillItems}
        conceptItems={conceptItems}
        profile={profile}
        hasDeclaredInstitutionalInfo={hasDeclaredInstitutionalInfo}
      />
    </View>
  );
}

function ProfileDetailDisclosure({
  areaItems,
  skillItems,
  conceptItems,
  profile,
  hasDeclaredInstitutionalInfo
}: {
  areaItems: TaxonomyItem[];
  skillItems: TaxonomyItem[];
  conceptItems: TaxonomyItem[];
  profile: HolderProfileVM;
  hasDeclaredInstitutionalInfo: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ScopeCard tone="muted" style={styles.disclosureCard}>
      <Pressable
        testID="profile-detail-disclosure"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Explorar el detalle del perfil"
        accessibilityHint={
          expanded
            ? 'Oculta conceptos, información declarada y datos del análisis'
            : 'Muestra conceptos, información declarada y datos del análisis'
        }
        onPress={() => setExpanded((value) => !value)}
        style={styles.disclosureHeader}
      >
        <ScopeText variant="smallStrong" tone="strong" style={styles.flexOne}>
          Explorar el detalle del perfil
        </ScopeText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.text.muted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>

      {expanded ? (
        <View style={styles.disclosureBody}>
          {areaItems.length > PRIMARY_AREAS_LIMIT ? (
            <TaxonomyList
              testID="profile-areas-more"
              title="Más áreas"
              items={areaItems.slice(PRIMARY_AREAS_LIMIT)}
            />
          ) : null}
          {skillItems.length > PRIMARY_SKILLS_LIMIT ? (
            <TaxonomyList
              testID="profile-skills-more"
              title="Más habilidades"
              items={skillItems.slice(PRIMARY_SKILLS_LIMIT)}
            />
          ) : null}
          <TaxonomyList
            testID="profile-concepts"
            title="Conceptos relacionados"
            items={conceptItems}
            emptyLabel="Todavía no hay conceptos disponibles."
          />

          {hasDeclaredInstitutionalInfo ? (
            <View style={styles.declaredBlock}>
              <ScopeText variant="smallStrong" tone="strong">
                Información declarada por instituciones
              </ScopeText>
              <ScopeText variant="caption" tone="muted">
                Proviene de credenciales emitidas. No es una certificación de la
                IA ni reemplaza la interpretación asistida.
              </ScopeText>
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
            </View>
          ) : null}

          <View style={styles.declaredBlock} testID="profile-about">
            <ScopeText variant="smallStrong" tone="strong">
              Acerca de este perfil
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
          </View>
        </View>
      ) : null}
    </ScopeCard>
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
  disclosureCard: {
    gap: spacing.md
  },
  disclosureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.touchTarget
  },
  disclosureBody: {
    gap: spacing.lg
  },
  declaredBlock: {
    gap: spacing.sm
  },
  flexOne: {
    flex: 1
  },
  footerCard: {
    gap: spacing.sm
  },
  coverageText: {
    color: colors.status.warning
  }
});
