import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { DocumentEvidenceController } from './document-evidence.controller';
import { DocumentEvidenceModule } from './document-evidence.module';
import { DocumentEvidenceService } from './document-evidence.service';
import { createDocumentStorageAdapterFromEnv } from './document-storage.factory';
import { DocumentStorageError } from './document-storage.error';
import { DOCUMENT_STORAGE_PORT } from './document-storage.port';
import { DocumentUploadInterceptor } from './document-upload.interceptor';
import { LocalDocumentStorageAdapter } from './local-document-storage.adapter';
import { S3DocumentStorageAdapter } from './s3-document-storage.adapter';

test('DocumentEvidenceModule wires auth, issuer permissions, controller and storage port without cycles', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    DocumentEvidenceModule
  ) as unknown[];
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    DocumentEvidenceModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    DocumentEvidenceModule
  ) as unknown[];

  assert.deepEqual(imports, [AuthModule, IssuersModule]);
  assert.deepEqual(controllers, [DocumentEvidenceController]);
  assert.equal(providers.includes(DocumentEvidenceService), true);
  assert.equal(providers.includes(DocumentUploadInterceptor), true);
  assert.equal(
    providers.some(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === DOCUMENT_STORAGE_PORT
    ),
    true
  );

  const context = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false
  });

  try {
    assert.ok(context.get(DocumentEvidenceController));
    assert.ok(context.get(DocumentEvidenceService));
    assert.ok(context.get(DOCUMENT_STORAGE_PORT));
  } finally {
    await context.close();
  }
});

test('storage factory defaults to local and never creates S3 without explicit selection', () => {
  for (const provider of [undefined, '', ' local ']) {
    let s3Creations = 0;
    const adapter = createDocumentStorageAdapterFromEnv(
      {
        DOCUMENT_STORAGE_PROVIDER: provider,
        DOCUMENT_STORAGE_LOCAL_ROOT: '.data/test-documents'
      },
      {
        createS3Client() {
          s3Creations += 1;
          throw new Error('must not run');
        }
      }
    );

    assert.ok(adapter instanceof LocalDocumentStorageAdapter);
    assert.equal(s3Creations, 0);
  }
});

test('storage factory creates S3 only with complete explicit safe configuration', () => {
  const configs: unknown[] = [];
  const adapter = createDocumentStorageAdapterFromEnv(
    {
      DOCUMENT_STORAGE_PROVIDER: 's3',
      AWS_REGION: 'us-east-1',
      AWS_S3_BUCKET: 'traza-demo-bucket',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      AWS_S3_PREFIX: 'document-evidence',
      AWS_S3_ENDPOINT: 'http://127.0.0.1:4566',
      AWS_S3_FORCE_PATH_STYLE: 'true'
    },
    {
      createS3Client(config) {
        configs.push(config);
        return { send: async () => ({}) } as never;
      }
    }
  );

  assert.ok(adapter instanceof S3DocumentStorageAdapter);
  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0], {
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key'
    },
    endpoint: 'http://127.0.0.1:4566/',
    forcePathStyle: true
  });
});

test('storage factory fails fast for invalid providers and incomplete S3 configuration', () => {
  assert.throws(
    () =>
      createDocumentStorageAdapterFromEnv({
        DOCUMENT_STORAGE_PROVIDER: 'unsupported'
      }),
    isConfigurationError
  );

  const required = [
    'AWS_REGION',
    'AWS_S3_BUCKET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
  ];
  const complete = {
    DOCUMENT_STORAGE_PROVIDER: 's3',
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET: 'traza-demo-bucket',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key'
  };

  for (const missing of required) {
    const env = { ...complete, [missing]: ' ' };
    assert.throws(
      () => createDocumentStorageAdapterFromEnv(env),
      isConfigurationError
    );
  }
});

test('storage factory rejects unsafe optional S3 configuration', () => {
  const base = {
    DOCUMENT_STORAGE_PROVIDER: 's3',
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET: 'traza-demo-bucket',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key'
  };

  for (const env of [
    { ...base, AWS_S3_ENDPOINT: 'ftp://invalid.test' },
    { ...base, AWS_S3_FORCE_PATH_STYLE: 'yes' },
    { ...base, AWS_S3_PREFIX: '../unsafe' }
  ]) {
    assert.throws(
      () => createDocumentStorageAdapterFromEnv(env),
      isConfigurationError
    );
  }
});

function isConfigurationError(error: unknown) {
  return (
    error instanceof DocumentStorageError && error.code === 'configuration'
  );
}
