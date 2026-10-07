import assert from 'node:assert/strict';
import test from 'node:test';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { AnalysisRunModule } from '../analysis-run/analysis-run.module';
import { AppModule } from '../app.module';
import { AuthGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { IssuersModule } from '../issuers/issuers.module';
import { IssuerSignerResolver } from '../signing/issuer-signer-resolver';
import { SigningModule } from '../signing/signing.module';
import { CredentialProofService } from './credential-proof.service';
import { CredentialsModule } from './credentials.module';
import { IssuerCredentialDraftUpdateController } from './issuer-credential-draft-update.controller';
import { IssuerCredentialDraftUpdateService } from './issuer-credential-draft-update.service';
import { IssuerCredentialIssueController } from './issuer-credential-issue.controller';
import { IssuerCredentialIssueService } from './issuer-credential-issue.service';
import { IssuerCredentialRevocationController } from './issuer-credential-revocation.controller';
import { IssuerCredentialRevocationService } from './issuer-credential-revocation.service';
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
  assert.equal(imports.includes(AnalysisRunModule), true);
  assert.equal(providers.includes(AuthService), false);
  assert.equal(providers.includes(AuthGuard), false);
  assert.equal(providers.includes(IssuerCredentialReadService), true);
  assert.equal(providers.includes(IssuerCredentialIssueService), true);
  assert.equal(providers.includes(IssuerCredentialRevocationService), true);
  assert.equal(providers.includes(IssuerCredentialDraftUpdateService), true);
  assert.equal(controllers.includes(IssuerCredentialReadController), true);
  assert.equal(controllers.includes(IssuerCredentialIssueController), true);
  assert.equal(controllers.includes(IssuerCredentialRevocationController), true);
  assert.equal(
    controllers.includes(IssuerCredentialDraftUpdateController),
    true
  );

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
    assert.ok(applicationContext.get(IssuerCredentialIssueController));
    assert.ok(applicationContext.get(IssuerCredentialIssueService));
    assert.ok(applicationContext.get(IssuerCredentialRevocationController));
    assert.ok(applicationContext.get(IssuerCredentialRevocationService));
    assert.ok(applicationContext.get(IssuerCredentialDraftUpdateController));
    assert.ok(applicationContext.get(IssuerCredentialDraftUpdateService));
  } finally {
    await applicationContext.close();
  }
});

// ---------------------------------------------------------------------------
// S8c4: la autoria criptografica queda cableada, y el arranque sigue siendo
// PEREZOSO. Este test corre SIN credenciales de AWS, SIN region, SIN prefijo
// de secretos y SIN RPC configurados: si el arranque intentara resolver un
// signer o leer un secreto, no podria completarse.
// ---------------------------------------------------------------------------

test('S8c4: el AppModule cablea la autoria sin resolver ningun signer al arrancar', async () => {
  const imports = Reflect.getMetadata(
    MODULE_METADATA.IMPORTS,
    CredentialsModule
  ) as unknown[];
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    CredentialsModule
  ) as unknown[];

  assert.equal(imports.includes(SigningModule), true);
  assert.equal(providers.includes(CredentialProofService), true);
  // La custodia NO se re-provee aca: viene de SigningModule, que es el unico
  // dueno del almacen de secretos.
  assert.equal(providers.includes(IssuerSignerResolver), false);

  const absentEnvironment = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'SIGNER_SECRET_REF_PREFIX',
    'CREDENTIAL_REGISTRY_RPC_URL',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY'
  ];
  const saved = new Map<string, string | undefined>();
  for (const key of absentEnvironment) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  // Se instrumenta el resolver para detectar CUALQUIER resolucion durante el
  // arranque. No alcanza con un comentario que diga que es perezoso.
  const resolutions: string[] = [];
  const originalAssertion =
    IssuerSignerResolver.prototype.resolveAssertionSignerForIssuer;
  const originalAnchor =
    IssuerSignerResolver.prototype.resolveAnchorSignerForIssuer;

  IssuerSignerResolver.prototype.resolveAssertionSignerForIssuer = async function (
    issuerId: string
  ) {
    resolutions.push(`assertion:${issuerId}`);
    throw new Error('el arranque no debe resolver ningun signer');
  };
  IssuerSignerResolver.prototype.resolveAnchorSignerForIssuer = async function (
    issuerId: string
  ) {
    resolutions.push(`anchor:${issuerId}`);
    throw new Error('el arranque no debe resolver ningun signer');
  };

  let applicationContext;
  try {
    applicationContext = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: false,
      logger: false
    });

    const proofService = applicationContext.get(CredentialProofService);
    assert.ok(proofService);
    assert.equal(typeof proofService.prepareAssertionSigner, 'function');
    assert.equal(typeof proofService.createProof, 'function');

    // El resolver existe y es inyectable, pero nadie lo invoco.
    assert.ok(applicationContext.get(IssuerSignerResolver, { strict: false }));
    assert.deepEqual(resolutions, [], 'la firma es perezosa');
  } finally {
    IssuerSignerResolver.prototype.resolveAssertionSignerForIssuer =
      originalAssertion;
    IssuerSignerResolver.prototype.resolveAnchorSignerForIssuer = originalAnchor;
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await applicationContext?.close();
  }
});
