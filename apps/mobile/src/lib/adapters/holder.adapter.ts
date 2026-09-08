import {
  aliasedValue,
  array,
  descriptorLabel,
  enumValue,
  invalid,
  nonNegativeInteger,
  nullableConfidence,
  nullableNumber,
  nullableRecord,
  nullableString,
  optionalDeclaredStringArray,
  optionalEmittedLabelArray,
  optionalNonNegativeInteger,
  optionalRecord,
  record,
  requiredBoolean,
  requiredString,
  safeString,
  semanticLabelArray,
  semanticLabelFields
} from '@/lib/adapters/contract';
import {
  abbreviateTechnicalReference,
  formatBlockchainEvidenceStatus,
  formatBlockchainNetwork,
  formatBytes,
  formatConfidence,
  formatDate,
  formatNumber,
  formatQualityFlag,
  pluralCredential
} from '@/lib/format/display';
import type {
  HolderCredentialDetailVM,
  HolderCredentialListItemVM,
  HolderProfileProvenanceVM,
  HolderProfileVM
} from '@/types/holder';

/**
 * Adaptación de los contratos del titular a los modelos de presentación de
 * mobile.
 *
 * Es código propio de la app móvil: NO se importa nada desde `apps/web`
 * (eso invertiría la dirección de dependencia). Reproduce deliberadamente
 * las mismas tolerancias de contrato que Holder Web ya validó en runtime.
 */

const CREDENTIAL_STATUSES = ['issued', 'revoked'] as const;
const CREDENTIAL_TYPES = [
  'academic_subject',
  'course',
  'certification',
  'degree'
] as const;
const SEMANTIC_STATUSES = ['completed', 'partial'] as const;

const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const DIGEST_PATTERN = /^[a-fA-F0-9]{64}$/;

const TYPE_LABELS: Record<(typeof CREDENTIAL_TYPES)[number], string> = {
  academic_subject: 'Asignatura académica',
  course: 'Curso',
  certification: 'Certificación',
  degree: 'Título académico'
};

function dateLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalid(path, 'ISO date string', value);
  }
  return formatDate(value);
}

function nullableDateLabel(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : dateLabel(value, path);
}

function nullableHash(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  const hash = requiredString(value, path);
  if (!HASH_PATTERN.test(hash)) {
    invalid(path, '0x-prefixed 32-byte hash or null', value);
  }
  return hash;
}

function digest(value: unknown, path: string): string {
  const normalized = requiredString(value, path);
  if (!DIGEST_PATTERN.test(normalized)) {
    invalid(path, '64-character hexadecimal digest', value);
  }
  return normalized;
}

function nullableConfidenceLabel(value: unknown, path: string): string | null {
  const confidence = nullableConfidence(value, path);
  return confidence === null ? null : formatConfidence(confidence);
}

function nullableExternalUrl(value: unknown, path: string): string | null {
  const url = nullableString(value, path);
  if (url === null) return null;

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    invalid(path, 'HTTP(S) URL or null', value);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    invalid(path, 'HTTP(S) URL or null', value);
  }

  return url;
}

function nullableSubjectString(
  source: Record<string, unknown>,
  current: string,
  legacy?: string
): string | null {
  return nullableString(
    aliasedValue(source, current, legacy),
    `credential.credentialSubject.${current}`
  );
}

function qualityFlags(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) =>
    formatQualityFlag(safeString(entry, 120, `${path}[${index}]`))
  );
}

export function adaptCredentialListItem(
  value: unknown,
  path: string
): HolderCredentialListItemVM {
  const credential = record(value, path);
  const status = enumValue(
    credential.status,
    CREDENTIAL_STATUSES,
    `${path}.status`
  );
  const type = enumValue(credential.type, CREDENTIAL_TYPES, `${path}.type`);

  return {
    credentialReference: requiredString(credential.id, `${path}.id`),
    title: safeString(credential.title, 300, `${path}.title`),
    type,
    typeLabel: TYPE_LABELS[type],
    status,
    statusLabel: status === 'issued' ? 'Emitida' : 'Revocada',
    issuerName: safeString(credential.issuerName, 300, `${path}.issuerName`),
    issuedAtLabel: nullableDateLabel(credential.issuedAt, `${path}.issuedAt`),
    hasIntegrityEvidence: requiredBoolean(
      credential.hasIntegrityEvidence,
      `${path}.hasIntegrityEvidence`
    ),
    hasAnalysis: requiredBoolean(
      credential.hasAnalysis,
      `${path}.hasAnalysis`
    )
  };
}

