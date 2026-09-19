import { Injectable, Optional } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  CredentialStatus,
  Prisma
} from '@prisma/client';
import { getAddress, isAddress } from 'ethers';

import { AutomaticProfileRebuildService } from '../analysis-run/automatic-profile-rebuild.service';
import {
  BlockchainRecordReconciliationService,
  type BlockchainRecordReconciliationResult
} from '../blockchain/blockchain-record-reconciliation.service';
import {
  createRecordBoundCredentialRegistryWriteClient,
  resolveCredentialRegistrySignerAddress,
  type NormalizedCredentialRegistryWriteResult
} from '../blockchain/credential-registry-write-client';
import { type CredentialRegistryDeployment } from '../blockchain/credential-registry-deployment';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssuerCredentialRevocationResponseDto } from './dto/issuer-credential-revocation-response.dto';
import {
  IssuerCredentialRevocationError,
  type IssuerCredentialRevocationErrorCode
} from './issuer-credential-revocation.error';

const revocationCredentialSelect = {
  id: true,
  issuerId: true,
  subjectUserId: true,
  status: true,
  canonicalHash: true,
  canonicalizationVersion: true,
  blockchainRecords: {
    orderBy: [
      { registeredAt: 'desc' },
      { id: 'desc' }
    ] as Prisma.BlockchainRecordOrderByWithRelationInput[],
    take: 1,
    select: {
      id: true,
      credentialId: true,
      credentialHash: true,
      hashAlgorithm: true,
      canonicalizationVersion: true,
      network: true,
      chainId: true,
      contractAddress: true,
      txHash: true,
      issuerAddress: true,
      registeredAt: true,
      status: true,
      revokedAt: true,
      revocationReason: true
    }
  }
} as const;

type RevocationCredential = Prisma.CredentialGetPayload<{
  select: typeof revocationCredentialSelect;
}>;
type RevocationBlockchainRecord = RevocationCredential['blockchainRecords'][number];

interface CredentialRegistryRevocationWriter {
  revokeCredential(
    credentialHash: string
  ): Promise<NormalizedCredentialRegistryWriteResult>;
}

type CredentialRegistryRevocationWriterFactory = (
  deployment: CredentialRegistryDeployment
) => CredentialRegistryRevocationWriter;

