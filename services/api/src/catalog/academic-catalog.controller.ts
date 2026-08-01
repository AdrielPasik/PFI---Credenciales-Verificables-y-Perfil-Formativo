import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AcademicCatalogService } from './academic-catalog.service';
import { AcademicCatalogSearchResponseDto } from './dto/academic-catalog-search-response.dto';

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
}
