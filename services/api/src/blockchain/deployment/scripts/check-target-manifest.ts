import { readFileSync } from 'node:fs';

import {
  checkTargetAgainstManifest,
  formatTargetManifestCheck
} from '../target-manifest-consistency';

/**
 * Compara el target de runtime con el manifest canonico -- S8c10.1.
 *
 *   npm run blockchain:check-target -- <ruta-al-manifest>
 *
 * Compara las cuatro variables no secretas del target (red, chainId, direccion,
 * deploymentId) del entorno. NO lee el RPC, NO lee AWS ni SSM y no modifica nada.
 * Imprime una unica linea: `TARGET_MATCH=true` o `TARGET_MATCH=false REASONS=...`.
 */
function main() {
  const manifestPath = process.argv[2];

  if (!manifestPath || process.argv.length !== 3) {
    console.error('Uso: blockchain:check-target <ruta-al-manifest>');
    process.exitCode = 2;
    return;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.log('TARGET_MATCH=false REASONS=MANIFEST_INVALID');
    process.exitCode = 1;
    return;
  }

  // Se entrega el entorno tal cual: la funcion pura lee unicamente las cuatro
  // claves no secretas del target y nunca el RPC. Este script no nombra ninguna
  // variable del target (eso es del resolver).
  const check = checkTargetAgainstManifest(manifest, process.env);

  console.log(formatTargetManifestCheck(check));
  process.exitCode = check.ok ? 0 : 1;
}

main();
