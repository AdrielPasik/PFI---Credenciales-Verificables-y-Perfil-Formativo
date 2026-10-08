import { Injectable, Optional } from '@nestjs/common';
import {
  BlockchainRecordStatus,
  CredentialStatus,
  Prisma,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { getAddress, isAddress } from 'ethers';

import { AutomaticProfileRebuildService } from '../analysis-run/automatic-profile-rebuild.service';
import {
  BlockchainRecordReconciliationService,
  type BlockchainRecordReconciliationResult
} from '../blockchain/blockchain-record-reconciliation.service';
import {
  type AnchorChainProvider,
  type AnchorRevocationGateDecision,
  AnchorWriteCoordinator
} from '../blockchain/anchor-write-coordinator';
import { CredentialRegistryReadClient } from '../blockchain/credential-registry-read-client';
import { type CredentialRegistryDeployment } from '../blockchain/credential-registry-deployment';
import { IssuerSignerResolver } from '../signing/issuer-signer-resolver';
import { SignerResolutionError } from '../signing/signer-resolution.error';
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
  /**
   * TODAS las filas de evidencia, sin `orderBy` y sin `take`.
   *
   * S8c7 congelo por que: el dominio crea exactamente UNA fila por credential,
   * asi que mas de una es una anomalia de integridad y no una serie temporal.
   * Ordenar y quedarse con la primera elegiria una fila arbitraria -- la tabla
   * no tiene `createdAt`, una fila `pending` tiene `registeredAt` NULL, y el
   * orden de UUID no es cronologia. Revocar la fila equivocada seria peor que
   * no revocar.
   */
  blockchainRecords: {
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
      revocationReason: true,
      deploymentId: true,
      // S8c8: EL ANCHOR HISTORICO. Es la respuesta a la rotacion: el contrato
      // solo acepta la revocacion de la cuenta que registro el hash, y despues
      // de rotar esa cuenta ya no es la vigente del issuer.
      anchorSignerProfileId: true,
      anchorSignerProfile: {
        // Metadata PUBLICA unicamente. Nunca `secretRef`.
        select: {
          id: true,
          purpose: true,
          status: true,
          address: true
        }
      }
    }
  }
} as const;

type RevocationCredential = Prisma.CredentialGetPayload<{
  select: typeof revocationCredentialSelect;
}>;
type RevocationBlockchainRecord = RevocationCredential['blockchainRecords'][number];
/** Fila con los tres hechos de la cadena YA observados. */
type FinalizedRevocationBlockchainRecord = Omit<
  RevocationBlockchainRecord,
  'txHash' | 'issuerAddress' | 'registeredAt'
> & {
  txHash: string;
  issuerAddress: string;
  registeredAt: Date;
};

/**
 * Anchor HISTORICO resuelto a partir del record, con su procedencia publica.
 *
 * `address` es la direccion PUBLICA persistida del perfil congelado en el
 * record. NO es `record.issuerAddress`: ese es el registrante OBSERVADO en la
 * cadena, y usarlo como fuente de la identidad esperada volveria circular la
 * comparacion -- se compararia la cadena contra lo que la cadena dijo.
 */
interface HistoricalAnchorIdentity {
  readonly profileId: string;
  readonly address: string;
}

