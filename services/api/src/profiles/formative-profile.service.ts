import { Injectable } from '@nestjs/common';
import {
  CredentialStatus,
  Prisma,
  type FormativeProfile
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  type CurrentProfileResponseDto,
  type FormativeProfileSnapshotDto
} from './dto/current-profile-response.dto';

const PROFILE_VERSION = 'formative_profile_result_v0';
const PROFILE_SCHEMA_VERSION = 'formative_profile_v1';
const GENERATION_METHOD = 'backend_deterministic_aggregation_v0';

const LABEL_FIELDS = {
  area: ['area', 'name', 'label', 'area_label', 'areaLabel'],
  skill: ['skill', 'name', 'label', 'skill_label', 'skillLabel'],
  concept: ['concept', 'name', 'label', 'concept_label', 'conceptLabel']
} as const;

interface EvidenceAccumulator {
  labels: Set<string>;
  credentialIds: Set<string>;
  semanticAnalysisIds: Set<string>;
  confidenceValues: number[];
  estimatedHours: number[];
}

interface ProfileEvidence {
  credentialIds: string[];
  semanticAnalysisIds: string[];
  evidenceCount: number;
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

interface FormativeProfileJson {
  profileVersion: typeof PROFILE_VERSION;
  generatedAt: string;
  userId: string;
  generatedFrom: {
    credentialIds: string[];
    semanticAnalysisIds: string[];
  };
  summary: {
    credentialsCount: number;
    analyzedCredentialsCount: number;
    totalHours: number | null;
  };
  areas: ProfileArea[];
  skills: ProfileSkill[];
  concepts: ProfileConcept[];
  confidence: {
    score: number | null;
    method: 'derived' | 'unavailable';
  };
  warnings: string[];
}

type SemanticEntryKind = keyof typeof LABEL_FIELDS;

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
        hours: true,
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

  private buildProfileJson(
    userId: string,
    credentials: Array<{
      id: string;
      hours: unknown;
      semanticAnalyses: Array<{
        id: string;
        analyzedAt: Date;
        confidence: unknown;
        areas: unknown;
        skills: unknown;
        concepts: unknown;
        analysisJson: unknown;
      }>;
    }>,
    generatedAt: Date
  ): FormativeProfileJson {
    const areaAccumulators = new Map<string, EvidenceAccumulator>();
    const skillAccumulators = new Map<string, EvidenceAccumulator>();
    const conceptAccumulators = new Map<string, EvidenceAccumulator>();
    const semanticAnalysisIds: string[] = [];
    const globalConfidenceValues: number[] = [];
    const warnings = new Set<string>();
    const knownHours: number[] = [];

    if (credentials.length === 0) {
      warnings.add('no_issued_credentials');
    }

    for (const credential of credentials) {
      const hours = this.toNullableNumber(credential.hours);
      if (hours !== null) {
        knownHours.push(hours);
      }

      const semanticAnalysis = credential.semanticAnalyses[0];
      if (!semanticAnalysis) {
        warnings.add('credential_without_semantic_analysis');
        continue;
      }

      semanticAnalysisIds.push(semanticAnalysis.id);
      const globalConfidence = this.toNullableNumber(
        semanticAnalysis.confidence
      );
      if (globalConfidence !== null) {
        globalConfidenceValues.push(globalConfidence);
      }

      this.aggregateEntries(
        areaAccumulators,
        semanticAnalysis.areas,
        'area',
        credential.id,
        semanticAnalysis.id
      );
      this.aggregateEntries(
        skillAccumulators,
        semanticAnalysis.skills,
        'skill',
        credential.id,
        semanticAnalysis.id
      );
      this.aggregateEntries(
        conceptAccumulators,
        semanticAnalysis.concepts,
        'concept',
        credential.id,
        semanticAnalysis.id
      );
      this.addAreaHours(
        areaAccumulators,
        semanticAnalysis.analysisJson,
        credential.id,
        semanticAnalysis.id
      );

      if (
        this.readSourceType(semanticAnalysis.analysisJson) ===
        'online_course_catalog'
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

    return {
      profileVersion: PROFILE_VERSION,
      generatedAt: generatedAt.toISOString(),
      userId,
      generatedFrom: {
        credentialIds: credentials.map((credential) => credential.id).sort(),
        semanticAnalysisIds: semanticAnalysisIds.sort()
      },
      summary: {
        credentialsCount: credentials.length,
        analyzedCredentialsCount: semanticAnalysisIds.length,
        totalHours:
          knownHours.length > 0 ? this.round(this.sum(knownHours), 2) : null
      },
      areas: this.finalizeAreas(areaAccumulators),
      skills: this.finalizeSkills(skillAccumulators),
      concepts: this.finalizeConcepts(conceptAccumulators),
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

  private aggregateEntries(
    accumulators: Map<string, EvidenceAccumulator>,
    value: unknown,
    kind: SemanticEntryKind,
    credentialId: string,
    semanticAnalysisId: string
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
      accumulator.credentialIds.add(credentialId);
      accumulator.semanticAnalysisIds.add(semanticAnalysisId);

      const confidence = this.readObjectNumber(entry, 'confidence');
      if (confidence !== null) {
        accumulator.confidenceValues.push(confidence);
      }
    }
  }

  private addAreaHours(
    accumulators: Map<string, EvidenceAccumulator>,
    analysisJson: unknown,
    credentialId: string,
    semanticAnalysisId: string
  ) {
    const hoursDistribution = this.readHoursDistribution(analysisJson);
    for (const entry of hoursDistribution) {
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
      accumulator.credentialIds.add(credentialId);
      accumulator.semanticAnalysisIds.add(semanticAnalysisId);
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
    return {
      credentialIds: [...accumulator.credentialIds].sort(),
      semanticAnalysisIds: [...accumulator.semanticAnalysisIds].sort(),
      evidenceCount: accumulator.semanticAnalysisIds.size
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
      credentialIds: new Set(),
      semanticAnalysisIds: new Set(),
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
