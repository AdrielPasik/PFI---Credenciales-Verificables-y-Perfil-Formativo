import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CredentialSemanticInterpretationStatus,
  CredentialStatus,
  CredentialType,
  Prisma,
  type FormativeProfile
} from '@prisma/client';

import {
  REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA,
  type ApprovedSemanticSnapshotDescriptor,
  type ApprovedSemanticSnapshotHoursDistributionEntry,
  type ReviewedApprovedTemplateSemanticSnapshot
} from '../issuer-course-templates/issuer-course-templates.helpers';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CurrentProfileResponseDto,
  type FormativeProfileSnapshotDto
} from './dto/current-profile-response.dto';
import { mapFormativeProfileResultArtifact } from './formative-profile-result-artifact.mapper';
import { FORMATIVE_PROFILE_SCHEMA_VERSION } from './formative-profile-result-artifact.types';

const PROFILE_VERSION = 'backend_formative_profile_snapshot_v0';
const PROFILE_SCHEMA_VERSION = 'formative_profile_v1';
const GENERATION_METHOD = 'backend_deterministic_aggregation_v0';

const LABEL_FIELDS = {
  area: ['area', 'name', 'label', 'area_label', 'areaLabel'],
  skill: ['skill', 'name', 'label', 'skill_label', 'skillLabel'],
  concept: ['concept', 'name', 'label', 'concept_label', 'conceptLabel']
} as const;

// credentialSubject es JSON emitido por el emisor al crear/editar el draft
// (issuer-credential-draft-subject.ts). Estos campos NUNCA vienen de IA: son
// dato certificado por el emisor, igual que Credential.hours. Se agregan al
// perfil como una fuente separada ("emitted*"), nunca mezclada con los
// arrays inferidos ("areas"/"skills"/"concepts").
const CREDENTIAL_SUBJECT_EMITTED_FIELDS = {
  skill: 'skills',
  competency: 'competencies',
  learningOutcome: 'learning_outcomes'
} as const;

// ---------------------------------------------------------------------------
// C5b.1: cada Credential issued elige, como maximo, UNA fuente semantica:
//
//   1. CredentialReusableSemanticInterpretation status=active de esa
//      Credential -> provenance 'issuer_reviewed' (nunca superseded).
//   2. si no existe: el ultimo SemanticAnalysis propio de esa Credential
//      -> provenance 'ai_inferred'.
//   3. si no existe ninguno: sin fuente semantica (solo declared/emitted).
//
// Nunca se combinan ambas fuentes para la MISMA Credential. Entre
// Credentials distintas, sus contribuciones a la misma area/skill/concept
// SI se acumulan, conservando provenance por contribucion (ver
// ProfileEvidenceSource) -- la prioridad es por-Credential, no global.
// ---------------------------------------------------------------------------

type SemanticSourceProvenance = 'issuer_reviewed' | 'ai_inferred';

interface ProfileEvidenceSource {
  credentialId: string;
  provenance: SemanticSourceProvenance;
  // Exactamente uno de los dos, segun provenance -- nunca ambos, nunca el
  // otro presente con valor null (simplemente ausente).
  reusableInterpretationId?: string;
  semanticAnalysisId?: string;
}

interface ProfileEvidenceProvenanceSummary {
  issuerReviewedCount: number;
  aiInferredCount: number;
}

interface EvidenceAccumulator {
  labels: Set<string>;
  // Una entrada por Credential contribuyente (nunca duplica una misma
  // Credential aunque aporte la misma etiqueta mas de una vez dentro de su
  // propio snapshot/analisis).
  sources: Map<string, ProfileEvidenceSource>;
  confidenceValues: number[];
  estimatedHours: number[];
}

interface ProfileEvidence {
  credentialIds: string[];
  // Compat: solo ids de SemanticAnalysis efectivamente consumidos como
  // ai_inferred -- nunca sourceSemanticAnalysisId de una interpretacion
  // aplicada (esa referencia es provenance historica del template, no la
  // fuente que el perfil consume).
  semanticAnalysisIds: string[];
  // Ahora es la cantidad de Credentials/sources contribuyentes distintas,
  // no la cantidad de SemanticAnalysis distintos (coinciden cuando todo es
  // ai_inferred, que era el unico caso posible antes de C5b.1).
  evidenceCount: number;
  sources: ProfileEvidenceSource[];
  provenanceSummary: ProfileEvidenceProvenanceSummary;
}

interface ProfileArea extends ProfileEvidence {
  area: string;
  estimatedHours: number | null;
}

interface ProfileSkill extends ProfileEvidence {
  skill: string;
  confidence: number | null;
}

interface ProfileConcept extends ProfileEvidence {
  concept: string;
}

interface EmittedEvidenceAccumulator {
  labels: Set<string>;
  credentialIds: Set<string>;
}

interface ProfileEmittedEntry {
  label: string;
  credentialIds: string[];
  evidenceCount: number;
}

