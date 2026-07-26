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
import { FileInterceptor } from '@nestjs/platform-express';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiIntegrationService } from './ai-integration.service';
import { AnalyzeCredentialPdfDto } from './dto/analyze-credential-pdf.dto';
import { type SemanticAnalysisFromPdfResponseDto } from './dto/semantic-analysis-from-pdf-response.dto';
import { type UploadedPdfFile } from './uploaded-pdf.types';

const MAX_PDF_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PDF_HEADER = Buffer.from('%PDF-', 'ascii');

@UseGuards(AuthGuard)
@Controller('credentials')
export class CredentialAiController {
  constructor(private readonly aiIntegrationService: AiIntegrationService) {}

  @Post(':id/semantic-analysis/from-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: MAX_PDF_FILE_SIZE_BYTES
      }
    })
  )
  analyzePdf(
    @Param('id') credentialId: string,
    @UploadedFile() file: UploadedPdfFile | undefined,
    @Body() dto: AnalyzeCredentialPdfDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<SemanticAnalysisFromPdfResponseDto> {
    this.assertPdf(file);

    return this.aiIntegrationService.analyzeCredentialPdfForIssuerUser(
      currentUser.id,
      credentialId,
      {
        fileBytes: file.buffer,
        documentId: this.optionalString(dto?.documentId, 'documentId'),
        fileName:
          this.optionalString(dto?.fileName, 'fileName') ?? file.originalname,
        pipelineVersion: this.optionalString(
          dto?.pipelineVersion,
          'pipelineVersion'
        ),
        taxonomyVersion: this.optionalString(
          dto?.taxonomyVersion,
          'taxonomyVersion'
        )
      }
    );
  }

  private assertPdf(
    file: UploadedPdfFile | undefined
  ): asserts file is UploadedPdfFile {
    if (!file) {
      throw new BadRequestException('A PDF file is required.');
    }
    if (
      file.mimetype !== 'application/pdf' ||
      file.size <= 0 ||
      file.buffer.byteLength === 0
    ) {
      throw new BadRequestException('file must be a non-empty PDF.');
    }

    const headerWindow = file.buffer.subarray(
      0,
      Math.min(file.buffer.byteLength, 1_024)
    );
    if (headerWindow.indexOf(PDF_HEADER) < 0) {
      throw new BadRequestException('file does not contain a valid PDF header.');
    }
  }

  private optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string.`);
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
