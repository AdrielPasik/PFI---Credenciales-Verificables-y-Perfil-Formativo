import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import {
  BlockchainEvidenceMode,
  BlockchainRecordStatus,
  CredentialStatus
} from '@prisma/client';

import {
  type BlockchainReconciliationOutcome,
  BlockchainRegistrationReconciliationService
} from '../blockchain/blockchain-registration-reconciliation.service';
import {
  DeploymentSearchRangeError,
  type DeploymentSearchRangeOptions,
  resolveDeploymentSearchRange
} from '../blockchain/reconciliation-search-range';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reconciliacion OPERATIVA de una registracion pendiente -- S8 cierre de Base
 * Sepolia.
 *
 * ---------------------------------------------------------------------------
 * QUE ES (Y QUE NO ES)
 * ---------------------------------------------------------------------------
 *
 * Expone, por un endpoint issuer-scoped, la reconciliacion que ya existia en
 * `BlockchainRegistrationReconciliationService` y que ningun camino de
 * produccion invocaba. NO implementa una segunda reconciliacion: delega.
 *
 * NUNCA ENVIA UNA TRANSACCION. Este archivo no importa el coordinador de
 * escrituras, el write client ni el resolver de signers (un test estructural lo
 * congela). Lo unico que puede hacer sobre la cadena es LEER logs y bloques a
 * traves del servicio de reconciliacion, y lo unico que escribe en la base es la
 * finalizacion `pending -> registered` de ese servicio, con la evidencia que la
 * propia cadena mostro.
 *
 * Si la cadena no muestra la registracion, el resultado es `still_pending`: no
 * se reenvia, porque "ahora no aparece" no prueba "nunca se transmitio".
 *
 * ---------------------------------------------------------------------------
 * ENTRADAS
 * ---------------------------------------------------------------------------
 *
 * Solo los ids de la ruta. NO acepta contrato, red, bloque ni rango del
 * llamador: el target sale de la FILA y el limite inferior de busqueda sale del
 * manifest de deployment de esa fila.
 *
 * ---------------------------------------------------------------------------
 * MONOTONIA
 * ---------------------------------------------------------------------------
 *
 * `registered` se devuelve tal cual (sin tocar la cadena) y `revoked` nunca
 * retrocede. Una credencial en `draft` no tiene registro que reconciliar.
 */

export type IssuerCredentialReconciliationResult =
  | 'registered'
  | 'still_pending'
  | 'revoked';

export interface IssuerCredentialReconciliationResponseDto {
  credentialReference: string;
  result: IssuerCredentialReconciliationResult;
  /**
   * Codigo CERRADO del resultado. Nunca texto de excepcion, endpoint ni
   * detalle del proveedor.
   */
  outcome:
    | 'ALREADY_REGISTERED'
    | 'FINALIZED'
    | 'REVOKED'
    | 'CHAIN_NOT_REGISTERED'
    | 'CHAIN_UNAVAILABLE'
    | 'EVIDENCE_INCOMPLETE';
  blockchain: {
    status: BlockchainRecordStatus;
    txHash: string | null;
    blockNumber: number | null;
    registeredAt: string | null;
    revokedAt: string | null;
  };
}

export type IssuerCredentialReconciliationErrorCode =
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_NOT_ISSUED'
  | 'BLOCKCHAIN_RECORD_MISSING'
  | 'BLOCKCHAIN_RECORD_AMBIGUOUS'
  | 'RECONCILIATION_NOT_APPLICABLE'
  | 'DEPLOYMENT_MANIFEST_UNAVAILABLE'
  | 'BLOCKCHAIN_TARGET_UNRESOLVED'
  | 'REGISTRANT_UNEXPECTED'
  | 'EVIDENCE_CONFLICT';