interface FormativeProfileJson {
  profileVersion: typeof PROFILE_VERSION;
  generatedAt: string;
  userId: string;
  generatedFrom: {
    credentialIds: string[];
    semanticAnalysisIds: string[];
    // C5b.1: filas active efectivamente consumidas como issuer_reviewed --
    // nunca superseded, nunca inferido a partir de sourceSemanticAnalysisId.
    reusableSemanticInterpretationIds: string[];
  };
  narrative: string | null;
  summary: {
    credentialsCount: number;
    // Credenciales con una fuente semantica UTILIZADA (issuer_reviewed o
    // ai_inferred), sin importar cual.
    analyzedCredentialsCount: number;
    // Suma de Credential.hours (dato oficial/declarado por el emisor, nunca
    // IA) entre las credenciales issued del holder. totalOfficialHours es
    // el mismo valor con un nombre inequivoco -- totalHours se conserva
    // por compatibilidad con consumidores existentes (C2c). Nunca cambia
    // de significado ni de fuente por C5b.1: una interpretacion aplicada
    // nunca reemplaza ni recalcula las horas oficiales.
    totalHours: number | null;
    totalOfficialHours: number | null;
    // Credenciales issued sin Credential.hours declarado. Nunca se infiere
    // ni se completa con IA -- simplemente se cuenta.
    credentialsWithoutHours: number;
    // Credenciales issued sin ninguna fuente semantica UTILIZADA -- ni
    // interpretacion aplicada consumible, ni SemanticAnalysis. Incluye el
    // caso "existe una fila active pero su snapshot es invalido/no
    // soportado" (nunca cae a ai_inferred en ese caso, ver
    // resolveSemanticSourceForCredential).
    credentialsWithoutSemanticCoverage: number;
    // C5b.1: cuantas de las Credentials analizadas usaron la interpretacion
    // revisada por el emisor (issuer_reviewed) como fuente elegida.
    credentialsWithReviewedInterpretation: number;
  };
  areas: ProfileArea[];
  // Inferido a partir de una interpretacion revisada (issuer_reviewed) o de
  // SemanticAnalysis (ai_inferred) -- nunca certifica ni reemplaza
  // credentialSubject.skills -- ver emittedSkills.
  skills: ProfileSkill[];
  concepts: ProfileConcept[];
  // Dato emitido por el issuer (credentialSubject.skills/.competencies/
  // .learning_outcomes). No tiene confidence porque no es una inferencia de
  // IA: es texto cargado por el emisor al draft. No implica que la IA haya
  // detectado ni validado estas habilidades.
  emittedSkills: ProfileEmittedEntry[];
  emittedCompetencies: ProfileEmittedEntry[];
  emittedLearningOutcomes: ProfileEmittedEntry[];
  confidence: {
    score: number | null;
    method: 'derived' | 'unavailable';
  };
  warnings: string[];
}

type SemanticEntryKind = keyof typeof LABEL_FIELDS;
type EmittedEntryKind = keyof typeof CREDENTIAL_SUBJECT_EMITTED_FIELDS;

// Resultado de resolver, para una Credential, cual fuente semantica (si
// alguna) participa del perfil. 'none': ni interpretacion aplicada ni
// SemanticAnalysis. 'unsupported_reusable_interpretation': existe una fila
// active pero su snapshot no es consumible (version desconocida/corrupta)
// -- nunca cae a ai_inferred en este caso (seria una mezcla invisible de
// fuentes: una interpretacion humana aplicada no se ignora en silencio
// para volver a la IA cruda).
type ResolvedSemanticSource =
  | { kind: 'none' }
  | { kind: 'unsupported_reusable_interpretation' }
  | {
      kind: SemanticSourceProvenance;
      source: ProfileEvidenceSource;
      areas: unknown;
      skills: unknown;
      concepts: unknown;
      hoursDistributionEntries: unknown[];
      confidence: unknown;
      analysisJson: unknown;
    };

@Injectable()
export class FormativeProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentForUser(userId: string): Promise<CurrentProfileResponseDto> {
    const currentProfile = await this.prisma.formativeProfile.findFirst({
      where: {
        userId,
        isCurrent: true
      },
      orderBy: [
        {
          generatedAt: 'desc'
        },
        {
          id: 'desc'
        }
      ]
    });