@Injectable()
export class IssuerCredentialRevocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly reconciliationService: BlockchainRecordReconciliationService,
    private readonly automaticProfileRebuildService: AutomaticProfileRebuildService,
    // S8c8: el MISMO coordinador que usa la registracion. Una registracion y
    // una revocacion firmadas por la misma cuenta consumen el mismo stream de
    // nonces, asi que una cola propia para revocar se pisaria con la otra
    // exactamente igual que no tener ninguna.
    private readonly anchorWriteCoordinator: AnchorWriteCoordinator,
    // S8c8: resolucion del signer HISTORICO por id exacto de perfil.
    private readonly signerResolver: IssuerSignerResolver,
    @Optional()
    private readonly registryReadClient: CredentialRegistryReadClient = new CredentialRegistryReadClient()
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

    // S8c8: MULTIPLICIDAD. Mas de una fila es una anomalia de integridad, no
    // una coleccion de la que haya que elegir. Se falla cerrado ANTES de
    // resolver ninguna clave y antes de tocar la red.
    if (credential.blockchainRecords.length > 1) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_AMBIGUOUS');
    }

    // S8c6: una registracion que todavia no fue CONFIRMADA en la cadena no es
    // revocable on-chain. `pending` no es `registered`: el intent es durable,
    // pero no hay transaccion que revocar y no hay registrante observado contra
    // el que autorizar. Se trata como evidencia no resoluble -- el mismo camino
    // que un record ausente -- en vez de intentar revocar algo que nunca se
    // finalizo.
    const record = toFinalizedBlockchainRecord(
      credential.blockchainRecords[0] ?? null
    );
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
    record: FinalizedRevocationBlockchainRecord | null,
    reconciliation: BlockchainRecordReconciliationResult,
    reason: string | null
  ): Promise<void> {
    if (!record || !reconciliation.resolvedDeployment) {
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }

    const deployment = reconciliation.resolvedDeployment;

    // ------------------------------------------------------------------------
    // ANCHOR HISTORICO -- metadata PUBLICA primero, secreto despues
    // ------------------------------------------------------------------------
    const anchor = this.resolveHistoricalAnchorIdentity(record);

    // RESOLUCION DEL SECRETO. Recien aca, y por el perfil EXACTO que el record
    // congelo: nunca el anchor vigente del issuer, nunca `Issuer.walletAddress`,
    // nunca la clave de asercion, nunca una clave global de entorno.
    //
    // Un perfil comprometido falla ANTES de llegar al almacen de secretos.
    const signer = await this.resolveHistoricalAnchorSigner(anchor);

    try {
      const outcome = await this.anchorWriteCoordinator.revokeCredentialHash({
        target: deployment,
        signer: {
          profileId: signer.profileId,
          keyVersion: signer.keyVersion,
          address: signer.address,
          wallet: signer.wallet
        },
        credentialHash: record.credentialHash,
        // COMPUERTA DE CLAVE, dentro del carril. El perfil historico pudo
        // marcarse comprometido mientras este intento esperaba el carril de
        // otra operacion con el mismo ancla.
        assertSignerUsable: () =>
          this.assertHistoricalAnchorStillUsable(anchor, signer.address),
        // COMPUERTA DE CADENA, dentro del carril y sobre el MISMO provider ya
        // validado por el preflight. Otra request pudo revocar este mismo hash
        // mientras este intento esperaba: serializar no alcanza, hay que darse
        // cuenta.
        assertChainRevocable: (provider) =>
          this.assertChainStillRevocable({
            provider,
            deployment,
            credentialHash: record.credentialHash,
            expectedRegistrant: anchor.address
          })
      });

      void outcome;
    } catch (error) {
      // Un error de DOMINIO de una compuerta -- perfil comprometido, estado de
      // cadena no confiable -- no es un fallo de transporte y no se reinterpreta
      // releyendo la cadena: ya dice exactamente lo que paso, y ademas la
      // compuerta corta ANTES de enviar.
      if (error instanceof IssuerCredentialRevocationError) {
        throw error;
      }

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

  /**
   * Identidad del anchor HISTORICO, derivada del record y SOLO del record.
   *
   * ---------------------------------------------------------------------------
   * FILAS LEGACY SIN anchorSignerProfileId
   * ---------------------------------------------------------------------------
   *
   * Una fila real anterior a S8c6 puede tener `anchorSignerProfileId` en NULL.
   * En ese caso NO hay fallback: ni el anchor vigente del issuer, ni
   * `Issuer.walletAddress`, ni la clave de asercion, ni la clave global de
   * entorno. Se falla cerrado.
   *
   * Es deliberado y tiene costo: esas filas quedan no revocables on-chain. Pero
   * la alternativa -- firmar con una cuenta que no registro el hash -- produce
   * una transaccion que el contrato revierte (`UnauthorizedRevoker`), y
   * elegirla igual significaria haber decidido que el registrante historico es
   * negociable. El dataset transaccional de demo es descartable y S8c12 lo
   * regenera bajo el modelo final.
   *
   * ---------------------------------------------------------------------------
   * CORRELACION DE TRES VIAS
   * ---------------------------------------------------------------------------
   *
   * Antes de escribir tienen que coincidir:
   *
   *   direccion publica del SignerProfile historico
   *     == `BlockchainRecord.issuerAddress` (registrante OBSERVADO)
   *     == registrante que el contrato reporta hoy
   *
   * Las dos primeras se comparan aca; la tercera la comprueba la lectura ligada
   * al record, antes y DENTRO del carril.
   */
  private resolveHistoricalAnchorIdentity(
    record: FinalizedRevocationBlockchainRecord
  ): HistoricalAnchorIdentity {
    const profile = record.anchorSignerProfile;

    if (record.anchorSignerProfileId === null || !profile) {
      throw new IssuerCredentialRevocationError('HISTORICAL_ANCHOR_UNRESOLVED');
    }

    if (profile.purpose !== SignerProfilePurpose.anchor) {
      throw new IssuerCredentialRevocationError('HISTORICAL_ANCHOR_UNRESOLVED');
    }

    if (profile.status === SignerProfileStatus.compromised) {
      // Se falla ANTES de llegar al almacen de secretos: no se lee una clave
      // que no se va a poder usar, y no hay sustituto.
      throw new IssuerCredentialRevocationError(
        'HISTORICAL_ANCHOR_COMPROMISED'
      );
    }

    // La direccion publica del perfil historico TIENE que ser la que la cadena
    // observo cuando registro. Si no coinciden, la procedencia del record es
    // incoherente y no se escribe nada.
    if (!addressesMatch(profile.address, record.issuerAddress)) {
      throw new IssuerCredentialRevocationError('HISTORICAL_ANCHOR_UNRESOLVED');
    }

    return { profileId: profile.id, address: getAddress(profile.address) };
  }

  /** Resuelve el secreto del perfil historico. Errores tipados, nada crudo. */
  private async resolveHistoricalAnchorSigner(
    anchor: HistoricalAnchorIdentity
  ) {
    try {
      const signer = await this.signerResolver.resolveHistoricalAnchorSigner(
        anchor.profileId
      );

      // Coherencia final: la Wallet resuelta tiene que ser la direccion que el
      // record espera. El resolver ya lo valido contra el perfil; esto cierra
      // el circulo contra el record.
      if (!addressesMatch(signer.address, anchor.address)) {
        throw new IssuerCredentialRevocationError(
          'HISTORICAL_ANCHOR_UNRESOLVED'
        );
      }

      return signer;
    } catch (error) {
      if (error instanceof IssuerCredentialRevocationError) {
        throw error;
      }

      if (
        error instanceof SignerResolutionError &&
        error.code === 'SIGNER_PROFILE_COMPROMISED'
      ) {
        throw new IssuerCredentialRevocationError(
          'HISTORICAL_ANCHOR_COMPROMISED'
        );
      }

      // Cualquier otro fallo de resolucion -- secreto ausente, material
      // invalido, direccion que no deriva -- es indisponibilidad del signer. El
      // error original no se propaga: puede arrastrar detalle del almacen.
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_SIGNER_UNAVAILABLE');
    }
  }

  /**
   * COMPUERTA DE CLAVE dentro del carril -- S8c6.1 aplicado a la revocacion.
   *
   * Relee el perfil HISTORICO por su id congelado. No vuelve a mirar el binding
   * vigente del issuer: la procedencia es el record, no la configuracion de hoy.
   */
  private async assertHistoricalAnchorStillUsable(
    anchor: HistoricalAnchorIdentity,
    resolvedAddress: string
  ): Promise<void> {
    const profile = await this.prisma.signerProfile.findUnique({
      where: { id: anchor.profileId },
      select: { purpose: true, status: true, address: true }
    });

    if (
      !profile ||
      profile.purpose !== SignerProfilePurpose.anchor ||
      !addressesMatch(profile.address, resolvedAddress)
    ) {
      throw new IssuerCredentialRevocationError('HISTORICAL_ANCHOR_UNRESOLVED');
    }

    // `retired` SIGUE permitido: es exactamente la razon por la que retirado y
    // comprometido no son el mismo estado.
    if (profile.status === SignerProfileStatus.compromised) {
      throw new IssuerCredentialRevocationError(
        'HISTORICAL_ANCHOR_COMPROMISED'
      );
    }
  }

  /**
   * COMPUERTA DE CADENA dentro del carril -- addendum C.
   *
   * La lectura previa a la resolucion del secreto sigue siendo valiosa, pero es
   * solo una optimizacion ANTES de esperar el carril. Dos requests pueden haber
   * leido `revoked=false` y encolarse las dos; la segunda tiene que DARSE
   * CUENTA de que la primera ya revoco, no limitarse a ir detras.
   *
   * Se lee por el MISMO provider que el preflight acaba de autorizar.
   */
  private async assertChainStillRevocable(input: {
    provider: AnchorChainProvider;
    deployment: CredentialRegistryDeployment;
    credentialHash: string;
    expectedRegistrant: string;
  }): Promise<AnchorRevocationGateDecision> {
    const state = await this.registryReadClient.readCredentialStateOnProvider({
      target: input.deployment,
      credentialHash: input.credentialHash,
      expectedRegistrant: input.expectedRegistrant,
      provider: input.provider
    });

    if (state.kind !== 'credential_state') {
      // Hash ausente, registrante inesperado o lectura fallida: no se escribe.
      throw new IssuerCredentialRevocationError('BLOCKCHAIN_RECORD_UNRESOLVABLE');
    }

    // Ya revocado por otra request: CERO envios. La sincronizacion local la
    // hace el camino de post-escritura, que relee el estado igual.
    return state.status.revoked ? 'already_revoked' : 'send';
  }

  private async persistConfirmedRevocation(
    credential: RevocationCredential,
    record: FinalizedRevocationBlockchainRecord | null,
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
    record: FinalizedRevocationBlockchainRecord | null
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

function addressesMatch(left: string | null, right: string | null): boolean {
  // S8c6: el registrante OBSERVADO puede ser null en una fila `pending`. Null
  // nunca coincide con nada: falla cerrado.
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  if (!isAddress(left) || !isAddress(right)) {
    return false;
  }

  return getAddress(left) === getAddress(right);
}

/**
 * Devuelve la fila SOLO si su evidencia de cadena esta completa.
 *
 * Una fila `pending` -- o cualquiera a la que le falte un hecho de la cadena --
 * no describe una registracion confirmada, asi que para la revocacion equivale
 * a no tener evidencia.
 */
function toFinalizedBlockchainRecord(
  record: RevocationBlockchainRecord | null
): FinalizedRevocationBlockchainRecord | null {
  if (!record) {
    return null;
  }

  if (
    record.status === BlockchainRecordStatus.pending ||
    typeof record.txHash !== 'string' ||
    typeof record.issuerAddress !== 'string' ||
    !(record.registeredAt instanceof Date)
  ) {
    return null;
  }

  return {
    ...record,
    txHash: record.txHash,
    issuerAddress: record.issuerAddress,
    registeredAt: record.registeredAt
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
