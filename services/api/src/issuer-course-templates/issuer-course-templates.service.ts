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
import {
  normalizeTitleForComparison,
  readSubjectStringArray,
  readSubjectText,
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
  'No se encontro el curso reutilizable solicitado.';
const DUPLICATE_TEMPLATE_MESSAGE =
  'Este curso ya fue guardado como reutilizable.';

const COURSE_TEMPLATE_RESPONSE_SELECT = {
  id: true,
  title: true,
  description: true,
  hours: true,
  modality: true,
  platformName: true,
  externalUrl: true,
  competencies: true,
  learningOutcomes: true,
  status: true,
  createdFromCredentialId: true,
  lastSemanticAnalysisId: true,
  createdAt: true,
  updatedAt: true
} as const;

type CourseTemplateStatusFilter = 'active' | 'archived' | 'all';

@Injectable()
export class IssuerCourseTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async listTemplatesForIssuer(
    issuerId: string,
    query: { search?: unknown; status?: unknown },
    currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto[]> {
    await this.issuersService.assertUserCanManageCourseTemplatesForIssuer(
      currentUser.id,
      issuerId
    );

    const statusFilter = normalizeStatusFilter(query.status);
    const search = normalizeSearch(query.search);
    const where: Prisma.IssuerCourseTemplateWhereInput = {
      issuerId,
      ...(statusFilter === 'all' ? {} : { status: toStatusEnum(statusFilter) })
    };

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
        title: normalized.title,
        description: normalized.description,
        hours: normalized.hours,
        modality: normalized.modality,
        platformName: normalized.platformName,
        externalUrl: normalized.externalUrl,
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

    if (credential.type !== CredentialType.course) {
      throw new BadRequestException(
        'Solo se pueden guardar como reutilizables credenciales de tipo course.'
      );
    }

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
      throw new ConflictException(DUPLICATE_TEMPLATE_MESSAGE);
    }

    const created = (await this.prisma.issuerCourseTemplate.create({
      data: {
        issuerId,
        createdByUserId: currentUser.id,
        status: CourseTemplateStatus.active,
        title,
        description: normalizeNullableText(credential.description),
        hours: credential.hours,
        modality: readSubjectText(subject, 'modality'),
        platformName: readSubjectText(subject, 'platform_name'),
        externalUrl: readSubjectText(subject, 'external_url'),
        competencies: readSubjectStringArray(subject, 'competencies'),
        learningOutcomes: readSubjectStringArray(subject, 'learning_outcomes'),
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
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND_MESSAGE);
    }

    const normalized = validatePatchCourseTemplatePayload(dto);
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
  template: { title: string; platformName: string | null; description: string | null },
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
    (template.description
      ? normalizeSearchText(template.description).includes(search)
      : false)
  );
}
