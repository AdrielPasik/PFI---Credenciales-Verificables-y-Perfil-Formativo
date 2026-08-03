import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { DocumentEvidenceService } from './document-evidence.service';
import { type UploadedDocumentFile } from './document-evidence.types';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { DocumentEvidenceResponseDto } from './dto/document-evidence-response.dto';

@UseGuards(AuthGuard)
@Controller('issuers/:issuerId/credentials/:credentialId/evidence/documents')
export class DocumentEvidenceController {
  constructor(
    private readonly documentEvidenceService: DocumentEvidenceService
  ) {}

  @Post()
  @UseInterceptors(DocumentUploadInterceptor)
  uploadDocument(
    @Param('issuerId') issuerId: string,
    @Param('credentialId') credentialId: string,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<DocumentEvidenceResponseDto> {
    if (body && Object.keys(body).length > 0) {
      throw new BadRequestException(
        'El multipart no admite campos adicionales.'
      );
    }

    return this.documentEvidenceService.uploadCurrentDocument(
      issuerId,
      credentialId,
      currentUser,
      file
    );
  }
}
