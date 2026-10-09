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
import { PREFLIGHT_EVIDENCE_FIELDS } from '../deployment-preflight';
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
 * Sin `--execute` corre SOLO la compuerta previa de LECTURA (commit, arbol,
 * toolchain, artefacto, cadena 84532, signer, nonces latest/pending, direccion
 * CREATE esperada, gas, fee data, saldo y costo maximo estimado) y no firma ni
 * envia nada. Imprime UN resultado sanitizado con sus bloqueantes.
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

  if (result.kind === 'preflight') {
    // Solo los campos de la allowlist, en orden estable.
    const evidence: Record<string, unknown> = {};
    for (const field of PREFLIGHT_EVIDENCE_FIELDS) {
      evidence[field] = result.evidence[field];
    }
    console.log(JSON.stringify({ ok: true, kind: result.kind, ...evidence }, null, 2));
    // 0 = lista para pedir aprobacion humana; 3 = hay bloqueantes (no es un error).
    process.exitCode = result.evidence.readyForExplicitBroadcastApproval ? 0 : 3;
    return;
  }

  console.log(
    JSON.stringify(
      { ok: true, kind: result.kind, deploymentId: result.manifest.deploymentId, manifestPath: result.manifestPath },
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
