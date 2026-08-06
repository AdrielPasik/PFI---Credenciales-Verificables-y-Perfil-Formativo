import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { DocumentEvidenceController } from './document-evidence.controller';
import { DocumentEvidenceService } from './document-evidence.service';
import { createDocumentStorageAdapterFromEnv } from './document-storage.factory';
import { DOCUMENT_STORAGE_PORT } from './document-storage.port';
import { DocumentUploadInterceptor } from './document-upload.interceptor';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [DocumentEvidenceController],
  providers: [
    DocumentEvidenceService,
    DocumentUploadInterceptor,
    {
      provide: DOCUMENT_STORAGE_PORT,
      useFactory: () => createDocumentStorageAdapterFromEnv(process.env)
    }
  ],
  exports: [DOCUMENT_STORAGE_PORT]
})
export class DocumentEvidenceModule {}
