import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { CourseTemplateStatus, CredentialType, Prisma } from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseTemplateResponseDto } from './dto/course-template-response.dto';
import { TemplateSemanticApprovalCandidateResponseDto } from './dto/template-semantic-approval-candidate-response.dto';
import {
  assertSemanticAnalysisStatusIsUsable,
  buildApprovedTemplateSemanticSnapshot,
  normalizeTitleForComparison,
  readSubjectStringArray,
  readSubjectText,
  resolveReusableCredentialType,
  resolveTemplateTitleFromCredential,
  toJsonObject
} from './issuer-course-templates.helpers';
import {
  mapCourseTemplateResponse,
  type CourseTemplateRecord
} from './issuer-course-templates.mapper';
import {
  validateCreateCourseTemplatePayload,
  validatePatchCourseTemplatePayload
} from './issuer-course-templates.validator';

export const DEFAULT_COURSE_TEMPLATE_LIMIT = 20;
const MAX_SEARCH_LENGTH = 255;
const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const TEMPLATE_NOT_FOUND_MESSAGE =
  'No se encontro el template reutilizable solicitado.';
const DUPLICATE_TEMPLATE_MESSAGE =
  'Este curso ya fue guardado como reutilizable.';
const SEMANTIC_ANALYSIS_NOT_FOUND_MESSAGE =
  'No se encontro la interpretacion semantica solicitada.';
const SEMANTIC_ANALYSIS_TYPE_MISMATCH_MESSAGE =
  'El tipo de la credencial analizada no coincide con el tipo del template.';
const SEMANTIC_ANALYSIS_SOURCE_CREDENTIAL_MISMATCH_MESSAGE =
  'Este template solo puede aprobar interpretaciones semanticas de la credencial con la que fue creado.';

const COURSE_TEMPLATE_RESPONSE_SELECT = {
  id: true,
  credentialType: true,
  title: true,
  description: true,
  hours: true,
  modality: true,
  platformName: true,
  externalUrl: true,
  certificationCode: true,
  expirationDate: true,
  providerName: true,
  level: true,
  skills: true,
  competencies: true,
  learningOutcomes: true,
  status: true,
  createdFromCredentialId: true,
  lastSemanticAnalysisId: true,
  approvedSemanticAnalysisId: true,
  approvedSemanticSnapshot: true,
  approvedSemanticApprovedAt: true,
  approvedSemanticPipelineVersion: true,
  approvedSemanticTaxonomyVersion: true,
  approvedSemanticSourceCredentialId: true,
  createdAt: true,
  updatedAt: true
} as const;

type CourseTemplateStatusFilter = 'active' | 'archived' | 'all';
// C3c: filtro opcional para que el selector de la creacion de credenciales
// pueda pedir solo el tipo que le interesa (course o certification) sin
// arriesgarse a que el limite fijo de 20 resultados oculte templates del
// tipo buscado cuando ambos tipos comparten el mismo catalogo.
type CourseTemplateCredentialTypeFilter = 'course' | 'certification' | 'all';

