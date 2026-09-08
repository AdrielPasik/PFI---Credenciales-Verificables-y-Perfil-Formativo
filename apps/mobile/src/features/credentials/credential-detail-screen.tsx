import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ScopeBadge } from '@/components/ui/badge';
import {
  DeclaredTextList,
  TaxonomyList,
  TechnicalValue
} from '@/components/ui/content-lists';
import { ScopeScreen } from '@/components/ui/screen';
import {
  ScopeCard,
  ScopeDefinitionRow,
  ScopeDivider,
  ScopeSection
} from '@/components/ui/surfaces';
import {
  ScopeErrorState,
  ScopeLoadingState,
  ScopeNotice,
  ScopeSkeletonBlock
} from '@/components/ui/states';
import { ScopeText } from '@/components/ui/text';
import { mapHolderError } from '@/features/credentials/holder-error-mapper';
import { useCredentialDetail } from '@/features/credentials/use-credentials';
import { ShareAction } from '@/features/sharing/share-action';
import { isSafeExternalUrl } from '@/features/sharing/share-links';
import { useCredentialShare } from '@/features/sharing/use-share';
import { colors, layout, radii, spacing } from '@/lib/theme/tokens';
import type { HolderCredentialDetailVM } from '@/types/holder';

/**
 * Detalle de credencial.
 *
 * Jerarquía deliberada:
 *
 *   1. identidad de la credencial (estado, tipo, título, emisor, fechas)
 *   2. aporte formativo declarado por la institución
 *   3. interpretación asistida
 *   4. fuentes de respaldo
 *   5. integridad técnica (secundaria, plegable)
 *   6. compartir
 *
 * Ni la IA ni la blockchain son protagonistas: la credencial y su evidencia
 * lo son (sección 25 del encargo).
 */
export function CredentialDetailScreen({
  credentialReference
}: {
  credentialReference: string;
}) {
  const query = useCredentialDetail(credentialReference);

  if (query.isLoading) {
    return (
      <ScopeScreen>
        <ScopeSkeletonBlock height={150} />
        <ScopeSkeletonBlock height={220} />
        <ScopeLoadingState label="Cargando credencial" />
      </ScopeScreen>
    );
  }

  if (query.isError) {
    const state = mapHolderError(query.error, 'credential');

    return (
      <ScopeScreen>
        <ScopeErrorState
          title={state.title}
          description={state.description}
          onRetry={state.retryable ? () => void query.refetch() : undefined}
        />
      </ScopeScreen>
    );
  }

  if (!query.data) return null;

  return <CredentialDetailView detail={query.data} />;
}

export function CredentialDetailView({
  detail
}: {
  detail: HolderCredentialDetailVM;
}) {
  const revoked = detail.status === 'revoked';
  const share = useCredentialShare(detail.credentialReference, detail.title);

  return (
    <ScopeScreen>
      <View style={styles.identity}>
        <View style={styles.badgeRow}>
          <ScopeBadge
            label={detail.statusLabel}
            tone={revoked ? 'revoked' : 'issued'}
          />
          <ScopeBadge label={detail.typeLabel} tone="neutral" />
        </View>
        <ScopeText variant="overline" tone="teal">
          Credencial formativa
        </ScopeText>
        <ScopeText variant="screenTitle" tone="strong" accessibilityRole="header">
          {detail.title}
        </ScopeText>
        <ScopeText variant="small" tone="muted">
          Emitida por {detail.issuerName}.
        </ScopeText>
      </View>

      {revoked ? (
        <ScopeNotice tone="warning" title="Esta credencial está revocada">
          <ScopeText variant="small" style={styles.warningText}>
            {detail.revocationReason ??
              'La institución emisora registró esta credencial como revocada.'}
          </ScopeText>
          {detail.revokedAtLabel ? (
            <ScopeText variant="caption" style={styles.warningText}>
              Revocada el {detail.revokedAtLabel}.
            </ScopeText>
          ) : null}
        </ScopeNotice>
      ) : null}

      <ScopeSection title="Identidad de la credencial">
        <ScopeCard style={styles.rowsCard}>
          <ScopeDefinitionRow label="Emitida por" value={detail.issuerName} />
          <ScopeDefinitionRow
            label="Titular"
            value={detail.holderLabel ?? detail.holderEmail}
          />
          <ScopeDefinitionRow
            label="Fecha de emisión"
            value={detail.issuedAtLabel}
          />
          <ScopeDefinitionRow
            label="DID institucional"
            value={detail.issuerDid}
            technical
          />
        </ScopeCard>
      </ScopeSection>

      <FormativeContribution detail={detail} />
      <AssistedInterpretation detail={detail} />
      <SupportingEvidence detail={detail} />
      <IntegritySection detail={detail} />

      <ScopeSection title="Compartir esta credencial">
        <ScopeCard>
          <ShareAction
            testID="credential-share-action"
            label="Compartir credencial"
            description="Quien reciba el enlace podrá consultar la información pública verificable de esta credencial."
            pending={share.pending}
            feedback={share.feedback}
            onShare={() => void share.share()}
            onCopyLink={() => void share.copyLink()}
            onOpenPublicView={() => void share.openPublicView()}
          />
        </ScopeCard>
      </ScopeSection>
    </ScopeScreen>
  );
}