export function adaptMyCredentials(
  payload: unknown
): HolderCredentialListItemVM[] {
  return array(payload, 'credentials').map((value, index) =>
    adaptCredentialListItem(value, `credentials[${index}]`)
  );
}

export function adaptMyCredential(
  payload: unknown
): HolderCredentialDetailVM {
  const credential = record(payload, 'credential');
  const blockchainRecords = array(
    credential.blockchainRecords,
    'credential.blockchainRecords'
  );
  const analysis = optionalRecord(
    credential.latestSemanticAnalysis,
    'credential.latestSemanticAnalysis'
  );
  const issuer = record(credential.issuer, 'credential.issuer');
  const listItem = adaptCredentialListItem(
    {
      ...credential,
      issuerName: issuer.name,
      hasIntegrityEvidence: blockchainRecords.length > 0,
      hasAnalysis: analysis !== null
    },
    'credential'
  );
  const subject = record(credential.subject, 'credential.subject');
  const credentialSubject = record(
    credential.credentialSubject,
    'credential.credentialSubject'
  );
  const documentEvidence = optionalRecord(
    credential.documentEvidence,
    'credential.documentEvidence'
  );
  const textEvidence = optionalRecord(
    credential.textEvidence,
    'credential.textEvidence'
  );
  const canonicalHash = nullableHash(
    credential.canonicalHash,
    'credential.canonicalHash'
  );
  const hours = nullableNumber(credential.hours, 'credential.hours');

  return {
    ...listItem,
    description: nullableString(
      credential.description,
      'credential.description'
    ),
    hoursLabel: hours === null ? null : `${formatNumber(hours)} horas`,
    issuerDid: nullableString(issuer.did, 'credential.issuer.did'),
    holderLabel: nullableString(
      subject.displayLabel,
      'credential.subject.displayLabel'
    ),
    holderEmail:
      nullableString(
        subject.email,
        'credential.subject.email'
      )?.toLowerCase() ?? null,
    holderDid: nullableString(subject.did, 'credential.subject.did'),
    revokedAtLabel: nullableDateLabel(
      credential.revokedAt,
      'credential.revokedAt'
    ),
    revocationReason: nullableString(
      credential.revocationReason,
      'credential.revocationReason'
    ),
    subject: {
      achievementName: nullableSubjectString(
        credentialSubject,
        'achievementName',
        'achievement_name'
      ),
      institutionName: nullableSubjectString(
        credentialSubject,
        'institutionName',
        'institution_name'
      ),
      completionDate: nullableSubjectString(
        credentialSubject,
        'completionDate',
        'completion_date'
      ),
      academicPeriod: nullableSubjectString(
        credentialSubject,
        'academicPeriod',
        'academic_period'
      ),
      programName: nullableSubjectString(
        credentialSubject,
        'programName',
        'program_name'
      ),
      grade: nullableSubjectString(credentialSubject, 'grade'),
      providerName: nullableSubjectString(
        credentialSubject,
        'providerName',
        'provider_name'
      ),
      platformName: nullableSubjectString(
        credentialSubject,
        'platformName',
        'platform_name'
      ),
      modality: nullableSubjectString(credentialSubject, 'modality'),
      level: nullableSubjectString(credentialSubject, 'level'),
      externalUrl: nullableExternalUrl(
        aliasedValue(credentialSubject, 'externalUrl', 'external_url'),
        'credential.credentialSubject.externalUrl'
      ),
      // Paridad con Holder Web: en un curso, `skills` declaradas no se
      // presentan como contenido propio de la credencial.
      skills:
        listItem.type === 'course'
          ? []
          : optionalDeclaredStringArray(
              credentialSubject.skills,
              'credential.credentialSubject.skills'
            ),
      competencies: optionalDeclaredStringArray(
        credentialSubject.competencies,
        'credential.credentialSubject.competencies'
      ),
      learningOutcomes: optionalDeclaredStringArray(
        aliasedValue(
          credentialSubject,
          'learningOutcomes',
          'learning_outcomes'
        ),
        'credential.credentialSubject.learningOutcomes'
      )
    },
    documentEvidence: documentEvidence
      ? {
          originalFileName: safeString(
            documentEvidence.originalFileName,
            300,
            'credential.documentEvidence.originalFileName'
          ),
          mimeType: safeString(
            documentEvidence.mimeType,
            160,
            'credential.documentEvidence.mimeType'
          ),
          sizeLabel: formatBytes(
            nonNegativeInteger(
              documentEvidence.sizeBytes,
              'credential.documentEvidence.sizeBytes'
            )
          ),
          sha256Short: abbreviateTechnicalReference(
            digest(
              documentEvidence.sha256,
              'credential.documentEvidence.sha256'
            )
          ),
          uploadedAtLabel: dateLabel(
            documentEvidence.uploadedAt,
            'credential.documentEvidence.uploadedAt'
          )
        }
      : null,
    textEvidence: textEvidence
      ? {
          label: nullableString(
            textEvidence.label,
            'credential.textEvidence.label'
          ),
          preview: requiredString(
            textEvidence.preview,
            'credential.textEvidence.preview'
          ),
          characterCount: nonNegativeInteger(
            textEvidence.characterCount,
            'credential.textEvidence.characterCount'
          ),
          sha256Short: abbreviateTechnicalReference(
            digest(textEvidence.sha256, 'credential.textEvidence.sha256')
          ),
          submittedAtLabel: dateLabel(
            textEvidence.submittedAt,
            'credential.textEvidence.submittedAt'
          )
        }
      : null,
    integrity: {
      canonicalHash,
      canonicalHashShort: canonicalHash
        ? abbreviateTechnicalReference(canonicalHash)
        : null,
      canonicalizationVersion: nullableString(
        credential.canonicalizationVersion,
        'credential.canonicalizationVersion'
      ),
      records: blockchainRecords.map((value, index) => {
        const path = `credential.blockchainRecords[${index}]`;
        const item = record(value, path);
        const txHash =
          nullableHash(item.txHash, `${path}.txHash`) ??
          requiredString(item.txHash, `${path}.txHash`);

        return {
          networkLabel: formatBlockchainNetwork(
            requiredString(item.network, `${path}.network`)
          ),
          chainId: nonNegativeInteger(item.chainId, `${path}.chainId`),
          txHash,
          txHashShort: abbreviateTechnicalReference(txHash),
          statusLabel: formatBlockchainEvidenceStatus(
            requiredString(item.status, `${path}.status`)
          ),
          registeredAtLabel: dateLabel(
            item.registeredAt,
            `${path}.registeredAt`
          )
        };
      })
    },
    analysis: analysis
      ? (() => {
          const status = enumValue(
            analysis.status,
            SEMANTIC_STATUSES,
            'credential.latestSemanticAnalysis.status'
          );

          return {
            status,
            statusLabel:
              status === 'partial'
                ? 'Análisis parcial'
                : 'Análisis completado',
            confidenceLabel: nullableConfidenceLabel(
              analysis.confidence,
              'credential.latestSemanticAnalysis.confidence'
            ),
            areas: semanticLabelArray(
              analysis.areas,
              semanticLabelFields.area,
              'credential.latestSemanticAnalysis.areas'
            ),
            skills: semanticLabelArray(
              analysis.skills,
              semanticLabelFields.skill,
              'credential.latestSemanticAnalysis.skills'
            ),
            concepts: semanticLabelArray(
              analysis.concepts,
              semanticLabelFields.concept,
              'credential.latestSemanticAnalysis.concepts'
            ),
            qualityFlags: qualityFlags(
              analysis.qualityFlags,
              'credential.latestSemanticAnalysis.qualityFlags'
            ),
            analyzedAtLabel: dateLabel(
              analysis.analyzedAt,
              'credential.latestSemanticAnalysis.analyzedAt'
            )
          };
        })()
      : null
  };
}

