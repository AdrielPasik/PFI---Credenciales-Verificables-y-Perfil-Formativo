import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockchainNetwork, BlockchainRecordStatus, CredentialStatus, CredentialType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  type PublicCredentialVerificationResult,
  type VerifyCredentialResponseDto
} from './dto/verify-credential-response.dto';

const publicVerificationCredentialSelect = {
  id: true,
  status: true,
  type: true,
  title: true,
  issuedAt: true,
  revokedAt: true,
  revocationReason: true,
  canonicalHash: true,
  canonicalizationVersion: true,
  issuer: {
    select: {
      name: true,
      did: true
    }
  },
  subjectUser: {
    select: {
      displayName: true,
      firstName: true,
      lastName: true,
      did: true
    }
  },
  _count: {
    select: {
      blockchainRecords: true
    }
  },
  blockchainRecords: {
    orderBy: {
      registeredAt: 'desc' as const
    },
    take: 1,
    select: {
      network: true,
      chainId: true,
      txHash: true,
      status: true,
      registeredAt: true
    }
  }
} as const;

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getCredentialVerification(
    credentialId: string
  ): Promise<VerifyCredentialResponseDto> {
    const reference = this.normalizeReference(credentialId);
    const credential = await this.prisma.credential.findUnique({
      where: { id: reference },
      select: publicVerificationCredentialSelect
    });

    // Drafts deliberately behave exactly like unknown references.
    if (!credential || credential.status === CredentialStatus.draft) {
      throw new NotFoundException(
        'No se encontro una credencial verificable con esa referencia.'
      );
    }

    const latestBlockchainRecord = credential.blockchainRecords[0] ?? null;
    const verification = this.buildVerificationResult(credential.status, {
      canonicalHash: credential.canonicalHash,
      canonicalizationVersion: credential.canonicalizationVersion,
      hasRegisteredBlockchainRecord:
        latestBlockchainRecord?.status === BlockchainRecordStatus.registered
    });

    return {
      credentialReference: credential.id,
      exists: true,
      status: credential.status,
      statusLabel: credential.status === CredentialStatus.revoked ? 'Revocada' : 'Emitida',
      title: credential.title,
      type: credential.type,
      typeLabel: this.credentialTypeLabel(credential.type),
      issuer: {
        displayName: credential.issuer.name,
        did: this.optionalText(credential.issuer.did)
      },
      holder: {
        displayLabel: this.buildHolderDisplayLabel(credential.subjectUser),
        did: this.optionalText(credential.subjectUser.did)
      },
      issuedAt: this.serializeDateTime(credential.issuedAt),
      revokedAt: this.serializeDateTime(credential.revokedAt),
      revocationReason: this.optionalText(credential.revocationReason),
      canonicalHash: this.optionalText(credential.canonicalHash),
      canonicalHashShort: this.abbreviateReference(credential.canonicalHash),
      canonicalizationVersion: this.optionalText(credential.canonicalizationVersion),
      integrity: {
        canonicalHashPresent: Boolean(credential.canonicalHash),
        blockchainRecordsCount: credential._count.blockchainRecords,
        latestBlockchainRecord: latestBlockchainRecord
          ? {
              network: latestBlockchainRecord.network,
              networkLabel: this.networkLabel(latestBlockchainRecord.network),
              chainId: latestBlockchainRecord.chainId,
              txHash: latestBlockchainRecord.txHash,
              txHashShort: this.abbreviateReference(latestBlockchainRecord.txHash),
              status: latestBlockchainRecord.status,
              statusLabel:
                latestBlockchainRecord.status === BlockchainRecordStatus.revoked
                  ? 'Registro revocado'
                  : 'Registro técnico disponible',
              registeredAt: this.serializeDateTime(latestBlockchainRecord.registeredAt)
            }
          : null
      },
      verification: {
        ...verification,
        checkedAt: new Date().toISOString()
      }
    };
  }

  private buildVerificationResult(
    status: CredentialStatus,
    integrity: {
      canonicalHash: string | null;
      canonicalizationVersion: string | null;
      hasRegisteredBlockchainRecord: boolean;
    }
  ): Omit<VerifyCredentialResponseDto['verification'], 'checkedAt'> {
    if (status === CredentialStatus.revoked) {
      return {
        result: 'revoked',
        summary:
          'La credencial fue revocada por el emisor. La evidencia histórica se conserva para consulta.'
      };
    }

    if (integrity.canonicalHash && integrity.canonicalizationVersion) {
      return {
        result: 'valid_issued',
        summary: integrity.hasRegisteredBlockchainRecord
          ? 'La credencial está emitida y conserva una huella de integridad registrada por Traza. Existe evidencia técnica de registro en la red configurada.'
          : 'La credencial está emitida y conserva una huella de integridad registrada por Traza.'
      };
    }

    return {
      result: 'not_verifiable',
      summary:
        'La credencial está emitida, pero no cuenta con la información técnica necesaria para completar la verificación.'
    };
  }

  private normalizeReference(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (!normalized || normalized.length > 200) {
      throw new BadRequestException('La referencia de credencial no es válida.');
    }

    return normalized;
  }

  private buildHolderDisplayLabel(holder: {
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  }): string | null {
    const displayName = this.optionalText(holder.displayName);
    if (displayName) {
      return displayName;
    }

    const names = [holder.firstName, holder.lastName]
      .map((value) => this.optionalText(value))
      .filter((value): value is string => value !== null);

    return names.length > 0 ? names.join(' ') : null;
  }

  private credentialTypeLabel(type: CredentialType): string {
    return {
      academic_subject: 'Asignatura académica',
      course: 'Curso',
      certification: 'Certificación',
      degree: 'Título académico'
    }[type];
  }

  private networkLabel(network: BlockchainNetwork): string {
    if (network === BlockchainNetwork.anvil) {
      return 'Entorno técnico/demo';
    }

    if (network === BlockchainNetwork.base_sepolia) {
      return 'Testnet';
    }

    return 'Red técnica configurada';
  }

  private optionalText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized || null;
  }

  private abbreviateReference(value: string | null): string | null {
    const normalized = this.optionalText(value);
    if (!normalized) {
      return null;
    }

    return normalized.length > 18
      ? `${normalized.slice(0, 10)}…${normalized.slice(-6)}`
      : normalized;
  }

  private serializeDateTime(value: Date | null): string | null {
    return value ? value.toISOString().replace('.000Z', 'Z') : null;
  }
}
