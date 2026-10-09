import {
  type DeploymentManifest,
  validateDeploymentManifest
} from './deployment-manifest';
import { getAddress } from 'ethers';

/**
 * Consistencia target de runtime <-> manifest canonico -- S8c10.1. PURO.
 *
 * Existe para que S8c10.2 / S8c11 puedan PROBAR que
 *
 *   manifest address A  ==  configured address A
 *
 * antes de poner `BLOCKCHAIN_EVIDENCE_MODE=credential_registry`. Compara las
 * cuatro piezas no secretas del target. NUNCA mira ni devuelve el RPC.
 *
 * No lee AWS ni SSM: recibe los valores ya obtenidos (por el operador) y los
 * compara. FALLA CERRADO: cualquier campo ausente, "unset", mal formado o
 * distinto es una razon.
 */

export interface SafeTargetConfiguration {
  CREDENTIAL_REGISTRY_NETWORK?: string;
  CREDENTIAL_REGISTRY_CHAIN_ID?: string;
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS?: string;
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID?: string;
}

export type TargetManifestMismatchReason =
  | 'MANIFEST_INVALID'
  | 'TARGET_INCOMPLETE'
  | 'DEPLOYMENT_ID_UNSET'
  | 'NETWORK_MISMATCH'
  | 'CHAIN_MISMATCH'
  | 'ADDRESS_MISMATCH'
  | 'DEPLOYMENT_ID_MISMATCH';

export type TargetManifestCheck =
  | { readonly ok: true; readonly manifest: DeploymentManifest }
  | { readonly ok: false; readonly reasons: readonly TargetManifestMismatchReason[] };

export function checkTargetAgainstManifest(
  manifestInput: unknown,
  target: SafeTargetConfiguration
): TargetManifestCheck {
  const validation = validateDeploymentManifest(manifestInput);
  if (!validation.ok) {
    return { ok: false, reasons: ['MANIFEST_INVALID'] };
  }
  const manifest = validation.manifest;

  const reasons: TargetManifestMismatchReason[] = [];
  const {
    CREDENTIAL_REGISTRY_NETWORK: network,
    CREDENTIAL_REGISTRY_CHAIN_ID: chainId,
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: address,
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID: deploymentId
  } = target;

  if (!network || !chainId || !address || !deploymentId) {
    return { ok: false, reasons: ['TARGET_INCOMPLETE'] };
  }

  if (deploymentId.toLowerCase() === 'unset') {
    reasons.push('DEPLOYMENT_ID_UNSET');
  }
  if (network !== manifest.network) {
    reasons.push('NETWORK_MISMATCH');
  }
  // Decimal estricto: `84532` y no ` 84532`, `084532` ni `0x14a34`.
  if (chainId !== String(manifest.chainId)) {
    reasons.push('CHAIN_MISMATCH');
  }
  if (!sameAddress(address, manifest.contractAddress)) {
    reasons.push('ADDRESS_MISMATCH');
  }
  if (deploymentId !== manifest.deploymentId && !reasons.includes('DEPLOYMENT_ID_UNSET')) {
    reasons.push('DEPLOYMENT_ID_MISMATCH');
  }

  return reasons.length === 0 ? { ok: true, manifest } : { ok: false, reasons };
}

function sameAddress(configured: string, manifestAddress: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(configured)) {
    return false;
  }
  try {
    return getAddress(configured) === manifestAddress;
  } catch {
    return false;
  }
}

/** Salida segura de una linea. Nada de configuracion. */
export function formatTargetManifestCheck(check: TargetManifestCheck): string {
  return check.ok
    ? 'TARGET_MATCH=true'
    : `TARGET_MATCH=false REASONS=${check.reasons.join(',')}`;
}
