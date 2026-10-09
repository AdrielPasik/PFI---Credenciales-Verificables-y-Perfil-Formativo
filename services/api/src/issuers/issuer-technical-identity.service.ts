import { Injectable, NotFoundException, Optional } from '@nestjs/common';

import {
  BlockchainTargetError,
  type CredentialRegistryTarget,
  isCredentialRegistryTarget
} from '../blockchain/blockchain-target';
import {
  CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider,
  createCredentialRegistryProvider
} from '../blockchain/credential-registry-preflight';
import { issuerDidDocumentUrl } from '../identity/did-web-issuer';
import { PrismaService } from '../prisma/prisma.service';
import {
  type IssuerNetworkHealthReason,
  type IssuerNetworkHealthResponseDto,
  type IssuerTechnicalIdentityResponseDto
} from './dto/issuer-technical-identity-response.dto';
import {
  evaluateIssuerReadiness,
  isValidEthereumAddress,
  resolveReadinessTarget
} from './issuer-readiness';
import { issuerReadinessSelect, toSnapshot } from './issuer-readiness.service';
import { IssuersService } from './issuers.service';

/**
 * Superficie tecnica del issuer -- S8c9.
 *
 * DOS acciones distintas, a proposito:
 *
 *   read()            DB/configuracion unicamente. Sin SSM, sin RPC.
 *   networkHealth()   accion EXPLICITA que si habla con la red. Nunca la llama
 *                     `read()`, nunca la llama la readiness, nunca la llama un
 *                     listado. Es diagnostico: no escribe nada.
 *
 * Las dos exigen membresia ACTIVA con rol admin del issuer, ANTES de cualquier
 * consulta tecnica o de red. No exigen que el issuer este autorizado: la pagina
 * existe justamente para ver por que no lo esta.
 */

/** Lo que el diagnostico necesita de un provider. Nada de firma. */
export interface NetworkHealthProvider extends CredentialRegistryPreflightProvider {
  getBlockNumber(): Promise<number>;
  getBalance(address: string): Promise<bigint>;
}

export interface IssuerTechnicalIdentityDependencies {
  /** Fabrica de provider inyectable. En produccion, la de S8c5. */
  createProvider?: (target: CredentialRegistryTarget) => NetworkHealthProvider;
  /** Entorno de target inyectable para tests. */
  environment?: Record<string, string | undefined>;
  now?: () => Date;
}

