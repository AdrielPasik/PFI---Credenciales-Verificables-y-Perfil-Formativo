import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AnalysisRunModule } from '../analysis-run/analysis-run.module';
import { AppModule } from '../app.module';
import { AuthModule } from '../auth/auth.module';
import { IssuersModule } from '../issuers/issuers.module';
import { ReusableSemanticInterpretationController } from './reusable-semantic-interpretation.controller';
import { ReusableSemanticInterpretationModule } from './reusable-semantic-interpretation.module';
import { ReusableSemanticInterpretationService } from './reusable-semantic-interpretation.service';

test('ReusableSemanticInterpretationModule reuses auth, issuer authorization and profile rebuild without forwardRef', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    ReusableSemanticInterpretationModule
  ) as unknown[];

  // C5b.1: AnalysisRunModule exporta AutomaticProfileRebuildService,
  // reutilizado para el rebuild best-effort del perfil tras un apply.
  assert.deepEqual(imports, [AnalysisRunModule, AuthModule, IssuersModule]);

  const applicationContext = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false
  });

  try {
    assert.ok(applicationContext.get(ReusableSemanticInterpretationController));
    assert.ok(applicationContext.get(ReusableSemanticInterpretationService));
  } finally {
    await applicationContext.close();
  }
});
