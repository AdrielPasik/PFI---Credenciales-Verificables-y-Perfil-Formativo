import { BadRequestException, Injectable } from '@nestjs/common';
import { CourseStatus, Prisma } from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicCatalogSearchResponseDto } from './dto/academic-catalog-search-response.dto';

export const DEFAULT_ACADEMIC_CATALOG_LIMIT = 20;
export const MAX_ACADEMIC_CATALOG_LIMIT = 50;
const MAX_QUERY_LENGTH = 255;

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