@Injectable()
export class IssuerTechnicalIdentityService {
  private readonly preflight = new CredentialRegistryPreflight();

  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    @Optional()
    private readonly dependencies: IssuerTechnicalIdentityDependencies = {}
  ) {}

  async read(
    issuerId: string,
    userId: string
  ): Promise<IssuerTechnicalIdentityResponseDto> {
    // AUTORIZACION PRIMERO.
    await this.issuersService.assertUserCanReadTechnicalIdentityForIssuer(
      userId,
      issuerId
    );

    const row = await this.prisma.issuer.findUnique({
      where: { id: issuerId },
      select: { ...issuerReadinessSelect, name: true }
    });

    if (!row) {
      throw new NotFoundException('No se encontro el emisor solicitado.');
    }

    const targetResolution = resolveReadinessTarget(this.environment());
    const readiness = evaluateIssuerReadiness(toSnapshot(row), targetResolution);
    const identity = row.technicalIdentity;
    const anchor = identity?.anchorSignerProfile ?? null;

    // Anclaje COMPARTIDO: conteo en la base, sin RPC y sin SSM.
    const anchorReferences = anchor
      ? await this.prisma.issuerTechnicalIdentity.count({
          where: { anchorSignerProfileId: anchor.id }
        })
      : 0;

    const target = targetResolution.ok ? targetResolution.target : null;

    return {
      issuerId: row.id,
      issuerName: row.name,
      authorizationStatus: row.authorizationStatus,
      allowedCredentialTypes: [...row.allowedCredentialTypes],
      administrativelyAuthorized: readiness.administrativelyAuthorized,
      configurationReady: readiness.configurationReady,
      hasCredentialCapabilities: readiness.hasCredentialCapabilities,
      readyToIssue: readiness.readyToIssue,
      readinessReasons: [...readiness.reasons],
      technicalIdentity: identity
        ? {
            status: identity.status,
            did: identity.did,
            didDocumentUrl: issuerDidDocumentUrl(identity.did, row.id)
          }
        : null,
      assertionSigner: identity?.assertionSignerProfile
        ? {
            address: identity.assertionSignerProfile.address,
            keyVersion: identity.assertionSignerProfile.keyVersion,
            status: identity.assertionSignerProfile.status
          }
        : null,
      anchorSigner: anchor
        ? {
            address: anchor.address,
            keyVersion: anchor.keyVersion,
            status: anchor.status,
            shared: anchorReferences > 1
          }
        : null,
      blockchainTarget: {
        mode: target ? target.evidenceMode : null,
        network: target && isCredentialRegistryTarget(target) ? target.network : null,
        chainId: target && isCredentialRegistryTarget(target) ? target.chainId : null,
        contractAddress:
          target && isCredentialRegistryTarget(target) ? target.contractAddress : null,
        deploymentId:
          target && isCredentialRegistryTarget(target) ? target.deploymentId : null
        // NUNCA `rpcUrl`.
      }
    };
  }

  /**
   * Diagnostico EXPLICITO de red. Un provider, cero signers, cero secretos, cero
   * transacciones y cero escrituras en la base.
   */
  async networkHealth(
    issuerId: string,
    userId: string
  ): Promise<IssuerNetworkHealthResponseDto> {
    // AUTORIZACION ANTES DE CREAR CUALQUIER PROVIDER.
    await this.issuersService.assertUserCanReadTechnicalIdentityForIssuer(
      userId,
      issuerId
    );

    const checkedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const targetResolution = resolveReadinessTarget(this.environment());

    if (!targetResolution.ok) {
      return emptyHealth('UNAVAILABLE', ['TARGET_UNCONFIGURED'], checkedAt);
    }

    const target = targetResolution.target;

    // MOCK: no hay cadena publica que observar. No se finge salud.
    if (!isCredentialRegistryTarget(target)) {
      return emptyHealth('NOT_APPLICABLE_MOCK', [], checkedAt);
    }

    const anchor = await this.prisma.issuerTechnicalIdentity.findUnique({
      where: { issuerId },
      select: { anchorSignerProfile: { select: { address: true } } }
    });
    const anchorAddress = anchor?.anchorSignerProfile?.address ?? null;

    const base = {
      network: target.network as string,
      chainId: target.chainId,
      contractAddress: target.contractAddress
    };

    // UN SOLO provider para todo el diagnostico.
    const provider = this.createProvider(target);

    try {
      await this.preflight.assertWritable(target, provider);
    } catch (error) {
      const code = error instanceof BlockchainTargetError ? error.code : null;

      return {
        ...emptyHealth('UNAVAILABLE', [preflightReason(code)], checkedAt),
        ...base,
        chainMatched:
          code === 'BLOCKCHAIN_NETWORK_MISMATCH'
            ? false
            : code === 'BLOCKCHAIN_CONTRACT_MISSING'
              ? true
              : null,
        contractCodePresent: code === 'BLOCKCHAIN_CONTRACT_MISSING' ? false : null
      };
    }

    const reasons: IssuerNetworkHealthReason[] = [];

    let latestBlockNumber: number | null = null;
    try {
      latestBlockNumber = await provider.getBlockNumber();
    } catch {
      reasons.push('LATEST_BLOCK_UNAVAILABLE');
    }

    let anchorBalanceWei: string | null = null;
    let anchorFunded: boolean | null = null;

    if (!anchorAddress || !isValidEthereumAddress(anchorAddress)) {
      reasons.push('ANCHOR_UNCONFIGURED');
    } else {
      try {
        const balance = await provider.getBalance(anchorAddress);
        anchorBalanceWei = balance.toString(10);
        anchorFunded = balance > 0n;
        if (!anchorFunded) {
          reasons.push('ANCHOR_UNFUNDED');
        }
      } catch {
        reasons.push('ANCHOR_BALANCE_UNAVAILABLE');
      }
    }

    return {
      status: reasons.length === 0 ? 'HEALTHY' : 'DEGRADED',
      reasons,
      chainMatched: true,
      contractCodePresent: true,
      latestBlockObserved: latestBlockNumber !== null,
      anchorFunded,
      ...base,
      latestBlockNumber,
      anchorBalanceWei,
      checkedAt
    };
  }

  private environment(): Record<string, string | undefined> {
    return this.dependencies.environment ?? process.env;
  }

  private createProvider(target: CredentialRegistryTarget): NetworkHealthProvider {
    if (this.dependencies.createProvider) {
      return this.dependencies.createProvider(target);
    }

    // La construccion UNICA de S8c5, con su timeout.
    return createCredentialRegistryProvider(target) as unknown as NetworkHealthProvider;
  }
}

function preflightReason(code: string | null): IssuerNetworkHealthReason {
  if (code === 'BLOCKCHAIN_NETWORK_MISMATCH') {
    return 'CHAIN_MISMATCH';
  }
  if (code === 'BLOCKCHAIN_CONTRACT_MISSING') {
    return 'CONTRACT_CODE_MISSING';
  }
  return 'RPC_UNAVAILABLE';
}

function emptyHealth(
  status: IssuerNetworkHealthResponseDto['status'],
  reasons: IssuerNetworkHealthReason[],
  checkedAt: string
): IssuerNetworkHealthResponseDto {
  return {
    status,
    reasons,
    chainMatched: null,
    contractCodePresent: null,
    latestBlockObserved: null,
    anchorFunded: null,
    network: null,
    chainId: null,
    contractAddress: null,
    latestBlockNumber: null,
    anchorBalanceWei: null,
    checkedAt
  };
}
