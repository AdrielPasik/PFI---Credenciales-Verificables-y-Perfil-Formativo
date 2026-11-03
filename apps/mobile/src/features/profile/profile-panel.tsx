import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

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
import { makeStyles, useTheme } from '@/lib/theme/theme-provider';
import { layout, spacing } from '@/lib/theme/tokens';
import type { HolderProfileVM } from '@/types/holder';

/**
 * Piezas del perfil formativo en el inicio.
 *
 * Jerarquía (el resumen numérico está en la banda de bienvenida): cobertura ->
 * áreas -> habilidades -> conceptos -> información declarada -> cómo se
 * construye.
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

/**
 * Aviso de cobertura. Es una limitación de la evidencia disponible, nunca una
 * carencia del titular. Sin limitaciones que informar, no se dibuja.
 */
export function ProfileCoverageNotice({ profile }: { profile: HolderProfileVM }) {
  const styles = useStyles();
  if (!profile.hoursCoverageNoticeLabel && !profile.semanticCoverageNoticeLabel) {
    return null;
  }

  return (
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
  );
}

/**
 * Trayectoria: áreas y habilidades de entrada, y el resto bajo demanda.
 *
 * El resumen numérico (credenciales, horas, áreas) vive en la banda de
 * bienvenida; acá queda lo que explica de qué está hecho el perfil, con la
 * aclaración de que la confianza describe el análisis y no a la persona.
 */
export function ProfileTrajectory({
  profile,
  footer
}: {
  profile: HolderProfileVM;
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
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

  return (
    <ScopeSection
      title="Áreas y habilidades"
      description={
        profile.confidenceLabel
          ? `Contenidos de tus credenciales y análisis. ${profile.confidenceLabel}: la confianza describe la fiabilidad del análisis disponible, no tu nivel de conocimiento.`
          : 'Contenidos que aparecen en tus credenciales y análisis.'
      }
    >
      <View style={styles.root}>
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
        {footer}
      </View>
    </ScopeSection>
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
  const { colors } = useTheme();
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
  root: {
    gap: spacing.md
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
  coverageText: {
    color: colors.status.warning
  }
}));
