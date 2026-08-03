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
import { DOCUMENT_STORAGE_PORT } from './document-storage.port';
import { DocumentUploadInterceptor } from './document-upload.interceptor';

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
