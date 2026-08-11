import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CourseTemplateResponseDto } from './dto/course-template-response.dto';
import { CreateCourseTemplateDto } from './dto/create-course-template.dto';
import { PatchCourseTemplateDto } from './dto/patch-course-template.dto';
import { IssuerCourseTemplatesService } from './issuer-course-templates.service';

@Controller('issuers/:issuerId/course-templates')
export class IssuerCourseTemplatesController {
  constructor(
    private readonly issuerCourseTemplatesService: IssuerCourseTemplatesService
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  listTemplates(
    @Param('issuerId') issuerId: string,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto[]> {
    return this.issuerCourseTemplatesService.listTemplatesForIssuer(
      issuerId,
      { search, status },
      currentUser
    );
  }

  @Post()
  @UseGuards(AuthGuard)
  createTemplate(
    @Param('issuerId') issuerId: string,
    @Body() dto: CreateCourseTemplateDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    return this.issuerCourseTemplatesService.createTemplateForIssuer(
      issuerId,
      dto,
      currentUser
    );
  }

  @Post('from-credential/:credentialId')
  @UseGuards(AuthGuard)
  createTemplateFromCredential(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    return this.issuerCourseTemplatesService.createTemplateFromCredentialForIssuer(
      issuerId,
      credentialId,
      currentUser
    );
  }

  @Patch(':templateId')
  @UseGuards(AuthGuard)
  patchTemplate(
    @Param('issuerId') issuerId: string,
    @Param('templateId') templateId: string,
    @Body() dto: PatchCourseTemplateDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<CourseTemplateResponseDto> {
    return this.issuerCourseTemplatesService.patchTemplateForIssuer(
      issuerId,
      templateId,
      dto,
      currentUser
    );
  }
}
