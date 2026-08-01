import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CourseStatus,
  CurriculumVersionStatus,
  Prisma,
  ProgramStatus
} from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicCatalogSearchResponseDto } from './dto/academic-catalog-search-response.dto';
import { AcademicProgramSearchResponseDto } from './dto/academic-program-search-response.dto';
import { CurriculumAcademicSubjectSearchResponseDto } from './dto/curriculum-academic-subject-search-response.dto';

export const DEFAULT_ACADEMIC_CATALOG_LIMIT = 20;
export const MAX_ACADEMIC_CATALOG_LIMIT = 50;
const MAX_QUERY_LENGTH = 255;
const CURRICULUM_NOT_FOUND_MESSAGE =
  'No se encontro una curricula activa para el issuer solicitado.';

@Injectable()
export class AcademicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async searchAcademicSubjectsForIssuer(
    issuerId: string,
    query: unknown,
    limit: unknown,
    currentUser: AuthenticatedUser
  ): Promise<AcademicCatalogSearchResponseDto> {
    await this.issuersService.assertUserCanSearchAcademicCatalogForIssuer(
      currentUser.id,
      issuerId
    );

    const normalizedQuery = normalizeQuery(query);
    const normalizedLimit = normalizeLimit(limit);
    const where: Prisma.AcademicCourseWhereInput = {
      issuerId,
      status: CourseStatus.active,
      ...(normalizedQuery
        ? {
            OR: [
              {
                code: {
                  contains: normalizedQuery,
                  mode: 'insensitive'
                }
              },
              {
                name: {
                  contains: normalizedQuery,
                  mode: 'insensitive'
                }
              }
            ]
          }
        : {})
    };

    const courses = await this.prisma.academicCourse.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        hours: true
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
      take: normalizedLimit
    });

    return {
      items: courses.map((course) => ({
        academicCourseReference: course.id,
        code: course.code,
        name: course.name,
        description: normalizeOptionalText(course.description),
        hours: course.hours?.toFixed(2) ?? null
      }))
    };
  }

  async searchAcademicProgramsForIssuer(
    issuerId: string,
    query: unknown,
    limit: unknown,
    currentUser: AuthenticatedUser
  ): Promise<AcademicProgramSearchResponseDto> {
    await this.issuersService.assertUserCanSearchAcademicCatalogForIssuer(
      currentUser.id,
      issuerId
    );

    const normalizedQuery = normalizeQuery(query);
    const normalizedLimit = normalizeLimit(limit);
    const programs = await this.prisma.program.findMany({
      where: {
        issuerId,
        status: ProgramStatus.active,
        curriculumVersions: {
          some: { status: CurriculumVersionStatus.active }
        },
        ...(normalizedQuery
          ? {
              OR: [
                {
                  code: {
                    contains: normalizedQuery,
                    mode: 'insensitive'
                  }
                },
                {
                  name: {
                    contains: normalizedQuery,
                    mode: 'insensitive'
                  }
                }
              ]
            }
          : {})
      },
      select: {
        id: true,
        code: true,
        name: true,
        curriculumVersions: {
          where: { status: CurriculumVersionStatus.active },
          select: { id: true, versionLabel: true },
          orderBy: [{ versionLabel: 'asc' }, { id: 'asc' }],
          take: 1
        }
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: normalizedLimit
    });

    return {
      items: programs.map((program) => {
        const curriculum = program.curriculumVersions[0];

        if (!curriculum) {
          throw new Error('La query devolvio un programa sin curricula activa.');
        }

        return {
          programReference: program.id,
          programCode: program.code,
          programName: program.name,
          curriculumReference: curriculum.id,
          curriculumCode: curriculum.versionLabel
        };
      })
    };
  }

  async searchAcademicSubjectsForCurriculum(
    issuerId: string,
    curriculumReference: string,
    query: unknown,
    limit: unknown,
    currentUser: AuthenticatedUser
  ): Promise<CurriculumAcademicSubjectSearchResponseDto> {
    await this.issuersService.assertUserCanSearchAcademicCatalogForIssuer(
      currentUser.id,
      issuerId
    );

    const normalizedCurriculumReference = normalizeReference(
      curriculumReference,
      'curriculumReference'
    );
    const normalizedQuery = normalizeQuery(query);
    const normalizedLimit = normalizeLimit(limit);
    const curriculum = await this.prisma.curriculumVersion.findFirst({
      where: {
        id: normalizedCurriculumReference,
        status: CurriculumVersionStatus.active,
        program: {
          issuerId,
          status: ProgramStatus.active
        }
      },
      select: {
        id: true,
        versionLabel: true,
        program: {
          select: { id: true, code: true, name: true }
        }
      }
    });

    if (!curriculum) {
      throw new NotFoundException(CURRICULUM_NOT_FOUND_MESSAGE);
    }

    const programCourses = await this.prisma.programCourse.findMany({
      where: {
        curriculumVersionId: curriculum.id,
        academicCourse: {
          issuerId,
          status: CourseStatus.active,
          ...(normalizedQuery
            ? {
                OR: [
                  {
                    code: {
                      contains: normalizedQuery,
                      mode: 'insensitive'
                    }
                  },
                  {
                    name: {
                      contains: normalizedQuery,
                      mode: 'insensitive'
                    }
                  }
                ]
              }
            : {})
        }
      },
      select: {
        academicCourse: {
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            hours: true
          }
        }
      },
      orderBy: [
        { academicCourse: { code: 'asc' } },
        { academicCourse: { name: 'asc' } },
        { id: 'asc' }
      ],
      take: normalizedLimit
    });

    return {
      items: programCourses.map(({ academicCourse }) => ({
        academicCourseReference: academicCourse.id,
        code: academicCourse.code,
        name: academicCourse.name,
        description: normalizeOptionalText(academicCourse.description),
        hours: academicCourse.hours?.toFixed(2) ?? null,
        programReference: curriculum.program.id,
        programCode: curriculum.program.code,
        programName: curriculum.program.name,
        curriculumReference: curriculum.id,
        curriculumCode: curriculum.versionLabel
      }))
    };
  }
}

function normalizeReference(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} debe ser string no vacio.`);
  }

  return value.trim();
}

function normalizeQuery(value: unknown) {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('query debe ser string.');
  }

  const normalized = value.trim();

  if (normalized.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException(
      `query no puede superar ${MAX_QUERY_LENGTH} caracteres.`
    );
  }

  return normalized || null;
}

function normalizeLimit(value: unknown) {
  if (value === undefined || value === '') {
    return DEFAULT_ACADEMIC_CATALOG_LIMIT;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw new BadRequestException('limit debe ser un entero entre 1 y 50.');
  }

  const parsed = Number(value.trim());

  if (parsed < 1 || parsed > MAX_ACADEMIC_CATALOG_LIMIT) {
    throw new BadRequestException('limit debe ser un entero entre 1 y 50.');
  }

  return parsed;
}

function normalizeOptionalText(value: string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
