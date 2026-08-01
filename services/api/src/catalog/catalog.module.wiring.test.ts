import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { AcademicCatalogController } from './academic-catalog.controller';
import { AcademicCatalogService } from './academic-catalog.service';
import { CatalogModule } from './catalog.module';

test('CatalogModule reuses auth and issuer authorization without forwardRef', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    CatalogModule
  ) as unknown[];

  assert.deepEqual(imports, [AuthModule, IssuersModule]);

  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    assert.ok(applicationContext.get(AcademicCatalogController));
    assert.ok(applicationContext.get(AcademicCatalogService));
  } finally {
    await applicationContext.close();
  }
});