@Injectable()
export class IssuerCredentialRevocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly reconciliationService: BlockchainRecordReconciliationService,
    private readonly automaticProfileRebuildService: AutomaticProfileRebuildService,
    @Optional()
    private readonly createRegistryWriter: CredentialRegistryRevocationWriterFactory =
      createRecordBoundCredentialRegistryWriteClient,
    @Optional()
    private readonly resolveSignerAddress: () => string =
      resolveCredentialRegistrySignerAddress
  ) {}

  async revokeForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: { id: string },
    body: unknown
  ): Promise<IssuerCredentialRevocationResponseDto> {
    const reason = normalizeRevocationReason(body);

    await this.issuersService.assertUserCanIssueCredentialForIssuer(
      currentUser.id,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: revocationCredentialSelect
    });

    if (!credential) {
      throw new IssuerCredentialRevocationError('CREDENTIAL_NOT_FOUND');
    }

    const record = credential.blockchainRecords[0] ?? null;
    const reconciliation = await this.classifySafely(credential, record);

    switch (reconciliation.state) {
      case 'DB_ISSUED_CHAIN_ACTIVE':
        await this.revokeActiveRecord(credential, record, reconciliation, reason);
        return this.rebuildAndRespond(credential);

      case 'DB_ISSUED_CHAIN_REVOKED':
        await this.persistConfirmedRevocation(credential, record, reconciliation, null);
        return this.rebuildAndRespond(credential);

      case 'DB_REVOKED_CHAIN_REVOKED':
        return this.rebuildAndRespond(credential);

      case 'DB_REVOKED_CHAIN_ACTIVE':
        throw new IssuerCredentialRevocationError('BLOCKCHAIN_STATE_INCONSISTENT');

      case 'DB_STATE_UNSUPPORTED':
        throw new IssuerCredentialRevocationError('CREDENTIAL_NOT_ISSUED');

      case 'DEPLOYMENT_UNRESOLVED':
        throw new IssuerCredentialRevocationError('BLOCKCHAIN_DEPLOYMENT_UNRESOLVED');

      case 'CHAIN_RECORD_MISSING':
      case 'MOCK_UNSUPPORTED':
      case 'LEGACY_UNRESOLVABLE':
      case 'CREDENTIAL_CORRELATION_FAILED':
        throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }
  }

  private async revokeActiveRecord(
    credential: RevocationCredential,
    record: RevocationBlockchainRecord | null,
    reconciliation: BlockchainRecordReconciliationResult,
    reason: string | null
  ): Promise<void> {
    if (!record || !reconciliation.resolvedDeployment) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }

    this.assertConfiguredSignerCanRevoke(record);

    try {
      const writer = this.createRegistryWriter(
        reconciliation.resolvedDeployment
      );
      const result = await writer.revokeCredential(record.credentialHash);
      if (result.status !== 'success') {
        throw new Error('unsuccessful_registry_receipt');
      }
    } catch (error) {
      // A transport error can arrive after the chain accepted the transaction.
      // Re-read the exact record before deciding whether this invocation failed.
      const afterWrite = await this.classifySafely(credential, record);
      if (afterWrite.state !== 'DB_ISSUED_CHAIN_REVOKED') {
        void error;
        throw new IssuerCredentialRevocationError('BLOCKCHAIN_WRITE_FAILED');
      }

      await this.persistConfirmedRevocation(credential, record, afterWrite, reason);
      return;
    }

    const afterWrite = await this.classifySafely(credential, record);
    if (afterWrite.state !== 'DB_ISSUED_CHAIN_REVOKED') {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_WRITE_FAILED');
    }

    await this.persistConfirmedRevocation(credential, record, afterWrite, reason);
  }

  private assertConfiguredSignerCanRevoke(record: RevocationBlockchainRecord): void {
    let signerAddress: string;
    try {
      signerAddress = this.resolveSignerAddress();
    } catch {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_SIGNER_UNAVAILABLE');
    }

    if (!addressesMatch(signerAddress, record.issuerAddress)) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_SIGNER_UNAUTHORIZED');
    }
  }

  private async persistConfirmedRevocation(
    credential: RevocationCredential,
    record: RevocationBlockchainRecord | null,
    reconciliation: BlockchainRecordReconciliationResult,
    reason: string | null
  ): Promise<void> {
    if (!record) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }

    const revokedAt = chainTimestampToDate(reconciliation.chainRevokedAt);
    if (!revokedAt) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }

    try {
      await this.prisma.$transaction(async (transaction) => {
        const credentialUpdate = await transaction.credential.updateMany({
          where: {
            id: credential.id,
            issuerId: credential.issuerId,
            status: CredentialStatus.issued
          },
          data: {
            status: CredentialStatus.revoked,
            revokedAt,
            revocationReason: reason
          }
        });

        if (credentialUpdate.count === 0) {
          return;
        }

        await transaction.blockchainRecord.updateMany({
          where: {
            id: record.id,
            credentialId: credential.id,
            status: BlockchainRecordStatus.registered
          },
          data: {
            status: BlockchainRecordStatus.revoked,
            revokedAt,
            revocationReason: reason
          }
        });
      });
    } catch {
      throw new IssuerCredentialRevocationError('DATABASE_RECONCILIATION_FAILED');
    }
  }

  private async rebuildAndRespond(
    credential: RevocationCredential
  ): Promise<IssuerCredentialRevocationResponseDto> {
    const profileRebuild =
      await this.automaticProfileRebuildService.rebuildAfterRevocation({
        credentialId: credential.id,
        holderUserId: credential.subjectUserId
      });

    if (profileRebuild.status === 'failed') {
      throw new IssuerCredentialRevocationError('PROFILE_RECONCILIATION_FAILED');
    }

    const revokedAt = await this.findPersistedRevokedAt(credential.id, credential.issuerId);
    if (!revokedAt) {
      throw new IssuerCredentialRevocationError('DATABASE_RECONCILIATION_FAILED');
    }

    return {
      credentialReference: credential.id,
      status: 'revoked',
      revokedAt: revokedAt.toISOString(),
      profileReconciliation: 'rebuilt'
    };
  }

  private async findPersistedRevokedAt(
    credentialId: string,
    issuerId: string
  ): Promise<Date | null> {
    try {
      const persisted = await this.prisma.credential.findFirst({
        where: { id: credentialId, issuerId, status: CredentialStatus.revoked },
        select: { revokedAt: true }
      });
      return persisted?.revokedAt ?? null;
    } catch {
      throw new IssuerCredentialRevocationError('DATABASE_RECONCILIATION_FAILED');
    }
  }

  private async classifySafely(
    credential: RevocationCredential,
    record: RevocationBlockchainRecord | null
  ): Promise<BlockchainRecordReconciliationResult> {
    try {
      return await this.reconciliationService.classify({
        credential: {
          status: credential.status,
          canonicalHash: credential.canonicalHash,
          canonicalizationVersion: credential.canonicalizationVersion
        },
        blockchainRecord: record
      });
    } catch {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }
  }
}

export function normalizeRevocationReason(body: unknown): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== 'reason')) {
    throw new IssuerCredentialRevocationError('INVALID_REVOCATION_REASON');
  }

  const value = body.reason;
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new IssuerCredentialRevocationError('INVALID_REVOCATION_REASON');
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new IssuerCredentialRevocationError('INVALID_REVOCATION_REASON');
  }

  return normalized || null;
}

function chainTimestampToDate(value: string | null): Date | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const seconds = BigInt(value);
  const milliseconds = seconds * 1000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  const date = new Date(Number(milliseconds));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addressesMatch(left: string, right: string): boolean {
  if (!isAddress(left) || !isAddress(right)) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
