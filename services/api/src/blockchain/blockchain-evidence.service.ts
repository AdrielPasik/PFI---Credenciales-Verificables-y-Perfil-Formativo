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
  resolveBlockchainTarget
} from './blockchain-target';
import {
  ANVIL_CHAIN_ID,
  MOCK_REGISTRY_CONTRACT_ADDRESS
} from './credential-registry-deployment';

/**
 * Evidencia de blockchain en modo MOCK -- reducido a eso en S8c6.
 *
 * ---------------------------------------------------------------------------
 * POR QUE YA NO ESCRIBE EN LA CADENA
 * ---------------------------------------------------------------------------
 *
 * Hasta S8c5 este servicio tambien hacia la escritura real, y la hacia ADENTRO
 * de la transaccion interactiva de Prisma que recibe por parametro. Esa es
 * exactamente la deuda que S8a encontro y que S8c6 elimina: una transaccion de
 * PostgreSQL abierta durante el RPC y el minado.
 *
 * El camino `credential_registry` vive ahora en
 * `BlockchainRegistrationService`, con intent PENDING durable, escritura
 * despues del commit y finalizacion en una segunda transaccion corta.
 *
 * Lo que queda aca es el modo MOCK, que no tiene I/O externo: su evidencia se
 * calcula localmente, asi que crearla dentro de una transaccion corta es
 * correcto y no se la fuerza a pasar por PENDING solo por simetria.
 *
 * La autenticidad de la credencial (S8c4) es real en los dos modos: el modo de
 * evidencia de blockchain es un eje independiente.
 */

interface BlockchainEvidenceInput {
  credentialId: string;
  credentialHash: string;
  canonicalizationVersion: string;
  issuerAddress: string;
}

@Injectable()
export class BlockchainEvidenceService {
  /**
   * Crea la evidencia MOCK. Se llama dentro de una transaccion corta y no
   * hace ninguna llamada de red.
   *
   * `target` se puede inyectar para que el llamador resuelva la configuracion
   * UNA sola vez y no haya dos resoluciones que puedan divergir.
   */
  async createRecord(
    transaction: Prisma.TransactionClient,
    input: BlockchainEvidenceInput,
    target: BlockchainTarget = this.resolveTarget()
  ) {
    if (target.evidenceMode !== 'mock') {
      // Camino real: no es de este servicio. Un llamador que llegue aca con un
      // target de registry esta usando el ciclo de vida equivocado.
      throw new Error(
        'La evidencia de credential_registry se crea a traves del ciclo de vida de registracion.'
      );
    }

    return this.createMockRecord(transaction, input);
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
    //
    // Los tres campos que S8c6 volvio nullable se siguen poblando aca: la
    // semantica mock estaba congelada y no se la degrada para parecerse al
    // ciclo de vida real.
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

  private createMockTransactionHash(credentialId: string, credentialHash: string) {
    return `0x${createHash('sha256')
      .update(`mock-tx:${credentialId}:${credentialHash}`, 'utf8')
      .digest('hex')}`;
  }

  /** Resolucion LOCAL de configuracion. No toca la red. */
  resolveTarget(
    environment: BlockchainTargetEnvironment = process.env
  ): BlockchainTarget {
    return resolveBlockchainTarget(environment);
  }
}