function FormativeContribution({
  detail
}: {
  detail: HolderCredentialDetailVM;
}) {
  const hasCourseDeclaredData =
    detail.type === 'course' &&
    (detail.subject.platformName !== null ||
      detail.subject.modality !== null ||
      detail.subject.externalUrl !== null);

  const hasDeclaredContent =
    detail.subject.skills.length > 0 ||
    detail.subject.competencies.length > 0 ||
    detail.subject.learningOutcomes.length > 0;

  return (
    <ScopeSection
      title="Aporte formativo"
      description="Información emitida por la institución."
    >
      <ScopeCard style={styles.rowsCard}>
        <ScopeDefinitionRow
          label="Institución"
          value={detail.subject.institutionName ?? detail.issuerName}
        />
        <ScopeDefinitionRow
          label="Programa o carrera"
          value={detail.subject.programName}
        />
        <ScopeDefinitionRow
          label="Período académico"
          value={detail.subject.academicPeriod}
        />
        <ScopeDefinitionRow
          label="Fecha de finalización"
          value={detail.subject.completionDate}
        />
        <ScopeDefinitionRow label="Calificación" value={detail.subject.grade} />
        <ScopeDefinitionRow
          label="Horas oficiales declaradas"
          value={detail.hoursLabel}
        />
        <ScopeDefinitionRow label="Nivel" value={detail.subject.level} />

        {detail.description ? (
          <>
            <ScopeDivider />
            <ScopeText variant="small" tone="default">
              {detail.description}
            </ScopeText>
          </>
        ) : null}

        {hasCourseDeclaredData ? (
          <>
            <ScopeDivider />
            <ScopeText variant="smallStrong" tone="strong">
              Información declarada del curso
            </ScopeText>
            <ScopeDefinitionRow
              label="Plataforma"
              value={detail.subject.platformName}
            />
            <ScopeDefinitionRow
              label="Modalidad"
              value={detail.subject.modality}
            />
            {detail.subject.externalUrl ? (
              <ExternalLinkRow url={detail.subject.externalUrl} />
            ) : null}
          </>
        ) : null}

        {hasDeclaredContent ? (
          <>
            <ScopeDivider />
            <DeclaredTextList
              testID="credential-declared-skills"
              title="Habilidades declaradas"
              items={detail.subject.skills}
            />
            <DeclaredTextList
              testID="credential-declared-competencies"
              title="Competencias"
              items={detail.subject.competencies}
            />
            <DeclaredTextList
              testID="credential-declared-learning-outcomes"
              title="Resultados de aprendizaje"
              items={detail.subject.learningOutcomes}
            />
          </>
        ) : null}
      </ScopeCard>
    </ScopeSection>
  );
}