const SAFE_MESSAGES: Record<IssuerCredentialReconciliationErrorCode, string> = {
  CREDENTIAL_NOT_FOUND: 'No se encontro la credencial solicitada.',
  CREDENTIAL_NOT_ISSUED: 'Solo se puede reconciliar una credencial emitida.',
  BLOCKCHAIN_RECORD_MISSING: 'La credencial no tiene registro tecnico.',
  BLOCKCHAIN_RECORD_AMBIGUOUS:
    'La credencial tiene mas de un registro tecnico y no se puede reconciliar de forma segura.',
  RECONCILIATION_NOT_APPLICABLE:
    'El registro tecnico de esta credencial no admite reconciliacion con la red.',
  DEPLOYMENT_MANIFEST_UNAVAILABLE:
    'No se pudo determinar de forma segura el rango de busqueda del deployment.',
  BLOCKCHAIN_TARGET_UNRESOLVED:
    'La configuracion tecnica de la red no esta disponible para reconciliar.',
  REGISTRANT_UNEXPECTED:
    'La red registra este hash desde una cuenta distinta de la esperada. Requiere revision.',
  EVIDENCE_CONFLICT:
    'La evidencia de la red contradice la registrada. Requiere revision.'
};

const STATUS_BY_CODE: Record<IssuerCredentialReconciliationErrorCode, HttpStatus> = {
  CREDENTIAL_NOT_FOUND: HttpStatus.NOT_FOUND,
  CREDENTIAL_NOT_ISSUED: HttpStatus.CONFLICT,
  BLOCKCHAIN_RECORD_MISSING: HttpStatus.CONFLICT,
  BLOCKCHAIN_RECORD_AMBIGUOUS: HttpStatus.CONFLICT,
  RECONCILIATION_NOT_APPLICABLE: HttpStatus.CONFLICT,
  DEPLOYMENT_MANIFEST_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  BLOCKCHAIN_TARGET_UNRESOLVED: HttpStatus.SERVICE_UNAVAILABLE,
  REGISTRANT_UNEXPECTED: HttpStatus.CONFLICT,
  EVIDENCE_CONFLICT: HttpStatus.CONFLICT
};

/** Error de frontera estable: sin RPC, signer, registro ni detalle del proveedor. */
export class IssuerCredentialReconciliationError extends HttpException {
  constructor(code: IssuerCredentialReconciliationErrorCode) {
    super({ code, message: SAFE_MESSAGES[code] }, STATUS_BY_CODE[code]);
  }
}

const recordSelect = {
  id: true,
  status: true,
  evidenceMode: true,
  network: true,
  chainId: true,
  contractAddress: true,
  deploymentId: true,
  txHash: true,
  blockNumber: true,
  registeredAt: true,
  revokedAt: true
} as const;