/**
 * Procedencia agregada. A diferencia del resto del adapter (que rechaza el
 * payload completo ante un campo inválido), esto es un dato SECUNDARIO: un
 * shape malformado nunca debe tirar abajo el perfil entero. Degrada a
 * "sin procedencia para mostrar" (`null`) y jamás fabrica un conteo.
 *
 * Las etiquetas son de producto, nunca enums técnicos, y nunca usan la
 * palabra "verificado": en Scope eso ya significa autenticidad/integridad.
 */
function adaptProvenance(value: unknown): HolderProfileProvenanceVM | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const summary = value as Record<string, unknown>;
  const issuerReviewedCount = countOrNull(summary.issuerReviewedCount);
  const aiInferredCount = countOrNull(summary.aiInferredCount);

  if (issuerReviewedCount === null || aiInferredCount === null) return null;
  if (issuerReviewedCount === 0 && aiInferredCount === 0) return null;

  return {
    issuerReviewedLabel:
      issuerReviewedCount === 0
        ? null
        : issuerReviewedCount === 1
          ? 'Revisado por el emisor'
          : `${issuerReviewedCount} aportes revisados por el emisor`,
    aiInferredLabel:
      aiInferredCount === 0
        ? null
        : aiInferredCount === 1
          ? 'Interpretado con IA'
          : `${aiInferredCount} aportes interpretados con IA`
  };
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function profileJsonConfidence(
  profileJson: Record<string, unknown> | null
): unknown {
  if (!profileJson || profileJson.confidence === undefined) return undefined;

  if (
    typeof profileJson.confidence === 'number' ||
    profileJson.confidence === null
  ) {
    return profileJson.confidence;
  }

  return record(
    profileJson.confidence,
    'profile.currentProfile.profileJson.confidence'
  ).score;
}

