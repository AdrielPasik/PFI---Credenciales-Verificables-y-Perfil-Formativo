import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { AuthGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { IssuersModule } from '../issuers/issuers.module';
import { CredentialsModule } from './credentials.module';
import { IssuerCredentialReadController } from './issuer-credential-read.controller';
import { IssuerCredentialReadService } from './issuer-credential-read.service';

test('CredentialsModule wires issuer credential read without duplicate auth providers or forwardRef', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    CredentialsModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    CredentialsModule
  ) as unknown[];
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    CredentialsModule
  ) as unknown[];

  assert.equal(imports.includes(AuthModule), true);
  assert.equal(imports.includes(IssuersModule), true);
  assert.equal(providers.includes(AuthService), false);
  assert.equal(providers.includes(AuthGuard), false);
  assert.equal(providers.includes(IssuerCredentialReadService), true);
  assert.equal(controllers.includes(IssuerCredentialReadController), true);

  const applicationContext = await NestFactory.createApplicationContext(
    AppModule,
    {
      abortOnError: false,
      logger: false
    }
  );

  try {
    assert.ok(applicationContext.get(IssuerCredentialReadController));
    assert.ok(applicationContext.get(IssuerCredentialReadService));
  } finally {
    await applicationContext.close();
  }
});
