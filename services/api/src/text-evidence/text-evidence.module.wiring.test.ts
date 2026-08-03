import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { TextEvidenceController } from './text-evidence.controller';
import { TextEvidenceModule } from './text-evidence.module';
import { TextEvidenceService } from './text-evidence.service';

test('TextEvidenceModule wires auth and issuer permissions without cycles', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    TextEvidenceModule
  ) as unknown[];
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    TextEvidenceModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    TextEvidenceModule
  ) as unknown[];

  assert.deepEqual(imports, [AuthModule, IssuersModule]);
  assert.deepEqual(controllers, [TextEvidenceController]);
  assert.deepEqual(providers, [TextEvidenceService]);

  const context = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false
  });

  try {
    assert.ok(context.get(TextEvidenceController));
    assert.ok(context.get(TextEvidenceService));
  } finally {
    await context.close();
  }
});
