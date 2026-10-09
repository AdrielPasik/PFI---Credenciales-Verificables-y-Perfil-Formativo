import { SSMClient } from '@aws-sdk/client-ssm';
import { PrismaClient } from '@prisma/client';

import { resolveDidConfig } from '../../config/did-config';
import { setAllowedCredentialTypes } from '../../issuers/issuer-capability-policy';
import { type PrismaService } from '../../prisma/prisma.service';
import { CsprngSignerMaterialGenerator } from '../operator/signer-material-generator';
import { SsmSignerSecretWriter } from '../operator/ssm-signer-secret-writer';
import { SignerRotationService } from '../signer-rotation.service';
import { TechnicalIdentityProvisioningService } from '../technical-identity-provisioning.service';
import {
  type CliCommand,
  describeCliError,
  parseCliArgs
} from './technical-identity-cli.utils';

/**
 * CLI de OPERACION de identidad tecnica -- S8c9.
 *
 *   identity:set-capabilities  --issuer <id> --types A,B   (sin SSM, sin claves)
 *   identity:provision         --issuer <id> --types A,B [--shared-anchor <profileId>]
 *   identity:rotate-assertion  --issuer <id>
 *   identity:rotate-anchor     --issuer <id> [--shared-anchor <profileId>]
 *
 * Imprime SOLO JSON seguro: ids, direcciones, versiones, secretRef. Nunca clave.
 */
async function main() {
  const [kind, ...argv] = process.argv.slice(2);
  const command = parseCliArgs(kind as CliCommand['kind'], argv);
  const prisma = new PrismaClient();

  try {
    const result = await execute(command, prisma as unknown as PrismaService);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function execute(command: CliCommand, prisma: PrismaService) {
  if (command.kind === 'set-capabilities') {
    // Camino SIN SSM: no construye cliente AWS, ni generador, ni rotacion.
    return setAllowedCredentialTypes(prisma, command);
  }

  const provisioning = new TechnicalIdentityProvisioningService({
    prisma,
    generator: new CsprngSignerMaterialGenerator(),
    secretWriter: new SsmSignerSecretWriter(
      new SSMClient({}),
      process.env.SIGNER_SECRET_KMS_KEY_ID || undefined
    ),
    rotationService: new SignerRotationService(prisma),
    didConfig: resolveDidConfig(),
    secretRefPrefix: process.env.SIGNER_SECRET_REF_PREFIX
  });

  switch (command.kind) {
    case 'provision':
      return provisioning.provisionInitial(command);
    case 'rotate-assertion':
      return provisioning.rotateAssertion(command);
    case 'rotate-anchor':
      return provisioning.rotateAnchor(command);
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify(describeCliError(error), null, 2));
  process.exitCode = 1;
});