/** `null` significa "todavía no hay perfil", no un error. */
export function adaptMyCurrentProfile(
  payload: unknown
): HolderProfileVM | null {
  const response = record(payload, 'profile');
  const profile = nullableRecord(
    response.currentProfile,
    'profile.currentProfile'
  );

  if (!profile) return null;

  const profileJson = optionalRecord(
    profile.profileJson,
    'profile.currentProfile.profileJson'
  );

  // Alias vigente/histórico: sólo se cae al histórico si el vigente está
  // ausente (nunca si vino `null`).
  const areasValue =
    profile.areas === undefined ? profile.areasSummary : profile.areas;
  const skillsValue =
    profile.skills === undefined ? profile.skillsSummary : profile.skills;
  const conceptsValue =
    profile.concepts === undefined ? profileJson?.concepts : profile.concepts;

  const totalOfficialHours =
    profile.totalOfficialHours === undefined
      ? nullableNumber(profile.totalHours, 'profile.currentProfile.totalHours')
      : nullableNumber(
          profile.totalOfficialHours,
          'profile.currentProfile.totalOfficialHours'
        );

  const credentialsWithoutHours = optionalNonNegativeInteger(
    profile.credentialsWithoutHours,
    'profile.currentProfile.credentialsWithoutHours'
  );
  const credentialsWithoutSemanticCoverage = optionalNonNegativeInteger(
    profile.credentialsWithoutSemanticCoverage,
    'profile.currentProfile.credentialsWithoutSemanticCoverage'
  );
  const credentialsWithReviewedInterpretation = optionalNonNegativeInteger(
    profile.credentialsWithReviewedInterpretation,
    'profile.currentProfile.credentialsWithReviewedInterpretation'
  );

  return {
    profileVersion: requiredString(
      profile.profileVersion,
      'profile.currentProfile.profileVersion'
    ),
    credentialsCount: nonNegativeInteger(
      profile.credentialsCount,
      'profile.currentProfile.credentialsCount'
    ),
    totalOfficialHoursLabel:
      totalOfficialHours === null
        ? null
        : `${formatNumber(totalOfficialHours)} horas oficiales declaradas`,
    hoursCoverageNoticeLabel:
      credentialsWithoutHours !== null && credentialsWithoutHours > 0
        ? `${credentialsWithoutHours} ${pluralCredential(
            credentialsWithoutHours
          )} no ${
            credentialsWithoutHours === 1 ? 'informa' : 'informan'
          } horas.`
        : null,
    semanticCoverageNoticeLabel:
      credentialsWithoutSemanticCoverage !== null &&
      credentialsWithoutSemanticCoverage > 0
        ? `${credentialsWithoutSemanticCoverage} ${pluralCredential(
            credentialsWithoutSemanticCoverage
          )} todavía no ${
            credentialsWithoutSemanticCoverage === 1 ? 'tiene' : 'tienen'
          } análisis semántico.`
        : null,
    reviewedInterpretationNoticeLabel:
      credentialsWithReviewedInterpretation !== null &&
      credentialsWithReviewedInterpretation > 0
        ? `${credentialsWithReviewedInterpretation} ${pluralCredential(
            credentialsWithReviewedInterpretation
          )} ${
            credentialsWithReviewedInterpretation === 1
              ? 'cuenta'
              : 'cuentan'
          } con una interpretación revisada por el emisor.`
        : null,
    narrative: nullableString(
      profile.narrative === undefined
        ? profileJson?.narrative
        : profile.narrative,
      'profile.currentProfile.narrative'
    ),
    areas: array(areasValue, 'profile.currentProfile.areas').map(
      (entry, index) => {
        const path = `profile.currentProfile.areas[${index}]`;
        const area = record(entry, path);
        const estimatedHours = nullableNumber(
          area.estimatedHours,
          `${path}.estimatedHours`
        );

        return {
          label: descriptorLabel(area, semanticLabelFields.area, path),
          estimatedHoursLabel:
            estimatedHours === null
              ? null
              : `${formatNumber(estimatedHours)} horas estimadas por IA`,
          provenance: adaptProvenance(area.provenanceSummary)
        };
      }
    ),
    skills: array(skillsValue, 'profile.currentProfile.skills').map(
      (entry, index) => {
        const path = `profile.currentProfile.skills[${index}]`;
        const skill = record(entry, path);
        const confidence = nullableConfidence(
          skill.confidence,
          `${path}.confidence`
        );

        return {
          label: descriptorLabel(skill, semanticLabelFields.skill, path),
          confidenceLabel:
            confidence === null ? null : formatConfidence(confidence),
          provenance: adaptProvenance(skill.provenanceSummary)
        };
      }
    ),
    concepts: semanticLabelArray(
      conceptsValue,
      semanticLabelFields.concept,
      'profile.currentProfile.concepts'
    ),
    // Compatibilidad: un backend anterior puede no emitir estos campos
    // todavía. Ausentes -> []. Presentes pero inválidos -> rechazo.
    emittedSkills: optionalEmittedLabelArray(
      profile.emittedSkills === undefined
        ? profileJson?.emittedSkills
        : profile.emittedSkills,
      'profile.currentProfile.emittedSkills'
    ),
    emittedCompetencies: optionalEmittedLabelArray(
      profile.emittedCompetencies === undefined
        ? profileJson?.emittedCompetencies
        : profile.emittedCompetencies,
      'profile.currentProfile.emittedCompetencies'
    ),
    emittedLearningOutcomes: optionalEmittedLabelArray(
      profile.emittedLearningOutcomes === undefined
        ? profileJson?.emittedLearningOutcomes
        : profile.emittedLearningOutcomes,
      'profile.currentProfile.emittedLearningOutcomes'
    ),
    confidenceLabel: nullableConfidenceLabel(
      profile.confidence === undefined
        ? profileJsonConfidence(profileJson)
        : profile.confidence,
      'profile.currentProfile.confidence'
    ),
    qualityFlags: qualityFlags(
      profile.qualityFlags,
      'profile.currentProfile.qualityFlags'
    ),
    generatedAtLabel: dateLabel(
      profile.generatedAt,
      'profile.currentProfile.generatedAt'
    )
  };
}
