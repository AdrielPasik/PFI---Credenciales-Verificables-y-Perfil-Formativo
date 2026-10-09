import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { createCredentialRegistryProviderForRpcUrl } from '../../credential-registry-preflight';
import { readArtifactFile } from '../deployment-artifact';
import {
  DeployCliUsageError,
  parseDeployCliArgs,
  validateDeploymentRpcUrl
} from '../deployment-cli';
import { describeDeploymentError } from '../deployment-errors';
import {
  type DeploymentProvider,
  runCredentialRegistryDeployment
} from '../deployment-operator';
import { ProcessGitStateReader } from '../deployment-source-gate';
import { readDeploymentToolchainFile } from '../deployment-toolchain';
import { HiddenPromptError, promptHidden } from '../hidden-prompt';
import { KeystoreSignerSource } from '../keystore-signer-source';
import { FileManifestStore } from '../manifest-store';

/**
 * CLI de deployment de CredentialRegistry (Base Sepolia) -- S8c10.1.
 *
 *   npm run blockchain:deploy-registry -- --keystore <ruta> --source-commit <sha> [--execute]
 *
 * NO se ejecuto en S8c10.1: no hay deployment, ni RPC, ni keystore real.
 *
 * Sin `--execute` corre SOLO la compuerta previa (commit, arbol, toolchain,
 * artefacto, cadena, signer, nonce, direccion CREATE, gas) y no envia nada.
 *
 * Esta CLI NO usa `--env-file`: no debe heredar el `.env` de la API (que puede
 * contener la clave global legacy). Tampoco lee `CREDENTIAL_REGISTRY_PRIVATE_KEY`.
 *
 * Se corre desde un worktree/checkout limpio y dedicado en el commit fuente.
 * Imprime SOLO JSON seguro: direcciones, hashes y numeros publicos.
 */

const REPOSITORY_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');

async function main() {
  const options = parseDeployCliArgs(process.argv.slice(2));

  const deploymentsDirectory = join(REPOSITORY_ROOT, 'contracts', 'deployments');
  const toolchain = readDeploymentToolchainFile(
    join(deploymentsDirectory, 'deployment-toolchain.json')
  );

  const prompt = (label: string) =>
    promptHidden(label, { input: process.stdin, output: process.stderr });

  // El RPC lleva su token: entorno o prompt sin eco. NUNCA un argumento.
  const rpcUrl =
    validateDeploymentRpcUrl(process.env.CREDENTIAL_REGISTRY_RPC_URL) ??
    validateDeploymentRpcUrl(await prompt('RPC URL (https, hidden): '));
  if (!rpcUrl) {
    throw new DeployCliUsageError('ARGUMENT_INVALID');
  }

  // UN provider para toda la ejecucion.
  const provider = createCredentialRegistryProviderForRpcUrl(
    rpcUrl
  ) as unknown as DeploymentProvider;

  const result = await runCredentialRegistryDeployment(
    {
      toolchain,
      readForgeVersion: () =>
        execFileSync('forge', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
      git: new ProcessGitStateReader(REPOSITORY_ROOT),
      readArtifact: () =>
        readArtifactFile(
          join(REPOSITORY_ROOT, 'contracts', 'out', 'CredentialRegistry.sol', 'CredentialRegistry.json')
        ),
      provider,
      signerSource: new KeystoreSignerSource(options.keystorePath, () =>
        prompt('Keystore passphrase (hidden): ')
      ),
      manifestStore: new FileManifestStore(deploymentsDirectory)
    },
    {
      deploymentSourceCommit: options.deploymentSourceCommit,
      mode: options.execute ? 'execute' : 'preflight'
    }
  );

  console.log(
    JSON.stringify(
      result.kind === 'preflight_ok'
        ? { ok: true, kind: result.kind, attempt: result.attempt, estimatedGas: result.estimatedGas }
        : { ok: true, kind: result.kind, deploymentId: result.manifest.deploymentId, manifestPath: result.manifestPath },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  // Salida SEGURA: nunca el mensaje de una excepcion ajena.
  const described =
    error instanceof DeployCliUsageError || error instanceof HiddenPromptError
      ? { ok: false, code: error.code, message: error.message }
      : describeDeploymentError(error);
  console.error(JSON.stringify(described, null, 2));
  process.exitCode = 1;
});
