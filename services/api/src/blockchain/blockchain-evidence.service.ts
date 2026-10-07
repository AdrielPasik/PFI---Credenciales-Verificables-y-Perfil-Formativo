import { Injectable } from '@nestjs/common';
import {
  BlockchainEvidenceMode,
  BlockchainRecordStatus,
  BlockchainNetwork,
  Prisma
} from '@prisma/client';
import { createHash } from 'crypto';

import {
  type BlockchainTarget,
  type BlockchainTargetEnvironment,
  type CredentialRegistryTarget,
  resolveBlockchainTarget
} from './blockchain-target';
import {
  ANVIL_CHAIN_ID,
  MOCK_REGISTRY_CONTRACT_ADDRESS
} from './credential-registry-deployment';
import {
  type CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider
} from './credential-registry-preflight';
import {
  type CredentialRegistrySignerEnvironment,
  CredentialRegistryWriteClient,
  createCredentialRegistryWriteClientForTarget
} from './credential-registry-write-client';

/**
 * Creacion de evidencia de blockchain -- refactorizado en S8c5.
 *
 * Lo que cambio: el MODO ya no lleva la red adentro. Antes
 * `credential_registry_anvil` significaba a la vez "usar el registry real" y
 * "esa red es Anvil, chainId 31337", y los dos literales estaban escritos a
 * mano en el cuerpo de la escritura. Ahora el modo solo dice QUE mecanismo se
 * usa, y la red/chainId/contrato/deployment salen de un `BlockchainTarget`
 * validado.
 *
 * Lo que NO cambio: el ciclo de vida. Esta sigue siendo una escritura
 * sincronica adentro de la transaccion interactiva de Prisma, que es el limite
 * malo que S8a encontro. S8c5 no lo arregla y tampoco lo empeora: no agrega
 * ninguna llamada de red nueva adentro de la transaccion mas alla del preflight
 * que precede a la escritura que ya estaba ahi. El pending/finalize es S8c6.
 */

interface BlockchainEvidenceInput {
  credentialId: string;
  credentialHash: string;
  canonicalizationVersion: string;
  issuerAddress: string;
}

interface BlockchainEvidenceOverrides {
  /** Sirve a la vez al target y a la custodia legacy del signer. */
  environment?: BlockchainTargetEnvironment & CredentialRegistrySignerEnvironment;
  preflight?: CredentialRegistryPreflight;
  preflightProvider?: CredentialRegistryPreflightProvider;
}

@Injectable()
export class BlockchainEvidenceService {
  async createRecord(
    transaction: Prisma.TransactionClient,
    input: BlockchainEvidenceInput
  ) {
    // UNA sola resolucion de configuracion, y es LOCAL: no toca la red. Un modo
    // real incompleto falla cerrado aca, nunca degrada a mock.
    const target = this.resolveTarget();

    if (target.evidenceMode === 'mock') {
      return this.createMockRecord(transaction, input);
    }

    return this.createCredentialRegistryRecord(transaction, input, target);
  }

  private async createMockRecord(
    transaction: Prisma.TransactionClient,
    input: BlockchainEvidenceInput
  ) {
    const txHash = this.createMockTransactionHash(
      input.credentialId,
      input.credentialHash
    );

    // El triple (anvil, 31337, 0x…01) es la IDENTIDAD de un record mock y la
    // reconocen `isMockBlockchainRecord` y la reconciliacion. No se toca: es lo
    // que impide que la revocacion intente mutar una cadena que no existe.
    // `evidenceMode` lo hace explicito ademas de implicito.
    return transaction.blockchainRecord.create({
      data: {
        credentialId: input.credentialId,
        credentialHash: input.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: input.canonicalizationVersion,
        network: BlockchainNetwork.anvil,
        chainId: ANVIL_CHAIN_ID,
        contractAddress: MOCK_REGISTRY_CONTRACT_ADDRESS,
        txHash,
        issuerAddress: input.issuerAddress,
        registeredAt: new Date(),
        status: BlockchainRecordStatus.registered,
        evidenceMode: BlockchainEvidenceMode.mock
      }
    });
  }

  private async createCredentialRegistryRecord(
    transaction: Prisma.TransactionClient,
    input: BlockchainEvidenceInput,
    target: CredentialRegistryTarget
  ) {
    if (!input.credentialHash) {
      throw new Error(
        'credentialHash es requerido para registrar evidencia en CredentialRegistry.'
      );
    }

    let transactionResult;

    try {
      // El preflight (cadena esperada + codigo del contrato) corre adentro del
      // write client, antes de pedirle la transaccion al contrato.
      transactionResult = await this.createWriteClient(
        target
      ).registerCredential(input.credentialHash);
    } catch (error) {
      // No se arrastra el error crudo: podria traer la URL del RPC con su
      // credencial adentro. Se preserva el error tipado y seguro del target y
      // se descarta cualquier otro detalle.
      throw this.toSafeRegistryWriteError(error);
    }

    if (transactionResult.status !== 'success') {
      throw new Error(
        'La transaccion de CredentialRegistry no fue exitosa para la credencial solicitada.'
      );
    }

    // PROCEDENCIA desde el target VALIDADO, no desde literales. Un hash anclado
    // en Base Sepolia queda registrado como base_sepolia/84532, y nunca como
    // anvil/31337.
    return transaction.blockchainRecord.create({
      data: {
        credentialId: input.credentialId,
        credentialHash: input.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: input.canonicalizationVersion,
        network: target.network,
        chainId: target.chainId,
        contractAddress: target.contractAddress,
        txHash: transactionResult.transactionHash,
        issuerAddress: transactionResult.from ?? input.issuerAddress,
        registeredAt: new Date(),
        status: BlockchainRecordStatus.registered,
        evidenceMode: BlockchainEvidenceMode.credential_registry,
        deploymentId: target.deploymentId
      }
    });
  }

  private createMockTransactionHash(credentialId: string, credentialHash: string) {
    return `0x${createHash('sha256')
      .update(`mock-tx:${credentialId}:${credentialHash}`, 'utf8')
      .digest('hex')}`;
  }

  /**
   * Punto de extension para tests: devuelve el cliente de escritura real para
   * un target ya validado. Ningun test de S8c5 llega a la red -- los dobles
   * sustituyen este metodo o inyectan `preflightProvider`.
   */
  protected createWriteClient(
    target: CredentialRegistryTarget
  ): CredentialRegistryWriteClient {
    return createCredentialRegistryWriteClientForTarget(
      target,
      this.overrides().environment ?? process.env,
      {
        preflight: this.overrides().preflight,
        preflightProvider: this.overrides().preflightProvider
      }
    );
  }

  /** Sobrescribible en tests; en produccion no aporta nada. */
  protected overrides(): BlockchainEvidenceOverrides {
    return {};
  }

  private resolveTarget(): BlockchainTarget {
    return resolveBlockchainTarget(
      this.overrides().environment ?? process.env
    );
  }

  /**
   * Reduce cualquier fallo de escritura a un error seguro.
   *
   * Un `BlockchainTargetError` ya tiene mensaje fijo y pasa tal cual: es lo que
   * distingue "cadena equivocada" de "sin contrato" de "RPC caido". Cualquier
   * otro error se reemplaza por un mensaje fijo, porque un error de ethers
   * puede contener el endpoint completo.
   */
  private toSafeRegistryWriteError(error: unknown): Error {
    if (error instanceof Error && error.name === 'BlockchainTargetError') {
      return error;
    }

    return new Error(
      'No se pudo registrar el hash on-chain en CredentialRegistry.'
    );
  }
}