@Injectable()
export class IssuerCourseTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async listTemplatesForIssuer(
    issuerId: string,
    query: { search?: unknown; status?: unknown; credentialType?: unknown },
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto[]> {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const statusFilter = normalizeStatusFilter(query.status);
    const credentialTypeFilter = normalizeCredentialTypeFilter(
      query.credentialType
    );
    const search = normalizeSearch(query.search);
    const where: Prisma.IssuerCourseTemplateWhereInput = {
      issuerId,
      ...(statusFilter === 'all' ? {} : { status: toStatusEnum(statusFilter) }),
      ...(credentialTypeFilter === 'all'
        ? {}
        : { credentialType: toCredentialTypeEnum(credentialTypeFilter) })
    };

    // C3a.2/C3c: el mismo catalogo/endpoint sirve course y certification
    // juntos. Por default (sin credentialType) list sigue devolviendo ambos
    // mezclados -- comportamiento sin cambios respecto a C3a.2. El filtro
    // opcional existe para que un consumidor (ej. el selector de C3c) pueda
    // pedir solo el tipo que le interesa.
    const templates = (await this.prisma.issuerCourseTemplate.findMany({
      where,
      select: COURSE_TEMPLATE_RESPONSE_SELECT,
      orderBy: [{ updatedAt: 'desc' }],
      ...(search ? {} : { take: DEFAULT_COURSE_TEMPLATE_LIMIT })
    })) as CourseTemplateRecord[];

    return templates
      .filter((template) => matchesSearch(template, search))
      .slice(0, DEFAULT_COURSE_TEMPLATE_LIMIT)
      .map(mapCourseTemplateResponse);
  }

  async createTemplateForIssuer(
    issuerId: string,
    dto: unknown,
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const normalized = validateCreateCourseTemplatePayload(dto);

    const created = (await this.prisma.issuerCourseTemplate.create({
      data: {
        issuerId,
        createdByUserId: currentUser.id,
        status: CourseTemplateStatus.active,
        credentialType: normalized.credentialType,
        title: normalized.title,
        description: normalized.description,
        hours: normalized.hours,
        modality: normalized.modality,
        platformName: normalized.platformName,
        externalUrl: normalized.externalUrl,
        certificationCode: normalized.certificationCode,
        expirationDate: normalized.expirationDate,
        providerName: normalized.providerName,
        level: normalized.level,
        skills: normalized.skills,
        competencies: normalized.competencies,
        learningOutcomes: normalized.learningOutcomes
      },
      select: COURSE_TEMPLATE_RESPONSE_SELECT
    })) as CourseTemplateRecord;

    return mapCourseTemplateResponse(created);
  }

  async createTemplateFromCredentialForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: {
        id: credentialId,
        issuerId
      },
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        hours: true,
        credentialSubject: true,
        semanticAnalyses: {
          orderBy: { analyzedAt: 'desc' },
          take: 1,
          select: { id: true }
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    // C3a.2: academic_subject y degree se rechazan aca (400) -- solo
    // course/certification pueden guardarse como reutilizables.
    const credentialType = resolveReusableCredentialType(credential.type);

    const subject = toJsonObject(credential.credentialSubject);
    const title = resolveTemplateTitleFromCredential(subject, credential.title);
    const normalizedTitleForComparison = normalizeTitleForComparison(title);

    const existingCandidates = await this.prisma.issuerCourseTemplate.findMany({
      where: {
        issuerId,
        createdFromCredentialId: credential.id,
        status: CourseTemplateStatus.active
      },
      select: { title: true }
    });

    const isDuplicate = existingCandidates.some(
      (candidate) =>
        normalizeTitleForComparison(candidate.title) ===
        normalizedTitleForComparison
    );

    if (isDuplicate) {
      throw new ConflictException(duplicateMessageFor(credentialType));
    }

    // Campos comunes a ambos tipos.
    const commonData = {
      title,
      description: normalizeNullableText(credential.description),
      hours: credential.hours,
      externalUrl: readSubjectText(subject, 'external_url'),
      competencies: readSubjectStringArray(subject, 'competencies'),
      // Lectura defensiva: certification no lo controla por contrato hoy,
      // pero se copia si existiera como dato legacy en credentialSubject
      // (nunca se inventa, readSubjectStringArray devuelve [] si no esta).
      learningOutcomes: readSubjectStringArray(subject, 'learning_outcomes')
    };

    // Campos exclusivos por tipo -- se omiten por completo (ni siquiera se
    // envian como null) para el tipo que no aplica, nunca se copian
    // cruzados (ej. course nunca copia certificationCode/providerName/
    // level/skills, y certification nunca copia modality/platformName).
    // C4x fix: platformName tampoco se copia hacia el nuevo template de
    // course, aunque exista como dato legacy en la credencial de origen --
    // el emisor activo es la fuente institucional, no un texto libre
    // heredado. El template nuevo nace siempre sin platformName.
    const typeSpecificData =
      credentialType === 'course'
        ? {
            modality: readSubjectText(subject, 'modality')
          }
        : {
            certificationCode: readSubjectText(subject, 'certification_code'),
            expirationDate: readSubjectText(subject, 'expiration_date'),
            providerName: readSubjectText(subject, 'provider_name'),
            level: readSubjectText(subject, 'level'),
            skills: readSubjectStringArray(subject, 'skills')
          };

    const created = (await this.prisma.issuerCourseTemplate.create({
      data: {
        issuerId,
        createdByUserId: currentUser.id,
        status: CourseTemplateStatus.active,
        credentialType,
        ...commonData,
        ...typeSpecificData,
        createdFromCredentialId: credential.id,
        lastSemanticAnalysisId: credential.semanticAnalyses[0]?.id ?? null
      },
      select: COURSE_TEMPLATE_RESPONSE_SELECT
    })) as CourseTemplateRecord;

    return mapCourseTemplateResponse(created);
  }

  async patchTemplateForIssuer(
    issuerId: string,
    templateId: string,
    dto: unknown,
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const existing = await this.prisma.issuerCourseTemplate.findFirst({
      where: { id: templateId, issuerId },
      select: { id: true, credentialType: true }
    });

    if (!existing) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND_MESSAGE);
    }

    const normalized = validatePatchCourseTemplatePayload(
      dto,
      existing.credentialType as 'course' | 'certification'
    );
    const data: Prisma.IssuerCourseTemplateUpdateInput = {};

    if (normalized.title.provided) {
      data.title = normalized.title.value;
    }
    if (normalized.description.provided) {
      data.description = normalized.description.value;
    }
    if (normalized.hours.provided) {
      data.hours = normalized.hours.value;
    }
    if (normalized.modality.provided) {
      data.modality = normalized.modality.value;
    }
    if (normalized.platformName.provided) {
      data.platformName = normalized.platformName.value;
    }
    if (normalized.externalUrl.provided) {
      data.externalUrl = normalized.externalUrl.value;
    }
    if (normalized.certificationCode.provided) {
      data.certificationCode = normalized.certificationCode.value;
    }
    if (normalized.expirationDate.provided) {
      data.expirationDate = normalized.expirationDate.value;
    }
    if (normalized.providerName.provided) {
      data.providerName = normalized.providerName.value;
    }
    if (normalized.level.provided) {
      data.level = normalized.level.value;
    }
    if (normalized.skills.provided) {
      data.skills = { set: normalized.skills.value };
    }
    if (normalized.competencies.provided) {
      data.competencies = { set: normalized.competencies.value };
    }
    if (normalized.learningOutcomes.provided) {
      data.learningOutcomes = { set: normalized.learningOutcomes.value };
    }
    if (normalized.status.provided) {
      data.status = normalized.status.value;
    }

    const updated = (await this.prisma.issuerCourseTemplate.update({
      where: { id: templateId },
      data,
      select: COURSE_TEMPLATE_RESPONSE_SELECT
    })) as CourseTemplateRecord;

    return mapCourseTemplateResponse(updated);
  }

  // C4a.1: aprobacion explicita del emisor de una interpretacion semantica
  // (SemanticAnalysis) ya generada, como snapshot reutilizable del template.
  // No modifica Credential, no crea un SemanticAnalysis nuevo, no llama a la
  // IA, no reconstruye FormativeProfile, no toca blockchain/hash. Ver
  // docs/architecture/domain-rules-v0.md para las reglas completas.
  async approveTemplateSemanticAnalysisForIssuer(
    issuerId: string,
    templateId: string,
    semanticAnalysisId: string,
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    const { template, semanticAnalysis } =
      await this.resolveApprovableSemanticAnalysis(
        issuerId,
        templateId,
        semanticAnalysisId,
        currentUser
      );

    const snapshot = buildApprovedTemplateSemanticSnapshot({
      schemaVersion: semanticAnalysis.schemaVersion,
      status: semanticAnalysis.status,
      areas: semanticAnalysis.areas,
      skills: semanticAnalysis.skills,
      concepts: semanticAnalysis.concepts,
      qualityFlags: semanticAnalysis.qualityFlags,
      confidence: semanticAnalysis.confidence,
      analysisJson: semanticAnalysis.analysisJson
    });

    const updated = (await this.prisma.issuerCourseTemplate.update({
      where: { id: template.id },
      data: {
        approvedSemanticAnalysisId: semanticAnalysis.id,
        approvedSemanticSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        approvedSemanticApprovedByUserId: currentUser.id,
        approvedSemanticApprovedAt: new Date(),
        approvedSemanticPipelineVersion: semanticAnalysis.pipelineVersion,
        approvedSemanticTaxonomyVersion: semanticAnalysis.taxonomyVersion,
        approvedSemanticSourceCredentialId: semanticAnalysis.credentialId
      },
      select: COURSE_TEMPLATE_RESPONSE_SELECT
    })) as CourseTemplateRecord;

    return mapCourseTemplateResponse(updated);
  }

  // C4a.2: mismo set de validaciones que approveTemplateSemanticAnalysisForIssuer
  // (reutiliza resolveApprovableSemanticAnalysis para no duplicar reglas),
  // pero de solo lectura -- nunca actualiza IssuerCourseTemplate, nunca crea
  // un SemanticAnalysis, nunca llama a la IA. Permite que la UI muestre un
  // resumen seguro ANTES de que el emisor decida aprobar.
  async getTemplateSemanticApprovalCandidateForIssuer(
    issuerId: string,
    templateId: string,
    semanticAnalysisId: string,
    currentUser: AuthenticatedUser
  ): Promise<TemplateSemanticApprovalCandidateResponseDto> {
    const { semanticAnalysis } = await this.resolveApprovableSemanticAnalysis(
      issuerId,
      templateId,
      semanticAnalysisId,
      currentUser
    );

    const snapshot = buildApprovedTemplateSemanticSnapshot({
      schemaVersion: semanticAnalysis.schemaVersion,
      status: semanticAnalysis.status,
      areas: semanticAnalysis.areas,
      skills: semanticAnalysis.skills,
      concepts: semanticAnalysis.concepts,
      qualityFlags: semanticAnalysis.qualityFlags,
      confidence: semanticAnalysis.confidence,
      analysisJson: semanticAnalysis.analysisJson
    });

    return {
      semanticAnalysisId: semanticAnalysis.id,
      status: semanticAnalysis.status,
      pipelineVersion: semanticAnalysis.pipelineVersion,
      taxonomyVersion: semanticAnalysis.taxonomyVersion,
      sourceCredentialId: semanticAnalysis.credentialId,
      summary: {
        schema: snapshot.schema,
        status: snapshot.status,
        areaCount: snapshot.areas.length,
        skillCount: snapshot.skills.length,
        conceptCount: snapshot.concepts.length,
        hasHoursDistribution: snapshot.hoursDistribution.length > 0,
        warningCount: snapshot.warnings.length,
        qualityFlagCount: snapshot.qualityFlags.length
      }
    };
  }

  // Validaciones compartidas por el POST de aprobacion (C4a.1) y el GET de
  // candidate (C4a.2) -- unica fuente de verdad para las reglas de scoping/
  // tipo/status/createdFromCredentialId, para que ambos endpoints nunca
  // puedan divergir.
  private async resolveApprovableSemanticAnalysis(
    issuerId: string,
    templateId: string,
    semanticAnalysisId: string,
    currentUser: AuthenticatedUser
  ) {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const template = await this.prisma.issuerCourseTemplate.findFirst({
      where: { id: templateId, issuerId },
      select: {
        id: true,
        credentialType: true,
        createdFromCredentialId: true
      }
    });

    if (!template) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND_MESSAGE);
    }

    const semanticAnalysis = await this.prisma.semanticAnalysis.findFirst({
      where: { id: semanticAnalysisId },
      select: {
        id: true,
        credentialId: true,
        status: true,
        schemaVersion: true,
        pipelineVersion: true,
        taxonomyVersion: true,
        areas: true,
        skills: true,
        concepts: true,
        qualityFlags: true,
        confidence: true,
        analysisJson: true,
        credential: {
          select: { id: true, type: true, issuerId: true }
        }
      }
    });

    // Se devuelve el mismo 404 que "no existe" cuando la credencial
    // analizada pertenece a otro emisor -- no debe filtrarse la existencia
    // de un SemanticAnalysis de otro issuer.
    if (!semanticAnalysis || semanticAnalysis.credential.issuerId !== issuerId) {
      throw new NotFoundException(SEMANTIC_ANALYSIS_NOT_FOUND_MESSAGE);
    }

    // Esta comprobacion tambien rechaza, por construccion, academic_subject
    // y degree: template.credentialType nunca puede ser esos valores (ver
    // resolveReusableCredentialType), asi que cualquier credencial analizada
    // de esos tipos jamas puede coincidir.
    if (semanticAnalysis.credential.type !== template.credentialType) {
      throw new BadRequestException(SEMANTIC_ANALYSIS_TYPE_MISMATCH_MESSAGE);
    }

    assertSemanticAnalysisStatusIsUsable(semanticAnalysis.status);

    // Si el template fue creado desde una credencial concreta, solo se
    // pueden aprobar interpretaciones semanticas de esa misma credencial.
    // Si el template no tiene createdFromCredentialId (ej. creado a mano),
    // se permite aprobar cualquier analisis de una credencial del mismo
    // issuer y del mismo credentialType -- comportamiento documentado en
    // docs/architecture/domain-rules-v0.md.
    if (
      template.createdFromCredentialId &&
      semanticAnalysis.credentialId !== template.createdFromCredentialId
    ) {
      throw new BadRequestException(
        SEMANTIC_ANALYSIS_SOURCE_CREDENTIAL_MISMATCH_MESSAGE
      );
    }

    return { template, semanticAnalysis };
  }
}

