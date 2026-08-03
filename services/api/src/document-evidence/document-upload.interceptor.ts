import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { MAX_DOCUMENT_SIZE_BYTES } from './document-file.validator';

export const DOCUMENT_MULTIPART_FIELD = 'file';
export const DOCUMENT_UPLOAD_LIMITS = {
  files: 1,
  fields: 0,
  fileSize: MAX_DOCUMENT_SIZE_BYTES
} as const;

const NestDocumentFileInterceptor = FileInterceptor(
  DOCUMENT_MULTIPART_FIELD,
  {
    limits: DOCUMENT_UPLOAD_LIMITS
  }
);

@Injectable()
export class DocumentUploadInterceptor implements NestInterceptor {
  private readonly delegate = new NestDocumentFileInterceptor();

  async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await this.delegate.intercept(context, next);
    } catch (error) {
      throw mapDocumentMultipartError(error);
    }
  }
}

export function mapDocumentMultipartError(error: unknown): unknown {
  const code = readMultipartErrorCode(error);

  if (code === 'LIMIT_FILE_SIZE') {
    return new PayloadTooLargeException(
      'El archivo supera el limite de 20 MB.'
    );
  }

  if (code?.startsWith('LIMIT_')) {
    return new BadRequestException(
      'El multipart debe contener exactamente un archivo sin campos adicionales.'
    );
  }

  return error;
}

function readMultipartErrorCode(error: unknown) {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return null;
  }

  return error.code;
}
