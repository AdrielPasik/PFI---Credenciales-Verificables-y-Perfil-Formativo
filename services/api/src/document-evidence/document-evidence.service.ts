import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialStatus,
  DocumentEvidenceStatus,
  Prisma
} from '@prisma/client';

import { type AuthenticatedUser } from '../auth/auth.types';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  documentEvidenceResponseSelect,
  mapDocumentEvidenceResponse
} from './document-evidence.mapper';
import { type UploadedDocumentFile } from './document-evidence.types';
import {
  DOCUMENT_STORAGE_PORT,
  type DocumentStoragePort
} from './document-storage.port';
import { DocumentEvidenceResponseDto } from './dto/document-evidence-response.dto';
import { validateDocumentFile } from './document-file.validator';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';

@Injectable()
export class DocumentEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    @Inject(DOCUMENT_STORAGE_PORT)
    private readonly storage: DocumentStoragePort
  ) {}

  async uploadCurrentDocument(
    issuerId: string,
    credentialId: string,
    currentUser: AuthenticatedUser,
    file: UploadedDocumentFile | undefined
  ): Promise<DocumentEvidenceResponseDto> {
    await this.issuersService.assertUserCanAttachDocumentEvidenceForIssuer(
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
        status: true
      }
    });

    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }

    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        'La evidencia documental solo puede reemplazarse en un borrador.'
      );
    }

    const document = validateDocumentFile(file);
    const stored = await this.storage.saveDocument({
      buffer: document.buffer,
      detectedExtension: document.detectedExtension,
      detectedMimeType: document.detectedMimeType,
      sha256: document.sha256
    });

    try {
      const evidence = await this.prisma.$transaction(
        async (transaction) => {
          const replacedAt = new Date();

          await transaction.documentEvidence.updateMany({
            where: {
              credentialId: credential.id,
              status: DocumentEvidenceStatus.current
            },
            data: {
              status: DocumentEvidenceStatus.replaced,
              replacedAt
            }
          });

          return transaction.documentEvidence.create({
            data: {
              credentialId: credential.id,
              uploadedByUserId: currentUser.id,
              kind: document.kind,
              originalFileName: document.originalFileName,
              mimeType: document.detectedMimeType,
              sizeBytes: document.sizeBytes,
              sha256: document.sha256,
              storageProvider: stored.storageProvider,
              storageKey: stored.storageKey,
              status: DocumentEvidenceStatus.current
            },
            select: documentEvidenceResponseSelect
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );

      return mapDocumentEvidenceResponse(evidence);
    } catch (error) {
      try {
        await this.storage.deleteDocument(stored.storageKey);
      } catch {
        // Preserve the database error; orphan cleanup can be reconciled locally.
      }

      throw error;
    }
  }
}