function AssistedInterpretation({
  detail
}: {
  detail: HolderCredentialDetailVM;
}) {
  return (
    <ScopeSection
      title="Interpretación asistida por IA"
      description="Organiza información detectada en la evidencia. No modifica ni reemplaza los datos emitidos por la institución."
    >
      <ScopeCard style={styles.rowsCard}>
        {detail.analysis ? (
          <>
            <ScopeText variant="caption" tone="muted">
              {detail.analysis.statusLabel} ·{' '}
              {detail.analysis.analyzedAtLabel}
            </ScopeText>
            <TaxonomyList
              testID="credential-analysis-areas"
              title="Áreas detectadas"
              items={detail.analysis.areas.map((label) => ({
                key: `area-${label}`,
                label
              }))}
            />
            <TaxonomyList
              testID="credential-analysis-skills"
              title="Habilidades detectadas"
              items={detail.analysis.skills.map((label) => ({
                key: `skill-${label}`,
                label
              }))}
            />
            <TaxonomyList
              testID="credential-analysis-concepts"
              title="Conceptos detectados"
              items={detail.analysis.concepts.map((label) => ({
                key: `concept-${label}`,
                label
              }))}
            />
            {detail.analysis.confidenceLabel ? (
              <ScopeText variant="small" tone="muted">
                Confianza del análisis: {detail.analysis.confidenceLabel}.
              </ScopeText>
            ) : null}
            {detail.analysis.qualityFlags.length > 0 ? (
              <ScopeText variant="small" tone="muted">
                Observaciones: {detail.analysis.qualityFlags.join(', ')}.
              </ScopeText>
            ) : null}
          </>
        ) : (
          <ScopeText variant="small" tone="muted">
            No hay análisis disponible para esta credencial.
          </ScopeText>
        )}
      </ScopeCard>
    </ScopeSection>
  );
}

function SupportingEvidence({ detail }: { detail: HolderCredentialDetailVM }) {
  return (
    <ScopeSection
      title="Fuentes de respaldo"
      description="La evidencia se muestra sólo en modo lectura."
    >
      <ScopeCard style={styles.rowsCard}>
        {detail.documentEvidence ? (
          <View style={styles.evidenceBlock}>
            <ScopeText variant="smallStrong" tone="strong">
              {detail.documentEvidence.originalFileName}
            </ScopeText>
            <ScopeText variant="caption" tone="muted">
              {detail.documentEvidence.mimeType} ·{' '}
              {detail.documentEvidence.sizeLabel}
            </ScopeText>
            <ScopeText variant="technical" tone="subtle">
              Huella: {detail.documentEvidence.sha256Short}
            </ScopeText>
            <ScopeText variant="caption" tone="muted">
              Cargada el {detail.documentEvidence.uploadedAtLabel}
            </ScopeText>
          </View>
        ) : (
          <EmptyEvidence text="No hay evidencia documental disponible para mostrar." />
        )}

        <ScopeDivider />

        {detail.textEvidence ? (
          <View style={styles.evidenceBlock}>
            <ScopeText variant="smallStrong" tone="strong">
              {detail.textEvidence.label ?? 'Fuente textual'}
            </ScopeText>
            <ScopeText variant="small" tone="default">
              {detail.textEvidence.preview}
            </ScopeText>
            <ScopeText variant="technical" tone="subtle">
              Huella: {detail.textEvidence.sha256Short}
            </ScopeText>
            <ScopeText variant="caption" tone="muted">
              Registrada el {detail.textEvidence.submittedAtLabel} ·{' '}
              {detail.textEvidence.characterCount} caracteres
            </ScopeText>
          </View>
        ) : (
          <EmptyEvidence text="No hay evidencia textual disponible para mostrar." />
        )}
      </ScopeCard>
    </ScopeSection>
  );
}

/**
 * Integridad. Plegable y cerrada por defecto: es información importante pero
 * secundaria frente al significado formativo de la credencial (sección 82).
 */
