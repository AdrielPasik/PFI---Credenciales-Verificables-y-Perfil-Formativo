import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AcademicCatalogService } from './academic-catalog.service';
import { AcademicCatalogSearchResponseDto } from './dto/academic-catalog-search-response.dto';
import { AcademicProgramSearchResponseDto } from './dto/academic-program-search-response.dto';
import { CurriculumAcademicSubjectSearchResponseDto } from './dto/curriculum-academic-subject-search-response.dto';

@Controller('issuers/:issuerId/catalog')
export class AcademicCatalogController {
  constructor(
    private readonly academicCatalogService: AcademicCatalogService
  ) {}

  @Get('academic-subjects')
  @UseGuards(AuthGuard)
  searchAcademicSubjects(
    @Param('issuerId') issuerId: string,
    @Query('query') query: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AcademicCatalogSearchResponseDto> {
    return this.academicCatalogService.searchAcademicSubjectsForIssuer(
      issuerId,
      query,
      limit,
      currentUser
    );
  }

  @Get('academic-programs')
  @UseGuards(AuthGuard)
  searchAcademicPrograms(
    @Param('issuerId') issuerId: string,
    @Query('query') query: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AcademicProgramSearchResponseDto> {
    return this.academicCatalogService.searchAcademicProgramsForIssuer(
      issuerId,
      query,
      limit,
      currentUser
    );
  }

  @Get(
    'curriculum-versions/:curriculumReference/academic-subjects'
  )
  @UseGuards(AuthGuard)
  searchAcademicSubjectsForCurriculum(
    @Param('issuerId') issuerId: string,
    @Param('curriculumReference') curriculumReference: string,
    @Query('query') query: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CurriculumAcademicSubjectSearchResponseDto> {
    return this.academicCatalogService.searchAcademicSubjectsForCurriculum(
      issuerId,
      curriculumReference,
      query,
      limit,
      currentUser
    );
  }
}
