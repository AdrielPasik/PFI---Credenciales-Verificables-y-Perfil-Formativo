import { Injectable, Optional } from '@nestjs/common';
import { BlockchainEvidenceMode, BlockchainRecordStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { type AnchorRegistrationEvidence } from './anchor-write-coordinator';
import {
  type BlockchainTargetEnvironment,
  type CredentialRegistryTarget,
  isCredentialRegistryNetwork,
  tryResolveBlockchainTarget
} from './blockchain-target';
import { createCredentialRegistryProvider } from './credential-registry-preflight';
import {
  type CredentialRegistryLog,
  type CredentialRegistryLogSearchRange,
  buildCredentialRegisteredFilter,
  selectCredentialRegisteredEvidence,
  toSafeUnixSeconds,
  unixSecondsToDate
} from './credential-registry-events';
import { BlockchainRegistrationService } from './blockchain-registration.service';

/**
 * Reconciliacion de registraciones PENDIENTES -- S8c6.
 *
 * ---------------------------------------------------------------------------
 * EL ESCENARIO QUE EXISTE PARA RESOLVER
 * ---------------------------------------------------------------------------
 *
 *   TX #1 commiteado -> registracion minada en la cadena -> el proceso muere
 *   antes de finalizar en la base.
 *
 * La credencial esta emitida, la cadena tiene la registracion, y la base dice
 * `pending`. Reconciliar es ADOPTAR esa evidencia.
 *
 * ---------------------------------------------------------------------------
 * NUNCA ESCRIBE EN LA CADENA -- ESTO ES CRITICO
 * ---------------------------------------------------------------------------
 *
 * Esta reconciliacion LEE, DESCUBRE, ADOPTA y FINALIZA. No llama a
 * `registerCredential` bajo NINGUN resultado, ni siquiera cuando la cadena
 * responde "no registrado".
 *
 * Razon: un intento anterior pudo haberse transmitido y estar todavia
 * pendiente, demorado, temporalmente invisible para la lectura del mapping o
 * sin minar. "Ahora no aparece" NO prueba "no se transmitio nada". Convertir
 * esa ambiguedad en un reenvio produciria una registracion duplicada.
 *
 * Cuando es seguro reenviar es una decision de politica operativa explicita, y
 * no se resuelve aca.
 *
 * ---------------------------------------------------------------------------
 * TARGET LIGADO AL RECORD
 * ---------------------------------------------------------------------------
 *
 * Una fila pendiente es intencion HISTORICA. No se la reconcilia contra el
 * contrato que este configurado hoy: la red, el chainId, la direccion del
 * contrato y el `deploymentId` salen de la FILA. Del entorno solo se toma el
 * endpoint de RPC de esa red, que es configuracion de runtime.
 *
 * ---------------------------------------------------------------------------
 * SIN CLAVES
 * ---------------------------------------------------------------------------
 *
 * Adoptar una registracion que ya ocurrio no necesita firmar nada. No se
 * resuelve ningun signer, no se toca SSM y no se construye ninguna Wallet.
 */

export type BlockchainReconciliationOutcome =
  | 'FINALIZED'
  | 'ALREADY_FINALIZED'
  | 'NOT_PENDING'
  | 'NOT_RECONCILABLE'
  | 'CHAIN_NOT_REGISTERED'
  | 'UNEXPECTED_REGISTRANT'
  | 'CONFLICTING_EVIDENCE'
  | 'EVIDENCE_INCOMPLETE'
  | 'TARGET_UNRESOLVED'
  | 'CHAIN_UNAVAILABLE';

export interface BlockchainReconciliationResult {
  readonly outcome: BlockchainReconciliationOutcome;
  readonly evidence: AnchorRegistrationEvidence | null;
}

/** Lo que la reconciliacion necesita de un provider: SOLO lecturas. */
export interface ReconciliationChainReader {
  getLogs(filter: {
    address: string;
    topics: readonly (string | null)[];
    fromBlock: number;
    toBlock: number | 'latest';
  }): Promise<readonly CredentialRegistryLog[]>;
  getBlock(blockNumber: number): Promise<{ timestamp?: unknown } | null>;
}

export interface ReconciliationDependencies {
  createReader?: (target: CredentialRegistryTarget) => ReconciliationChainReader;
  environment?: BlockchainTargetEnvironment;
}

@Injectable()
export class BlockchainRegistrationReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationService: BlockchainRegistrationService,
    @Optional()
    private readonly dependencies: ReconciliationDependencies = {}
  ) {}

  /**
   * Reconcilia UNA registracion pendiente. Idempotente.
   *
   * `searchRange` es OBLIGATORIO y se inyecta: `getLogs` necesita un rango de
   * bloques y S8c6 no lo adivina. El limite inferior definitivo es el bloque
   * de deploy del manifest que commitea S8c10; hasta entonces el
   * DESCUBRIMIENTO ACOTADO DE HUERFANOS EN VIVO depende de ese manifest.
   */
  async reconcilePendingRegistration(input: {
    recordId: string;
    searchRange: CredentialRegistryLogSearchRange;
  }): Promise<BlockchainReconciliationResult> {
    const record = await this.prisma.blockchainRecord.findUnique({
      where: { id: input.recordId },
      select: {
        id: true,
        status: true,
        evidenceMode: true,
        credentialHash: true,
        network: true,
        chainId: true,
        contractAddress: true,
        deploymentId: true,
        txHash: true,
        anchorSignerProfileId: true,
        anchorSignerProfile: { select: { address: true } }
      }
    });

    if (!record) {
      return unresolved('NOT_RECONCILABLE');
    }

    if (record.status !== BlockchainRecordStatus.pending) {
      return unresolved(
        record.status === BlockchainRecordStatus.registered
          ? 'ALREADY_FINALIZED'
          : 'NOT_PENDING'
      );
    }

    // Solo las filas de registry real tienen ciclo de vida pendiente. Un record
    // mock nunca entra aca.
    if (record.evidenceMode !== BlockchainEvidenceMode.credential_registry) {
      return unresolved('NOT_RECONCILABLE');
    }

    // REGISTRANTE ESPERADO: sale del perfil de ancla PERSISTIDO en la fila, que
    // es procedencia historica. NO del binding actual del issuer, NO de una
    // variable de entorno nueva, NO del signer de asercion y NO de
    // `Issuer.walletAddress`.
    const expectedRegistrant = record.anchorSignerProfile?.address;
    if (!record.anchorSignerProfileId || !expectedRegistrant) {
      return unresolved('NOT_RECONCILABLE');
    }

    const target = this.resolveRecordBoundTarget(record);
    if (!target) {
      return unresolved('TARGET_UNRESOLVED');
    }

    const reader = this.createReader(target);

    let logs: readonly CredentialRegistryLog[];
    try {
      logs = await reader.getLogs(
        buildCredentialRegisteredFilter(
          target.contractAddress,
          record.credentialHash,
          input.searchRange
        )
      );
    } catch {
      // El error crudo del provider no se propaga: puede llevar el endpoint.
      return unresolved('CHAIN_UNAVAILABLE');
    }

    const selection = selectCredentialRegisteredEvidence(logs, {
      credentialHash: record.credentialHash,
      registrant: expectedRegistrant
    });

    if (selection.kind === 'none') {
      // NO se reenvia. Queda pendiente.
      return unresolved('CHAIN_NOT_REGISTERED');
    }

    if (selection.kind === 'unexpected_registrant') {
      return unresolved('UNEXPECTED_REGISTRANT');
    }

    if (selection.kind === 'conflicting') {
      return unresolved('CONFLICTING_EVIDENCE');
    }

    const discovered = selection.evidence;

    // Si la fila ya tenia un checkpoint de txHash, la evidencia descubierta
    // tiene que ser LA MISMA transaccion. Una distinta es procedencia en
    // conflicto, no una alternativa aceptable.
    if (
      typeof record.txHash === 'string' &&
      record.txHash.toLowerCase() !== discovered.txHash
    ) {
      return unresolved('CONFLICTING_EVIDENCE');
    }

    // FECHA DE LA CADENA, desde el bloque recuperado. Sin reloj del servidor.
    let block: { timestamp?: unknown } | null;
    try {
      block = await reader.getBlock(discovered.blockNumber);
    } catch {
      return unresolved('CHAIN_UNAVAILABLE');
    }

    if (!block) {
      return unresolved('EVIDENCE_INCOMPLETE');
    }

    const seconds = toSafeUnixSeconds(block.timestamp);
    const registeredAt = seconds === null ? null : unixSecondsToDate(seconds);

    if (registeredAt === null) {
      // Timestamp ausente o mal formado: no se fabrica. Queda pendiente.
      return unresolved('EVIDENCE_INCOMPLETE');
    }

    const evidence: AnchorRegistrationEvidence = {
      txHash: discovered.txHash,
      blockNumber: discovered.blockNumber,
      registrant: discovered.registrant,
      registeredAt
    };

    await this.registrationService.finalizeRegistration({
      recordId: record.id,
      credentialHash: record.credentialHash,
      target,
      anchorSignerProfileId: record.anchorSignerProfileId,
      evidence
    });

    return { outcome: 'FINALIZED', evidence };
  }

  /**
   * Reconstruye el target desde la FILA.
   *
   * La identidad del deployment -- red, chainId, direccion, deploymentId -- es
   * la de la fila. Del entorno solo se toma el `rpcUrl`, y solo si la
   * configuracion actual apunta a la MISMA red: un endpoint de otra cadena no
   * sirve para leer esta.
   */
  private resolveRecordBoundTarget(record: {
    network: string;
    chainId: number;
    contractAddress: string;
    deploymentId: string | null;
  }): CredentialRegistryTarget | null {
    if (!isCredentialRegistryNetwork(record.network)) {
      return null;
    }

    if (!record.deploymentId) {
      return null;
    }

    const resolution = tryResolveBlockchainTarget(
      this.dependencies.environment ?? process.env
    );

    if (!resolution.ok) {
      return null;
    }

    const configured = resolution.target;
    if (configured.evidenceMode !== 'credential_registry') {
      return null;
    }

    if (
      configured.network !== record.network ||
      configured.chainId !== record.chainId
    ) {
      return null;
    }

    return {
      evidenceMode: 'credential_registry',
      network: record.network,
      chainId: record.chainId,
      // De la FILA, no de la configuracion actual.
      contractAddress: record.contractAddress,
      deploymentId: record.deploymentId,
      // Del entorno: es el endpoint de esta red.
      rpcUrl: configured.rpcUrl
    };
  }

  private createReader(
    target: CredentialRegistryTarget
  ): ReconciliationChainReader {
    if (this.dependencies.createReader) {
      return this.dependencies.createReader(target);
    }

    return createCredentialRegistryProvider(
      target
    ) as unknown as ReconciliationChainReader;
  }
}

function unresolved(
  outcome: BlockchainReconciliationOutcome
): BlockchainReconciliationResult {
  return { outcome, evidence: null };
}