function IntegritySection({ detail }: { detail: HolderCredentialDetailVM }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  }, []);

  const hasIntegrityData =
    detail.integrity.canonicalHashShort !== null ||
    detail.integrity.records.length > 0;

  return (
    <ScopeSection title="Evidencia de integridad">
      <ScopeCard tone="muted" style={styles.rowsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel="Evidencia de integridad"
          accessibilityHint={
            expanded
              ? 'Oculta el registro técnico de la credencial'
              : 'Muestra el registro técnico de la credencial'
          }
          onPress={() => setExpanded((value) => !value)}
          style={styles.disclosureHeader}
        >
          <ScopeText variant="smallStrong" tone="strong" style={styles.flexOne}>
            Registro técnico de la credencial emitida
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
          <View style={styles.rowsCard}>
            {!hasIntegrityData ? (
              <ScopeText variant="small" tone="muted">
                La credencial fue emitida, pero no hay evidencia técnica
                disponible para mostrar.
              </ScopeText>
            ) : null}

            {detail.integrity.canonicalHash ? (
              <TechnicalValue
                label="Huella canónica"
                value={detail.integrity.canonicalHash}
                onCopy={() =>
                  void copy(
                    detail.integrity.canonicalHash as string,
                    'Huella canónica'
                  )
                }
              />
            ) : null}

            {detail.integrity.canonicalizationVersion ? (
              <ScopeDefinitionRow
                label="Versión de canonicalización"
                value={detail.integrity.canonicalizationVersion}
              />
            ) : null}

            {detail.integrity.records.map((record, index) => (
              <View
                key={`${record.txHashShort}-${index}`}
                style={styles.evidenceBlock}
              >
                <ScopeText variant="smallStrong" tone="strong">
                  {record.networkLabel}
                </ScopeText>
                <ScopeText variant="caption" tone="muted">
                  Red técnica {record.chainId} · {record.statusLabel}
                </ScopeText>
                <TechnicalValue
                  label="Registro"
                  value={record.txHash}
                  onCopy={() => void copy(record.txHash, 'Registro')}
                />
                <ScopeText variant="caption" tone="muted">
                  Registrado el {record.registeredAtLabel}
                </ScopeText>
              </View>
            ))}

            {copied ? (
              <ScopeText
                variant="caption"
                tone="success"
                accessibilityLiveRegion="polite"
              >
                {copied} copiada.
              </ScopeText>
            ) : null}

            <ScopeText variant="caption" tone="subtle">
              La evidencia de integridad registra datos técnicos de emisión. La
              validez académica depende de la institución emisora.
            </ScopeText>
          </View>
        ) : null}
      </ScopeCard>
    </ScopeSection>
  );
}

function ExternalLinkRow({ url }: { url: string }) {
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    if (!isSafeExternalUrl(url)) {
      setError('El enlace declarado no es válido.');
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      setError('No pudimos abrir el enlace declarado.');
    }
  }, [url]);

  return (
    <View style={styles.externalLinkBlock}>
      <ScopeText variant="overline" tone="muted">
        URL del curso o certificado
      </ScopeText>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Abrir ${url}`}
        accessibilityHint="Abre el enlace en el navegador"
        onPress={() => void open()}
        style={styles.externalLink}
      >
        <ScopeText variant="small" tone="teal">
          {url}
        </ScopeText>
      </Pressable>
      <ScopeText variant="caption" tone="subtle">
        Enlace declarado por la institución emisora. No implica verificación
        oficial externa.
      </ScopeText>
      {error ? (
        <ScopeText variant="caption" tone="error">
          {error}
        </ScopeText>
      ) : null}
    </View>
  );
}

function EmptyEvidence({ text }: { text: string }) {
  return (
    <View style={styles.emptyEvidence}>
      <ScopeText variant="small" tone="muted">
        {text}
      </ScopeText>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    gap: spacing.sm
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  rowsCard: {
    gap: spacing.lg
  },
  evidenceBlock: {
    gap: spacing.xs
  },
  emptyEvidence: {
    borderRadius: radii.control,
    borderWidth: layout.hairline,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
    padding: spacing.md
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
  externalLinkBlock: {
    gap: spacing.xs
  },
  externalLink: {
    minHeight: layout.touchTarget,
    justifyContent: 'center'
  },
  warningText: {
    color: colors.status.warning
  }
});
