import { Injectable } from '@nestjs/common';
import { BlockchainNetwork } from '@prisma/client';
import { getAddress, isAddress } from 'ethers';

import {
  type BlockchainTargetEnvironment,
  type BlockchainTargetField,
  type CredentialRegistryTarget,
  chainIdForCredentialRegistryNetwork,
  isCredentialRegistryNetwork,
  tryResolveBlockchainTarget
} from './blockchain-target';

/** Derivado del mapeo unico de S8c5, no un segundo literal. */
export const ANVIL_CHAIN_ID = chainIdForCredentialRegistryNetwork(
  BlockchainNetwork.anvil
);
export const MOCK_REGISTRY_CONTRACT_ADDRESS =
  '0x0000000000000000000000000000000000000001';

export interface BlockchainRecordDeploymentIdentity {
  network: BlockchainNetwork;
  chainId: number;
  contractAddress: string;
  credentialHash: string;
  issuerAddress: string;
}

/**
 * S8c5: un deployment resuelto ES un `CredentialRegistryTarget` validado. Antes
 * eran dos formas competidoras de lo mismo, y la de aca no llevaba
 * `deploymentId`, asi que la procedencia del deployment no podia viajar hasta la
 * escritura.
 */
export type CredentialRegistryDeployment = CredentialRegistryTarget;

/** @deprecated Usar `BlockchainTargetEnvironment`, que es el contrato completo. */
export type CredentialRegistryDeploymentEnvironment = BlockchainTargetEnvironment;

/** Razon por la que un BlockchainRecord no pudo ligarse a un deployment. */
export type RecordBoundDeploymentUnresolvedReason =
  | 'unsupported_network'
  | 'unexpected_chain_id'
  | 'registry_mode_not_enabled'
  | 'missing_rpc_url'
  | 'missing_contract_address'
  | 'invalid_configured_contract_address'
  | 'contract_address_mismatch'
  | 'invalid_target_configuration';

export type RecordBoundDeploymentResolution =
  | {
      kind: 'resolved';
      deployment: CredentialRegistryDeployment;
    }
  | {
      kind: 'mock_unsupported';
    }
  | {
      kind: 'deployment_unresolved';
      reason: RecordBoundDeploymentUnresolvedReason;
    };

/**
 * Liga un `BlockchainRecord` ya persistido al deployment EXACTO que lo emitio.
 *
 * S8c5: la configuracion del entorno ya no se lee aca campo por campo. Se pide
 * un `BlockchainTarget` validado al unico resolver que existe, y despues se
 * comprueba que el record describa ESE deployment. Antes este metodo codificaba
 * "anvil o nada": el chainId de Anvil estaba escrito a mano y el modo
 * `credential_registry_anvil` hacia de interruptor de red.
 *
 * La direccion del contrato NO se toma del record: el record tiene que coincidir
 * con la configurada. Un record no puede redirigir una escritura.
 */
@Injectable()
export class CredentialRegistryDeploymentResolver {
  resolve(
    record: BlockchainRecordDeploymentIdentity,
    environment: BlockchainTargetEnvironment = process.env
  ): RecordBoundDeploymentResolution {
    if (isMockBlockchainRecord(record)) {
      return { kind: 'mock_unsupported' };
    }

    if (!isCredentialRegistryNetwork(record.network)) {
      return {
        kind: 'deployment_unresolved',
        reason: 'unsupported_network'
      };
    }

    if (record.chainId !== chainIdForCredentialRegistryNetwork(record.network)) {
      return {
        kind: 'deployment_unresolved',
        reason: 'unexpected_chain_id'
      };
    }

    const resolution = tryResolveBlockchainTarget(environment);
    if (!resolution.ok) {
      return {
        kind: 'deployment_unresolved',
        reason: unresolvedReasonForField(resolution.field)
      };
    }

    const target = resolution.target;
    if (target.evidenceMode !== 'credential_registry') {
      return {
        kind: 'deployment_unresolved',
        reason: 'registry_mode_not_enabled'
      };
    }

    // El record fue emitido en SU red. Si hoy el target apunta a otra, este
    // record no pertenece al deployment configurado y no se lo puede mutar.
    if (target.network !== record.network) {
      return {
        kind: 'deployment_unresolved',
        reason: 'unsupported_network'
      };
    }

    const recordContractAddress = normalizeAddress(record.contractAddress);
    if (
      !recordContractAddress ||
      recordContractAddress !== target.contractAddress
    ) {
      return {
        kind: 'deployment_unresolved',
        reason: 'contract_address_mismatch'
      };
    }

    return { kind: 'resolved', deployment: target };
  }
}

/**
 * Traduce el campo de configuracion que fallo a la razon historica de esta
 * resolucion, para que los consumidores existentes (la revocacion) no cambien
 * de comportamiento. `BLOCKCHAIN_EVIDENCE_MODE` invalido se reporta como
 * "modo no habilitado", que es exactamente lo que significa para el llamador.
 */
function unresolvedReasonForField(
  field: BlockchainTargetField
): RecordBoundDeploymentUnresolvedReason {
  switch (field) {
    case 'BLOCKCHAIN_EVIDENCE_MODE':
      return 'registry_mode_not_enabled';
    case 'CREDENTIAL_REGISTRY_RPC_URL':
      return 'missing_rpc_url';
    case 'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS':
      return 'invalid_configured_contract_address';
    case 'CREDENTIAL_REGISTRY_NETWORK':
    case 'CREDENTIAL_REGISTRY_CHAIN_ID':
    case 'CREDENTIAL_REGISTRY_DEPLOYMENT_ID':
      return 'invalid_target_configuration';
  }
}

export function deploymentMatchesBlockchainRecord(
  deployment: CredentialRegistryDeployment,
  record: Pick<
    BlockchainRecordDeploymentIdentity,
    'network' | 'chainId' | 'contractAddress'
  >
): boolean {
  const recordContractAddress = normalizeAddress(record.contractAddress);

  return (
    deployment.network === record.network &&
    deployment.chainId === record.chainId &&
    recordContractAddress !== null &&
    deployment.contractAddress === recordContractAddress
  );
}

export function isMockBlockchainRecord(
  record: Pick<
    BlockchainRecordDeploymentIdentity,
    'network' | 'chainId' | 'contractAddress'
  >
): boolean {
  const contractAddress = normalizeAddress(record.contractAddress);

  return (
    record.network === BlockchainNetwork.anvil &&
    record.chainId === ANVIL_CHAIN_ID &&
    contractAddress === getAddress(MOCK_REGISTRY_CONTRACT_ADDRESS)
  );
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value || !isAddress(value)) {
    return null;
  }

  return getAddress(value);
}
