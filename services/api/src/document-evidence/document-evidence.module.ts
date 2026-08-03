import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { DocumentEvidenceController } from './document-evidence.controller';
import { DocumentEvidenceService } from './document-evidence.service';
import { DOCUMENT_STORAGE_PORT } from './document-storage.port';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import {
  LocalDocumentStorageAdapter,
  resolveLocalDocumentStorageRoot
} from './local-document-storage.adapter';

@Module({
  imports: [AuthModule, IssuersModule],
  controllers: [DocumentEvidenceController],
  providers: [
    DocumentEvidenceService,
    DocumentUploadInterceptor,
    {
      provide: DOCUMENT_STORAGE_PORT,
      useFactory: () => {
        const provider = (
          process.env.DOCUMENT_STORAGE_PROVIDER ?? 'local'
        )
          .trim()
          .toLowerCase();

        if (provider !== 'local') {
          throw new Error(
            `DOCUMENT_STORAGE_PROVIDER no soportado: ${provider || '(vacio)'}.`
          );
        }

        return new LocalDocumentStorageAdapter(
          resolveLocalDocumentStorageRoot(
            process.env.DOCUMENT_STORAGE_LOCAL_ROOT
          )
        );
      }
    }
  ]
})
export class DocumentEvidenceModule {}
