import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { IssuerCourseTemplatesController } from './issuer-course-templates.controller';
import { IssuerCourseTemplatesModule } from './issuer-course-templates.module';
import { IssuerCourseTemplatesService } from './issuer-course-templates.service';

test('IssuerCourseTemplatesModule reuses auth and issuer authorization without forwardRef', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    IssuerCourseTemplatesModule
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
    assert.ok(applicationContext.get(IssuerCourseTemplatesController));
    assert.ok(applicationContext.get(IssuerCourseTemplatesService));
  } finally {
    await applicationContext.close();
  }
});