function duplicateMessageFor(credentialType: 'course' | 'certification') {
  return credentialType === 'certification'
    ? 'Esta certificacion ya fue guardada como reutilizable.'
    : DUPLICATE_TEMPLATE_MESSAGE;
}

function normalizeNullableText(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeStatusFilter(value: unknown): CourseTemplateStatusFilter {
  if (value === undefined || value === '') {
    return 'active';
  }

  if (value === 'active' || value === 'archived' || value === 'all') {
    return value;
  }

  throw new BadRequestException('status debe ser active, archived o all.');
}

function toStatusEnum(
  filter: 'active' | 'archived'
): CourseTemplateStatus {
  return filter === 'active'
    ? CourseTemplateStatus.active
    : CourseTemplateStatus.archived;
}

function normalizeCredentialTypeFilter(
  value: unknown
): CourseTemplateCredentialTypeFilter {
  if (value === undefined || value === '') {
    return 'all';
  }

  if (value === 'course' || value === 'certification' || value === 'all') {
    return value;
  }

  throw new BadRequestException(
    'credentialType debe ser course, certification o all.'
  );
}

function toCredentialTypeEnum(
  filter: 'course' | 'certification'
): CredentialType {
  return filter === 'course' ? CredentialType.course : CredentialType.certification;
}

function normalizeSearch(value: unknown): string | null {
  if (value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('search debe ser string.');
  }

  const normalized = normalizeSearchText(value);

  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new BadRequestException(
      `search no puede superar ${MAX_SEARCH_LENGTH} caracteres.`
    );
  }

  return normalized || null;
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-AR')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchesSearch(
  template: {
    title: string;
    platformName: string | null;
    providerName: string | null;
    description: string | null;
  },
  search: string | null
) {
  if (!search) {
    return true;
  }

  return (
    normalizeSearchText(template.title).includes(search) ||
    (template.platformName
      ? normalizeSearchText(template.platformName).includes(search)
      : false) ||
    (template.providerName
      ? normalizeSearchText(template.providerName).includes(search)
      : false) ||
    (template.description
      ? normalizeSearchText(template.description).includes(search)
      : false)
  );
}
