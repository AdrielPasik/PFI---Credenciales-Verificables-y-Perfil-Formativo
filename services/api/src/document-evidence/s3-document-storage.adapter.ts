import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client
} from '@aws-sdk/client-s3';

import { MAX_DOCUMENT_SIZE_BYTES } from './document-file.validator';
import { DocumentStorageError } from './document-storage.error';
import {
  type DetectedDocumentExtension,
  type DetectedDocumentMimeType,
  type DocumentStoragePort,
  type SaveDocumentInput
} from './document-storage.port';

const EXTENSION_MIME_TYPES: Record<
  DetectedDocumentExtension,
  DetectedDocumentMimeType
> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const SAFE_OBJECT_NAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?\.(pdf|png|jpg)$/i;

export interface S3DocumentStorageConfig {
  bucket: string;
  prefix: string;
}

export class S3DocumentStorageAdapter implements DocumentStoragePort {
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    config: S3DocumentStorageConfig,
    private readonly createId: () => string = randomUUID
  ) {
    this.bucket = requireNonEmpty(config.bucket, 'AWS_S3_BUCKET');
    this.prefix = normalizeS3Prefix(config.prefix);
  }

  async saveDocument(input: SaveDocumentInput) {
    this.assertFormatPair(input.detectedExtension, input.detectedMimeType);
    assertSha256(input.sha256);

    const storageKey = `${this.prefix}/${this.createId()}${input.detectedExtension}`;
    this.assertStorageKey(storageKey);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: input.buffer,
          ContentType: input.detectedMimeType,
          Metadata: {
            sha256: input.sha256
          },
          ServerSideEncryption: 'AES256'
        })
      );
    } catch (error) {
      throw upstreamStorageError(error);
    }

    return {
      storageProvider: 's3',
      storageKey
    };
  }

  async readDocument(storageKey: string): Promise<Buffer> {
    this.assertStorageKey(storageKey);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storageKey
        })
      );
      const body = (response as { Body?: unknown }).Body;

      if (!body) {
        throw new DocumentStorageError(
          'invalid_body',
          'No se pudo leer el documento almacenado.'
        );
      }

      return await bodyToBuffer(body);
    } catch (error) {
      if (error instanceof DocumentStorageError) {
        throw error;
      }
      if (isS3NotFoundError(error)) {
        throw new DocumentStorageError(
          'not_found',
          'No se encontro el documento almacenado.'
        );
      }

      throw upstreamStorageError(error);
    }
  }

  async deleteDocument(storageKey: string): Promise<void> {
    this.assertStorageKey(storageKey);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: storageKey
        })
      );
    } catch (error) {
      if (!isS3NotFoundError(error)) {
        throw upstreamStorageError(error);
      }
    }
  }

  private assertFormatPair(
    extension: DetectedDocumentExtension,
    mimeType: DetectedDocumentMimeType
  ) {
    if (EXTENSION_MIME_TYPES[extension] !== mimeType) {
      throw new DocumentStorageError(
        'invalid_body',
        'El formato del documento almacenado no es valido.'
      );
    }
  }

  private assertStorageKey(storageKey: string) {
    const expectedPrefix = `${this.prefix}/`;
    const objectName = storageKey.startsWith(expectedPrefix)
      ? storageKey.slice(expectedPrefix.length)
      : '';

    if (
      !objectName ||
      objectName.includes('/') ||
      objectName.includes('\\') ||
      objectName.includes('..') ||
      !SAFE_OBJECT_NAME_PATTERN.test(objectName)
    ) {
      throw new DocumentStorageError(
        'invalid_key',
        'La clave de almacenamiento S3 no es valida.'
      );
    }
  }
}

export function normalizeS3Prefix(value: string) {
  const prefix = value.trim().replace(/^\/+|\/+$/g, '');

  if (
    !prefix ||
    prefix.length > 128 ||
    prefix.includes('..') ||
    prefix.includes('//') ||
    !/^[a-z0-9][a-z0-9/_-]*$/i.test(prefix)
  ) {
    throw new DocumentStorageError(
      'configuration',
      'AWS_S3_PREFIX no es valido.'
    );
  }

  return prefix;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return assertDocumentSize(Buffer.from(body));
  }

  if (body instanceof Uint8Array) {
    return assertDocumentSize(Buffer.from(body));
  }

  if (hasTransformToByteArray(body)) {
    return assertDocumentSize(Buffer.from(await body.transformToByteArray()));
  }

  if (hasArrayBuffer(body)) {
    return assertDocumentSize(Buffer.from(await body.arrayBuffer()));
  }

  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of body) {
      const buffer = toBufferChunk(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_DOCUMENT_SIZE_BYTES) {
        throw tooLargeStorageError();
      }
      chunks.push(buffer);
    }

    return assertDocumentSize(Buffer.concat(chunks));
  }

  throw new DocumentStorageError(
    'invalid_body',
    'No se pudo leer el documento almacenado.'
  );
}

function assertDocumentSize(buffer: Buffer) {
  if (buffer.byteLength === 0) {
    throw new DocumentStorageError(
      'invalid_body',
      'No se pudo leer el documento almacenado.'
    );
  }
  if (buffer.byteLength > MAX_DOCUMENT_SIZE_BYTES) {
    throw tooLargeStorageError();
  }

  return buffer;
}

function toBufferChunk(chunk: unknown) {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array || typeof chunk === 'string') {
    return Buffer.from(chunk);
  }

  throw new DocumentStorageError(
    'invalid_body',
    'No se pudo leer el documento almacenado.'
  );
}

function hasTransformToByteArray(
  value: unknown
): value is { transformToByteArray(): Promise<Uint8Array> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { transformToByteArray?: unknown }).transformToByteArray ===
      'function'
  );
}

function hasArrayBuffer(
  value: unknown
): value is { arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function assertSha256(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new DocumentStorageError(
      'invalid_body',
      'El hash del documento almacenado no es valido.'
    );
  }
}

function requireNonEmpty(value: string, variableName: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new DocumentStorageError(
      'configuration',
      `Falta ${variableName} para el storage S3.`
    );
  }
  return normalized;
}

function isS3NotFoundError(error: unknown) {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.name === 'NotFound' ||
    candidate?.Code === 'NoSuchKey'
  );
}

function upstreamStorageError(_cause: unknown) {
  return new DocumentStorageError(
    'upstream',
    'No se pudo completar la operacion de almacenamiento.'
  );
}

function tooLargeStorageError() {
  return new DocumentStorageError(
    'too_large',
    'El documento almacenado supera el limite permitido.'
  );
}