@Injectable()
export class IssuerCredentialBlockchainReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly reconciliationService: BlockchainRegistrationReconciliationService,
    // Inyectable en tests (manifest en memoria). En produccion no se pasa.
    @Optional()
    private readonly searchRangeOptions: DeploymentSearchRangeOptions = {}
  ) {}

  async reconcileForIssuer(
    issuerId: string,
    credentialId: string,
    currentUser: { id: string }
  ): Promise<IssuerCredentialReconciliationResponseDto> {
    // Misma autorizacion que la emision y la revocacion: membership activa
    // admin/operator sobre un issuer autorizado.
    await this.issuersService.assertUserCanIssueCredentialForIssuer(
      currentUser.id,
      issuerId
    );

    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: {
        id: true,
        status: true,
        issuedAt: true,
        blockchainRecords: { select: recordSelect }
      }
    });

    if (!credential) {
      throw new IssuerCredentialReconciliationError('CREDENTIAL_NOT_FOUND');
    }

    if (credential.status === CredentialStatus.draft) {
      throw new IssuerCredentialReconciliationError('CREDENTIAL_NOT_ISSUED');
    }

    if (credential.blockchainRecords.length === 0) {
      throw new IssuerCredentialReconciliationError('BLOCKCHAIN_RECORD_MISSING');
    }

    // El dominio crea UNA fila por credencial. Mas de una es una anomalia: no
    // se elige ninguna, y no se toca la red.
    if (credential.blockchainRecords.length > 1) {
      throw new IssuerCredentialReconciliationError('BLOCKCHAIN_RECORD_AMBIGUOUS');
    }

    const record = credential.blockchainRecords[0];

    // MONOTONIA: revocada nunca retrocede, y no se consulta la red.
    if (
      record.status === BlockchainRecordStatus.revoked ||
      credential.status === CredentialStatus.revoked
    ) {
      return respond(credential.id, 'revoked', 'REVOKED', record);
    }

    // IDEMPOTENCIA: ya registrada se devuelve tal cual, sin tocar la red.
    if (record.status === BlockchainRecordStatus.registered) {
      return respond(credential.id, 'registered', 'ALREADY_REGISTERED', record);
    }

    // `pending` de un record MOCK no existe (el mock nace `registered`), pero un
    // pendiente sin modo de registry no tiene contra que reconciliarse.
    if (record.evidenceMode !== BlockchainEvidenceMode.credential_registry) {
      throw new IssuerCredentialReconciliationError('RECONCILIATION_NOT_APPLICABLE');
    }

    let searchRange;
    try {
      searchRange = resolveDeploymentSearchRange(record, this.searchRangeOptions);
    } catch (error) {
      if (error instanceof DeploymentSearchRangeError) {
        throw new IssuerCredentialReconciliationError(
          'DEPLOYMENT_MANIFEST_UNAVAILABLE'
        );
      }

      throw error;
    }

    const reconciliation =
      await this.reconciliationService.reconcilePendingRegistration({
        recordId: record.id,
        searchRange,
        // Estrecha la busqueda a "desde la emision"; el manifest sigue siendo el piso.
        ...(credential.issuedAt
          ? { pendingElapsedSeconds: (Date.now() - credential.issuedAt.getTime()) / 1000 }
          : {})
      });

    return this.mapOutcome(credential.id, record.id, reconciliation.outcome);
  }

  private async mapOutcome(
    credentialId: string,
    recordId: string,
    outcome: BlockchainReconciliationOutcome
  ): Promise<IssuerCredentialReconciliationResponseDto> {
    switch (outcome) {
      case 'FINALIZED':
      case 'ALREADY_FINALIZED':
        return respond(
          credentialId,
          'registered',
          outcome === 'FINALIZED' ? 'FINALIZED' : 'ALREADY_REGISTERED',
          await this.reloadRecord(recordId)
        );

      case 'CHAIN_NOT_REGISTERED':
      case 'CHAIN_UNAVAILABLE':
      case 'EVIDENCE_INCOMPLETE':
        // Sigue pendiente. NO se reenvia nada.
        return respond(
          credentialId,
          'still_pending',
          outcome,
          await this.reloadRecord(recordId)
        );

      case 'NOT_PENDING': {
        // Otra operacion cambio la fila entre la lectura y la reconciliacion.
        const current = await this.reloadRecord(recordId);

        if (current.status === BlockchainRecordStatus.revoked) {
          return respond(credentialId, 'revoked', 'REVOKED', current);
        }

        if (current.status === BlockchainRecordStatus.registered) {
          return respond(credentialId, 'registered', 'ALREADY_REGISTERED', current);
        }

        throw new IssuerCredentialReconciliationError('EVIDENCE_CONFLICT');
      }

      case 'TARGET_UNRESOLVED':
        throw new IssuerCredentialReconciliationError('BLOCKCHAIN_TARGET_UNRESOLVED');

      case 'UNEXPECTED_REGISTRANT':
        throw new IssuerCredentialReconciliationError('REGISTRANT_UNEXPECTED');

      case 'CONFLICTING_EVIDENCE':
        throw new IssuerCredentialReconciliationError('EVIDENCE_CONFLICT');

      case 'NOT_RECONCILABLE':
        throw new IssuerCredentialReconciliationError('RECONCILIATION_NOT_APPLICABLE');
    }
  }

  private async reloadRecord(recordId: string) {
    const current = await this.prisma.blockchainRecord.findUnique({
      where: { id: recordId },
      select: recordSelect
    });

    if (!current) {
      throw new IssuerCredentialReconciliationError('BLOCKCHAIN_RECORD_MISSING');
    }

    return current;
  }
}

function respond(
  credentialReference: string,
  result: IssuerCredentialReconciliationResult,
  outcome: IssuerCredentialReconciliationResponseDto['outcome'],
  record: {
    status: BlockchainRecordStatus;
    txHash: string | null;
    blockNumber: number | null;
    registeredAt: Date | null;
    revokedAt: Date | null;
  }
): IssuerCredentialReconciliationResponseDto {
  return {
    credentialReference,
    result,
    outcome,
    blockchain: {
      status: record.status,
      txHash: record.txHash,
      blockNumber: record.blockNumber,
      registeredAt: record.registeredAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null
    }
  };
}