    return {
      userId,
      currentProfile: currentProfile
        ? this.toCurrentProfileResponse(currentProfile)
        : null
    };
  }

  async rebuildForUser(userId: string): Promise<CurrentProfileResponseDto> {
    const credentials = await this.prisma.credential.findMany({
      where: {
        subjectUserId: userId,
        status: CredentialStatus.issued
      },
      select: {
        id: true,
        type: true,
        hours: true,
        credentialSubject: true,
        semanticAnalyses: {
          orderBy: [
            {
              analyzedAt: 'desc'
            },
            {
              id: 'desc'
            }
          ],
          take: 1,
          select: {
            id: true,
            analyzedAt: true,
            confidence: true,
            areas: true,
            skills: true,
            concepts: true,
            analysisJson: true
          }
        },
        // C5b.1: como maximo una fila active por Credential (garantizado
        // por el partial unique index de C4b.1a) -- nunca se lee
        // superseded como fuente del perfil.
        reusableSemanticInterpretations: {
          where: {
            status: CredentialSemanticInterpretationStatus.active
          },
          take: 1,
          select: {
            id: true,
            approvedSnapshot: true,
            snapshotVersion: true
          }
        }
      },
      orderBy: {
        id: 'asc'
      }
    });

    const generatedAt = new Date();
    const profileJson = this.buildProfileJson(userId, credentials, generatedAt);
    const persistedTotalHours = profileJson.summary.totalHours ?? 0;

    const profile = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.formativeProfile.updateMany({
          where: {
            userId,
            isCurrent: true
          },
          data: {
            isCurrent: false
          }
        });

        return transaction.formativeProfile.create({
          data: {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            userId,
            generatedAt,
            credentialsCount: profileJson.summary.credentialsCount,
            totalHours: new Prisma.Decimal(persistedTotalHours),
            profileVersion: PROFILE_VERSION,
            isCurrent: true,
            generationMethod: GENERATION_METHOD,
            areasSummary: profileJson.areas as unknown as Prisma.InputJsonValue,
            skillsSummary: profileJson.skills as unknown as Prisma.InputJsonValue,
            evidenceByArea: profileJson.areas.map((area) => ({
              area: area.area,
              credentialIds: area.credentialIds,
              semanticAnalysisIds: area.semanticAnalysisIds,
              evidenceCount: area.evidenceCount
            })) as Prisma.InputJsonValue,
            qualityFlags: profileJson.warnings,
            profileJson: profileJson as unknown as Prisma.InputJsonValue
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return {
      userId,
      currentProfile: this.toCurrentProfileResponse(profile)
    };
  }

  async persistAiArtifactForUser(
    userId: string,
    artifact: unknown
  ): Promise<CurrentProfileResponseDto> {
    const mapped = mapFormativeProfileResultArtifact(artifact);
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true
      }
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const generatedAt = new Date();
    const profile = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.formativeProfile.updateMany({
          where: {
            userId,
            isCurrent: true
          },
          data: {
            isCurrent: false
          }
        });

        return transaction.formativeProfile.create({
          data: {
            schemaVersion: FORMATIVE_PROFILE_SCHEMA_VERSION,
            userId,
            generatedAt,
            credentialsCount: mapped.credentialsCount,
            totalHours: new Prisma.Decimal(mapped.totalHours),
            profileVersion: mapped.profileVersion,
            isCurrent: true,
            generationMethod: mapped.generationMethod,
            areasSummary:
              mapped.areasSummary as unknown as Prisma.InputJsonValue,
            skillsSummary:
              mapped.skillsSummary as unknown as Prisma.InputJsonValue,
            evidenceByArea:
              mapped.evidenceByArea as unknown as Prisma.InputJsonValue,
            qualityFlags:
              mapped.qualityFlags as unknown as Prisma.InputJsonValue,
            profileJson:
              mapped.profileJson as unknown as Prisma.InputJsonValue
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return {
      userId,
      currentProfile: this.toCurrentProfileResponse(profile)
    };
  }

  private buildProfileJson(
    userId: string,
    credentials: Array<{
      id: string;
      type: CredentialType;
      hours: unknown;
      credentialSubject?: unknown;
      semanticAnalyses: Array<{
        id: string;
        analyzedAt: Date;
        confidence: unknown;
        areas: unknown;
        skills: unknown;
        concepts: unknown;
        analysisJson: unknown;
      }>;
      reusableSemanticInterpretations?: Array<{
        id: string;
        approvedSnapshot: unknown;
        snapshotVersion: string;
      }>;
    }>,
    generatedAt: Date
  ): FormativeProfileJson {
    const areaAccumulators = new Map<string, EvidenceAccumulator>();
    const skillAccumulators = new Map<string, EvidenceAccumulator>();
    const conceptAccumulators = new Map<string, EvidenceAccumulator>();
    const emittedSkillAccumulators = new Map<
      string,
      EmittedEvidenceAccumulator
    >();
    const emittedCompetencyAccumulators = new Map<
      string,
      EmittedEvidenceAccumulator
    >();
    const emittedLearningOutcomeAccumulators = new Map<
      string,
      EmittedEvidenceAccumulator
    >();
    const semanticAnalysisIds: string[] = [];
    const reusableSemanticInterpretationIds: string[] = [];
    const globalConfidenceValues: number[] = [];
    const warnings = new Set<string>();
    const knownHours: number[] = [];
    let credentialsWithoutAnalysisButWithEmittedData = 0;
    // C2c: contadores derivados aditivos -- no cambian ninguna regla de
    // agregacion semantica existente, solo cuentan sobre los mismos datos
    // que el loop ya recorre.
    let credentialsWithoutHours = 0;
    let credentialsWithoutSemanticCoverage = 0;
    // C5b.1
    let credentialsWithReviewedInterpretation = 0;

    if (credentials.length === 0) {
      warnings.add('no_issued_credentials');
    }

    for (const credential of credentials) {
      const hours = this.toNullableNumber(credential.hours);
      if (hours !== null) {
        knownHours.push(hours);
      } else {
        credentialsWithoutHours += 1;
      }

      const hadEmittedSignal = this.aggregateEmittedEvidenceForCredential(
        credential.id,
        credential.type,
        credential.credentialSubject,
        emittedSkillAccumulators,
        emittedCompetencyAccumulators,
        emittedLearningOutcomeAccumulators
      );

      const resolved = this.resolveSemanticSourceForCredential(credential);

      if (resolved.kind === 'none' || resolved.kind === 'unsupported_reusable_interpretation') {
        if (resolved.kind === 'unsupported_reusable_interpretation') {
          // Fail-safe (seccion 5 del diseno): una interpretacion humana
          // aplicada nunca se ignora en silencio para volver a la IA
          // cruda -- esta Credential queda sin cobertura semantica, nunca
          // cae a su propio SemanticAnalysis.
          warnings.add('reusable_interpretation_snapshot_unsupported');
        }
        warnings.add('credential_without_semantic_analysis');
        credentialsWithoutSemanticCoverage += 1;
        if (hadEmittedSignal) {
          credentialsWithoutAnalysisButWithEmittedData += 1;
        }
        continue;
      }

      const { source } = resolved;
      if (source.provenance === 'issuer_reviewed') {
        reusableSemanticInterpretationIds.push(
          source.reusableInterpretationId as string
        );
        credentialsWithReviewedInterpretation += 1;
      } else {
        semanticAnalysisIds.push(source.semanticAnalysisId as string);
      }

      const globalConfidence = this.toNullableNumber(resolved.confidence);
      if (globalConfidence !== null) {
        globalConfidenceValues.push(globalConfidence);
      }

      this.aggregateEntries(areaAccumulators, resolved.areas, 'area', source);
      this.aggregateEntries(skillAccumulators, resolved.skills, 'skill', source);
      this.aggregateEntries(
        conceptAccumulators,
        resolved.concepts,
        'concept',
        source
      );
      this.addAreaHours(
        areaAccumulators,
        resolved.hoursDistributionEntries,
        source
      );

      // analysisJson (y por lo tanto sourceType) solo existe para
      // ai_inferred -- el snapshot aplicado nunca lo copia (no es un dato
      // semantico allowlisted, ver issuer-course-templates.helpers.ts).
      if (
        source.provenance === 'ai_inferred' &&
        this.readSourceType(resolved.analysisJson) === 'online_course_catalog'
      ) {
        warnings.add('online_course_catalog_not_completion_evidence');
      }
    }

    if (skillAccumulators.size === 0) {
      warnings.add('no_skills_detected');
    }

    if (globalConfidenceValues.length === 0) {
      warnings.add('confidence_not_available');
    }

    const areas = this.finalizeAreas(areaAccumulators);
    const skills = this.finalizeSkills(skillAccumulators);
    const concepts = this.finalizeConcepts(conceptAccumulators);
    const emittedSkills = this.finalizeEmitted(emittedSkillAccumulators);
    const emittedCompetencies = this.finalizeEmitted(
      emittedCompetencyAccumulators
    );
    const emittedLearningOutcomes = this.finalizeEmitted(
      emittedLearningOutcomeAccumulators
    );
    const totalHours =
      knownHours.length > 0 ? this.round(this.sum(knownHours), 2) : null;
    const analyzedCredentialsCount =
      semanticAnalysisIds.length + reusableSemanticInterpretationIds.length;

    if (credentials.length > 0) {
      if (credentialsWithoutAnalysisButWithEmittedData > 0) {
        warnings.add('credential_without_semantic_analysis_has_emitted_data');
      }
      if (
        emittedSkillAccumulators.size === 0 &&
        emittedCompetencyAccumulators.size === 0 &&
        emittedLearningOutcomeAccumulators.size === 0
      ) {
        warnings.add('no_emitted_skills_available');
      }
      if (analyzedCredentialsCount < credentials.length) {
        warnings.add('profile_partially_built');
      }
      if (totalHours === null) {
        warnings.add('total_hours_unavailable');
      }
      if (areas.some((area) => area.estimatedHours !== null)) {
        warnings.add('area_hours_are_estimated_not_emitted');
      }
    }

    return {
      profileVersion: PROFILE_VERSION,
      generatedAt: generatedAt.toISOString(),
      userId,
      generatedFrom: {
        credentialIds: credentials.map((credential) => credential.id).sort(),
        semanticAnalysisIds: semanticAnalysisIds.sort(),
        reusableSemanticInterpretationIds: reusableSemanticInterpretationIds.sort()
      },
      summary: {
        credentialsCount: credentials.length,
        analyzedCredentialsCount,
        totalHours,
        totalOfficialHours: totalHours,
        credentialsWithoutHours,
        credentialsWithoutSemanticCoverage,
        credentialsWithReviewedInterpretation
      },
      narrative: this.buildNarrative({
        credentialsCount: credentials.length,
        totalHours,
        credentialsWithoutHours,
        credentialsWithoutSemanticCoverage,
        areas,
        skills,
        emittedCompetencies,
        emittedLearningOutcomes
      }),
      areas,
      skills,
      concepts,
      emittedSkills,
      emittedCompetencies,
      emittedLearningOutcomes,
      confidence: {
        score:
          globalConfidenceValues.length > 0
            ? this.round(this.average(globalConfidenceValues), 4)
            : null,
        method:
          globalConfidenceValues.length > 0 ? 'derived' : 'unavailable'
      },
      warnings: [...warnings].sort()
    };
  }

  // Resuelve, para UNA Credential, cual fuente semantica participa del
  // perfil -- issuer_reviewed > ai_inferred > ninguna. Nunca combina ambas
  // para la misma Credential (la prioridad es estrictamente por-Credential,
  // nunca global entre Credentials distintas -- ver seccion 11 del diseno).
  private resolveSemanticSourceForCredential(credential: {
    id: string;
    semanticAnalyses: Array<{
      id: string;
      confidence: unknown;
      areas: unknown;
      skills: unknown;
      concepts: unknown;
      analysisJson: unknown;
    }>;
    reusableSemanticInterpretations?: Array<{
      id: string;
      approvedSnapshot: unknown;
      snapshotVersion: string;
    }>;
  }): ResolvedSemanticSource {
    const active = credential.reusableSemanticInterpretations?.[0];

    if (active) {
      const parsed = this.parseAppliedReusableSnapshot(
        active.approvedSnapshot,
        active.snapshotVersion
      );

      if (!parsed) {
        return { kind: 'unsupported_reusable_interpretation' };
      }

      return {
        kind: 'issuer_reviewed',
        source: {
          credentialId: credential.id,
          provenance: 'issuer_reviewed',
          reusableInterpretationId: active.id
        },
        areas: parsed.areas,
        skills: parsed.skills,
        concepts: parsed.concepts,
        hoursDistributionEntries: parsed.hoursDistribution,
        confidence: parsed.confidence,
        analysisJson: null
      };
    }

    const semanticAnalysis = credential.semanticAnalyses[0];
    if (!semanticAnalysis) {
      return { kind: 'none' };
    }

    return {
      kind: 'ai_inferred',
      source: {
        credentialId: credential.id,
        provenance: 'ai_inferred',
        semanticAnalysisId: semanticAnalysis.id
      },
      areas: semanticAnalysis.areas,
      skills: semanticAnalysis.skills,
      concepts: semanticAnalysis.concepts,
      hoursDistributionEntries: this.readHoursDistribution(
        semanticAnalysis.analysisJson
      ),
      confidence: semanticAnalysis.confidence,
      analysisJson: semanticAnalysis.analysisJson
    };
  }

  // C5b.1/seccion 4-5 del diseno: el perfil consume EXCLUSIVAMENTE
  // active.approvedSnapshot, ya congelado -- nunca vuelve a leer
  // IssuerCourseTemplate.approvedSemanticSnapshot, nunca reconstruye desde
  // el SemanticAnalysis fuente, nunca lee la aprobacion viva actual del
  // template. Solo se soporta la version que C4b.1b realmente puede
  // persistir en una fila aplicada -- confirmado por auditoria de
  // issuer-course-templates.service.ts: unicamente
  // buildReviewedApprovedTemplateSemanticSnapshot (schema v2) llega a
  // escribirse en IssuerCourseTemplate.approvedSemanticSnapshot, y C4b.1b
  // copia ese valor tal cual. Cualquier otra version/snapshot invalido es
  // tratado como no consumible (fail-safe), nunca como "IA cruda".
  //
  // C5b.1-R: `snapshotVersion` debe coincidir con el schema real del v2 Y
  // el propio `approvedSnapshot.schema` debe coincidir tambien -- ambos se
  // exigen (no alcanza con que uno de los dos diga v2). El contenido se
  // valida con `parseReviewedApprovedTemplateSemanticSnapshot`
  // (validacion ESTRICTA, ver mas abajo), nunca con
  // `buildApprovedSemanticSnapshotSummary` (helper tolerante de
  // `issuer-course-templates.helpers.ts`, disenado para construir un
  // resumen seguro de UI para C4a/C4b -- nunca se toca ese helper ni su
  // contrato tolerante, que otros consumers siguen necesitando tal cual).
  private parseAppliedReusableSnapshot(
    approvedSnapshot: unknown,
    snapshotVersion: string
  ): {
    areas: ApprovedSemanticSnapshotDescriptor[];
    skills: ApprovedSemanticSnapshotDescriptor[];
    concepts: ApprovedSemanticSnapshotDescriptor[];
    hoursDistribution: ApprovedSemanticSnapshotHoursDistributionEntry[];
    confidence: number | null;
  } | null {
    if (snapshotVersion !== REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA) {
      return null;
    }

    const snapshot =
      this.parseReviewedApprovedTemplateSemanticSnapshot(approvedSnapshot);
    if (!snapshot) {
      return null;
    }

    return {
      areas: snapshot.areas,
      skills: snapshot.skills,
      concepts: snapshot.concepts,
      hoursDistribution: snapshot.hoursDistribution,
      confidence: snapshot.confidence
    };
  }

  // C5b.1-R: validacion ESTRICTA especifica para consumo interno del
  // snapshot aplicado. Deliberadamente separada de
  // `buildApprovedSemanticSnapshotSummary` (que exige solo `schema`
  // no-vacio + `status` valido, y usa `Array.isArray(x) ? x : []` para
  // areas/skills/concepts/hoursDistribution SOLO para contarlos en un
  // resumen -- nunca valida el shape de cada elemento). Esta funcion, en
  // cambio, afirma que el Json es REALMENTE un
  // `ReviewedApprovedTemplateSemanticSnapshot` (tipo real exportado por
  // issuer-course-templates.helpers.ts, producido unicamente por
  // `buildReviewedApprovedTemplateSemanticSnapshot`) antes de dejarlo
  // alimentar areas/skills/concepts/hoursDistribution/confidence del
  // perfil. Todo o nada -- nunca hace "partial salvage" de un array con
  // elementos invalidos: si UN elemento no cumple el shape real, el
  // snapshot COMPLETO se rechaza (unsupported_reusable_interpretation),
  // nunca se descarta silenciosamente solo ese elemento.
  //
  // No exige `semanticAnalysisSchema`/`sourceSemanticAnalysisId`/
  // `originalSummary`/`warnings`/`qualityFlags`/`review.note`: el perfil
  // nunca los consume, y su ausencia/forma no afecta la correccion de lo
  // que si se consume. Si exige `review.issuerReviewed === true` (marca
  // literal que el builder real siempre escribe) porque es la unica
  // invariante que distingue genuinamente un snapshot "revisado por el
  // emisor" de un Json arbitrario con `schema`/`status` copiados.
  private parseReviewedApprovedTemplateSemanticSnapshot(
    value: unknown
  ): ReviewedApprovedTemplateSemanticSnapshot | null {
    if (!this.isRecord(value)) {
      return null;
    }
    if (value.schema !== REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA) {
      return null;
    }
    if (value.status !== 'completed' && value.status !== 'partial') {
      return null;
    }
    if (!this.isRecord(value.review) || value.review.issuerReviewed !== true) {
      return null;
    }
    if (
      !Array.isArray(value.areas) ||
      !value.areas.every((entry) => this.isValidSemanticDescriptor(entry))
    ) {
      return null;
    }
    if (
      !Array.isArray(value.skills) ||
      !value.skills.every((entry) => this.isValidSemanticDescriptor(entry))
    ) {
      return null;
    }
    if (
      !Array.isArray(value.concepts) ||
      !value.concepts.every((entry) => this.isValidSemanticDescriptor(entry))
    ) {
      return null;
    }
    if (
      !Array.isArray(value.hoursDistribution) ||
      !value.hoursDistribution.every((entry) =>
        this.isValidHoursDistributionEntry(entry)
      )
    ) {
      return null;
    }
    if (!this.isValidTopLevelSnapshotConfidence(value.confidence)) {
      return null;
    }

    return value as unknown as ReviewedApprovedTemplateSemanticSnapshot;
  }

  // Mismo contrato real que `readDescriptorArray`
  // (issuer-course-templates.helpers.ts): `id`/`label` no vacios,
  // `confidence` un numero finito o null -- SIN el clamp [0,1], que ese
  // builder solo aplica a la confidence de nivel superior del snapshot
  // (`readConfidenceValue`), nunca a cada descriptor individual.
  private isValidSemanticDescriptor(
    value: unknown
  ): value is ApprovedSemanticSnapshotDescriptor {
    if (!this.isRecord(value)) {
      return false;
    }
    if (typeof value.id !== 'string' || value.id.trim().length === 0) {
      return false;
    }
    if (typeof value.label !== 'string' || value.label.trim().length === 0) {
      return false;
    }
    return value.confidence === null || this.isFiniteNumber(value.confidence);
  }

  // Mismo contrato real que `readHoursDistribution`
  // (issuer-course-templates.helpers.ts): `areaId` string no vacio,
  // `hours` un numero finito (sin restriccion de rango adicional -- el
  // builder real tampoco la aplica).
  private isValidHoursDistributionEntry(
    value: unknown
  ): value is ApprovedSemanticSnapshotHoursDistributionEntry {
    if (!this.isRecord(value)) {
      return false;
    }
    if (typeof value.areaId !== 'string' || value.areaId.trim().length === 0) {
      return false;
    }
    return this.isFiniteNumber(value.hours);
  }

  // Mismo contrato real que `readConfidenceValue`
  // (issuer-course-templates.helpers.ts): unicamente la confidence de
  // NIVEL SUPERIOR del snapshot exige el clamp [0,1] -- nunca NaN,
  // Infinity, string ni object.
  private isValidTopLevelSnapshotConfidence(
    value: unknown
  ): value is number | null {
    return (
      value === null ||
      (this.isFiniteNumber(value) && value >= 0 && value <= 1)
    );
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private buildNarrative(input: {
    credentialsCount: number;
    totalHours: number | null;
    credentialsWithoutHours: number;
    credentialsWithoutSemanticCoverage: number;
    areas: ProfileArea[];
    skills: ProfileSkill[];
    emittedCompetencies: ProfileEmittedEntry[];
    emittedLearningOutcomes: ProfileEmittedEntry[];
  }): string | null {
    if (input.credentialsCount === 0) {
      return null;
    }

    const fragments = ['Segun las credenciales emitidas y los analisis disponibles, la trayectoria muestra formacion'];
    const areas = input.areas.slice(0, 3).map((area) => area.area);
    const skills = input.skills.slice(0, 4).map((skill) => skill.skill);
    const declared = [
      ...input.emittedCompetencies.slice(0, 2).map((item) => item.label),
      ...input.emittedLearningOutcomes.slice(0, 2).map((item) => item.label)
    ];

    if (areas.length > 0) {
      fragments[0] += ` en ${this.naturalList(areas)}.`;
    } else if (declared.length > 0) {
      fragments[0] += ` en contenidos declarados por el emisor.`;
    } else {
      fragments[0] += ` en las credenciales registradas.`;
    }

    if (skills.length > 0) {
      fragments.push(`Se observan contenidos relacionados con ${this.naturalList(skills)}.`);
    }

    if (input.totalHours !== null) {
      fragments.push(`Las horas oficiales declaradas suman ${input.totalHours}.`);
    }
    if (input.credentialsWithoutHours > 0) {
      fragments.push('La cobertura de horas es parcial porque algunas credenciales no las informan.');
    }
    if (input.credentialsWithoutSemanticCoverage > 0) {
      fragments.push('La cobertura semantica todavia es parcial porque algunas credenciales no tienen analisis disponible.');
    }

    return fragments.join(' ');
  }

  private naturalList(labels: string[]): string {
    if (labels.length <= 1) return labels[0] ?? '';
    if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
  }

  /**
   * Agrega competencias y resultados de una credencial a los acumuladores
   * "emitted*", junto con skills declaradas solo cuando el tipo lo permite.
   * Las skills legacy de course se preservan en la credencial, pero no se usan
   * para reconstruir el perfil: las skills de cursos deben ser inferidas.
   * El resto es dato cargado por el emisor,
   * no una inferencia de IA: nunca toca los acumuladores inferidos
   * (areaAccumulators/skillAccumulators/conceptAccumulators). Devuelve true
   * si la credencial aporto al menos una etiqueta emitida.
   */
  private aggregateEmittedEvidenceForCredential(
    credentialId: string,
    credentialType: CredentialType,
    credentialSubject: unknown,
    skillAccumulators: Map<string, EmittedEvidenceAccumulator>,
    competencyAccumulators: Map<string, EmittedEvidenceAccumulator>,
    learningOutcomeAccumulators: Map<string, EmittedEvidenceAccumulator>
  ): boolean {
    const skills =
      credentialType === CredentialType.course
        ? []
        : this.readEmittedStringArray(credentialSubject, 'skill');
    const competencies = this.readEmittedStringArray(
      credentialSubject,
      'competency'
    );
    const learningOutcomes = this.readEmittedStringArray(
      credentialSubject,
      'learningOutcome'
    );

    this.aggregateEmittedEntries(skillAccumulators, skills, credentialId);
    this.aggregateEmittedEntries(
      competencyAccumulators,
      competencies,
      credentialId
    );
    this.aggregateEmittedEntries(
      learningOutcomeAccumulators,
      learningOutcomes,
      credentialId
    );

    return (
      skills.length > 0 || competencies.length > 0 || learningOutcomes.length > 0
    );
  }

  private aggregateEmittedEntries(
    accumulators: Map<string, EmittedEvidenceAccumulator>,
    labels: string[],
    credentialId: string
  ) {
    for (const label of labels) {
      const key = this.normalizeKey(label);
      const accumulator = accumulators.get(key) ?? {
        labels: new Set<string>(),
        credentialIds: new Set<string>()
      };
      accumulator.labels.add(label);
      accumulator.credentialIds.add(credentialId);
      accumulators.set(key, accumulator);
    }
  }

  private readEmittedStringArray(
    credentialSubject: unknown,
    kind: EmittedEntryKind
  ): string[] {
    if (!this.isRecord(credentialSubject)) {
      return [];
    }

    const field = CREDENTIAL_SUBJECT_EMITTED_FIELDS[kind];
    const value = credentialSubject[field];
    if (!Array.isArray(value)) {
      return [];
    }

    const labels: string[] = [];
    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }
      const normalized = this.normalizeLabel(entry);
      if (normalized) {
        labels.push(normalized);
      }
    }
    return labels;
  }

  private finalizeEmitted(
    accumulators: Map<string, EmittedEvidenceAccumulator>
  ): ProfileEmittedEntry[] {
    return [...new Set(accumulators.values())]
      .sort((left, right) =>
        this.compareStrings(
          this.preferredEmittedLabel(left).toLowerCase(),
          this.preferredEmittedLabel(right).toLowerCase()
        )
      )
      .map((accumulator) => ({
        label: this.preferredEmittedLabel(accumulator),
        credentialIds: [...accumulator.credentialIds].sort(),
        evidenceCount: accumulator.credentialIds.size
      }));
  }

  private preferredEmittedLabel(
    accumulator: EmittedEvidenceAccumulator
  ): string {
    return [...accumulator.labels].sort((left, right) =>
      this.compareStrings(left, right)
    )[0];
  }

  private aggregateEntries(
    accumulators: Map<string, EvidenceAccumulator>,
    value: unknown,
    kind: SemanticEntryKind,
    source: ProfileEvidenceSource
  ) {
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value) {
      const label = this.readLabel(entry, kind);
      if (!label) {
        continue;
      }

      const aliases = [label];
      if (this.isRecord(entry) && typeof entry.id === 'string') {
        const id = this.normalizeLabel(entry.id);
        if (id) {
          aliases.push(id);
        }
      }

      const accumulator =
        aliases
          .map((alias) => accumulators.get(this.normalizeKey(alias)))
          .find((candidate) => candidate !== undefined) ??
        this.getAccumulator(accumulators, label);
      for (const alias of aliases) {
        accumulators.set(this.normalizeKey(alias), accumulator);
      }

      accumulator.labels.add(label);
      // Una entrada por Credential -- nunca duplica esta misma Credential
      // aunque la etiqueta aparezca varias veces en su propio snapshot/
      // analisis (dedup antes de sumar provenance, seccion 10 del diseno).
      accumulator.sources.set(source.credentialId, source);

      const confidence = this.readObjectNumber(entry, 'confidence');
      if (confidence !== null) {
        accumulator.confidenceValues.push(confidence);
      }
    }
  }

  private addAreaHours(
    accumulators: Map<string, EvidenceAccumulator>,
    hoursDistributionEntries: unknown[],
    source: ProfileEvidenceSource
  ) {
    for (const entry of hoursDistributionEntries) {
      if (!this.isRecord(entry)) {
        continue;
      }

      const label = this.readFirstString(entry, [
        'area',
        'areaId',
        'area_id',
        'label',
        'name'
      ]);
      const hours = this.readObjectNumber(entry, 'hours');
      if (!label || hours === null) {
        continue;
      }

      const accumulator = this.getAccumulator(accumulators, label);
      accumulator.labels.add(label);
      accumulator.sources.set(source.credentialId, source);
      accumulator.estimatedHours.push(hours);
    }
  }

  private finalizeAreas(
    accumulators: Map<string, EvidenceAccumulator>
  ): ProfileArea[] {
    return this.sortedAccumulators(accumulators).map((accumulator) => ({
      area: this.preferredLabel(accumulator),
      ...this.toEvidence(accumulator),
      estimatedHours:
        accumulator.estimatedHours.length > 0
          ? this.round(this.sum(accumulator.estimatedHours), 2)
          : null
    }));
  }

  private finalizeSkills(
    accumulators: Map<string, EvidenceAccumulator>
  ): ProfileSkill[] {
    return this.sortedAccumulators(accumulators).map((accumulator) => ({
      skill: this.preferredLabel(accumulator),
      ...this.toEvidence(accumulator),
      confidence:
        accumulator.confidenceValues.length > 0
          ? this.round(this.average(accumulator.confidenceValues), 4)
          : null
    }));
  }

  private finalizeConcepts(
    accumulators: Map<string, EvidenceAccumulator>
  ): ProfileConcept[] {
    return this.sortedAccumulators(accumulators).map((accumulator) => ({
      concept: this.preferredLabel(accumulator),
      ...this.toEvidence(accumulator)
    }));
  }

  private toEvidence(accumulator: EvidenceAccumulator): ProfileEvidence {
    // Determinismo (seccion 16 del diseno): siempre ordenado por
    // credentialId, sin importar el orden en que la query devolvio las
    // Credentials ni el orden de sus arrays internos.
    const sources = [...accumulator.sources.values()].sort((left, right) =>
      this.compareStrings(left.credentialId, right.credentialId)
    );
    const semanticAnalysisIds = sources
      .filter((entry) => entry.provenance === 'ai_inferred')
      .map((entry) => entry.semanticAnalysisId as string)
      .sort();

    return {
      credentialIds: sources.map((entry) => entry.credentialId),
      semanticAnalysisIds,
      evidenceCount: sources.length,
      sources,
      provenanceSummary: {
        issuerReviewedCount: sources.filter(
          (entry) => entry.provenance === 'issuer_reviewed'
        ).length,
        aiInferredCount: sources.filter(
          (entry) => entry.provenance === 'ai_inferred'
        ).length
      }
    };
  }

  private sortedAccumulators(
    accumulators: Map<string, EvidenceAccumulator>
  ): EvidenceAccumulator[] {
    return [...new Set(accumulators.values())].sort((left, right) =>
      this.compareStrings(
        this.preferredLabel(left).toLowerCase(),
        this.preferredLabel(right).toLowerCase()
      )
    );
  }

  private preferredLabel(accumulator: EvidenceAccumulator): string {
    return [...accumulator.labels].sort((left, right) =>
      this.compareStrings(left, right)
    )[0];
  }

  private getAccumulator(
    accumulators: Map<string, EvidenceAccumulator>,
    label: string
  ): EvidenceAccumulator {
    const key = this.normalizeKey(label);
    const existing = accumulators.get(key);
    if (existing) {
      return existing;
    }

    const accumulator: EvidenceAccumulator = {
      labels: new Set(),
      sources: new Map(),
      confidenceValues: [],
      estimatedHours: []
    };
    accumulators.set(key, accumulator);
    return accumulator;
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase();
  }

  private readLabel(value: unknown, kind: SemanticEntryKind): string | null {
    if (typeof value === 'string') {
      return this.normalizeLabel(value);
    }

    if (!this.isRecord(value)) {
      return null;
    }

    return this.readFirstString(value, LABEL_FIELDS[kind]);
  }

  private readFirstString(
    value: Record<string, unknown>,
    fields: readonly string[]
  ): string | null {
    for (const field of fields) {
      const candidate = value[field];
      if (typeof candidate === 'string') {
        const normalized = this.normalizeLabel(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  private normalizeLabel(value: string): string | null {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : null;
  }

  private readObjectNumber(value: unknown, field: string): number | null {
    if (!this.isRecord(value)) {
      return null;
    }

    return this.toNullableNumber(value[field]);
  }

  private readHoursDistribution(value: unknown): unknown[] {
    if (!this.isRecord(value)) {
      return [];
    }

    if (Array.isArray(value.hoursDistribution)) {
      return value.hoursDistribution;
    }

    const mapped = value.mapped;
    if (
      this.isRecord(mapped) &&
      this.isRecord(mapped.metadata) &&
      Array.isArray(mapped.metadata.hoursDistribution)
    ) {
      return mapped.metadata.hoursDistribution;
    }

    return [];
  }

  private readSourceType(value: unknown): string | null {
    if (!this.isRecord(value)) {
      return null;
    }

    if (typeof value.sourceType === 'string') {
      return value.sourceType;
    }

    const mapped = value.mapped;
    if (
      this.isRecord(mapped) &&
      this.isRecord(mapped.metadata) &&
      typeof mapped.metadata.sourceType === 'string'
    ) {
      return mapped.metadata.sourceType;
    }

    return null;
  }

  private toCurrentProfileResponse(
    profile: FormativeProfile
  ): FormativeProfileSnapshotDto {
    const profileJson = this.isRecord(profile.profileJson)
      ? profile.profileJson
      : null;
    const summary =
      profileJson && this.isRecord(profileJson.summary)
        ? profileJson.summary
        : null;
    const totalHours =
      summary && ('totalHours' in summary)
        ? this.toNullableNumber(summary.totalHours)
        : this.toNullableNumber(profile.totalHours);

    return {
      id: profile.id,
      profileVersion: profile.profileVersion ?? profile.schemaVersion,
      isCurrent: profile.isCurrent,
      credentialsCount: profile.credentialsCount,
      totalHours,
      areasSummary: profile.areasSummary,
      skillsSummary: profile.skillsSummary,
      qualityFlags: profile.qualityFlags,
      generatedAt: profile.generatedAt.toISOString(),
      profileJson: profile.profileJson
    };
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }

  private average(values: number[]): number {
    return this.sum(values) / values.length;
  }

  private round(value: number, decimalPlaces: number): number {
    const factor = 10 ** decimalPlaces;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
