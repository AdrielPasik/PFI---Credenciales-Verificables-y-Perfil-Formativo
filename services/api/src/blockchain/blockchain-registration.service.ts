import { Injectable } from '@nestjs/common';
import {
  AnchorRegistrantScope,
  BlockchainEvidenceMode,
  BlockchainRecordStatus,
  Prisma,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IssuerSignerResolver } from '../signing/issuer-signer-resolver';
import {
  type AnchorRegistrationEvidence,
  type AnchorSignerSnapshot,
  AnchorWriteCoordinator
} from './anchor-write-coordinator';
import { type CredentialRegistryTarget } from './blockchain-target';

/**
 * Ciclo de vida DURABLE de la registracion en blockchain -- S8c6.
 *
 * ---------------------------------------------------------------------------
 * LA DEUDA QUE ELIMINA
 * ---------------------------------------------------------------------------
 *
 * Antes (hallazgo de S8a):
 *
 *   BEGIN -> RPC -> mineo -> COMMIT
 *
 * Una transaccion de PostgreSQL quedaba abierta durante el minado. Si la
 * cadena fallaba, la credencial volvia a draft y perdia su proof; si la base
 * fallaba despues de minar, la registracion quedaba huerfana sin rastro.
 *
 * Ahora:
 *
 *   TX #1  credential emitida + proof + intent PENDING durable   -> COMMIT
 *   ----   (sin transaccion)  cola -> preflight -> write -> receipt -> bloque
 *   TX #2  PENDING -> registered con procedencia real            -> COMMIT
 *
 * ---------------------------------------------------------------------------
 * EL CAMBIO CONCEPTUAL
 * ---------------------------------------------------------------------------
 *
 * Despues de que TX #1 commitea, la credencial ESTA EMITIDA. Su `credential_v2`,
 * su `canon_v2`, su `canonicalHash` y su `scope-proof-v1` son durables y validos
 * con independencia de la disponibilidad de la cadena.
 *
 * Un fallo posterior de RPC, de preflight, de minado, de receipt, de bloque o
 * de la propia finalizacion NO revierte la emision, NO borra el proof y NO
 * cambia el hash canonico. La evidencia de blockchain simplemente queda
 * PENDING.
 */

/** Signer de anclaje resuelto, mas la metadata publica con la que se resolvio. */
export interface PreparedAnchorSigner {
  readonly snapshot: AnchorSignerSnapshot;
}

export interface AnchorIntentSnapshot {
  readonly anchorSignerProfileId: string;
  readonly anchorRegistrantScope: AnchorRegistrantScope;
}

export class BlockchainRegistrationError extends Error {
  readonly code: BlockchainRegistrationErrorCode;

  constructor(code: BlockchainRegistrationErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'BlockchainRegistrationError';
    this.code = code;
  }
}

export type BlockchainRegistrationErrorCode =
  | 'ANCHOR_BINDING_CHANGED'
  | 'ANCHOR_SCOPE_UNDERIVABLE'
  | 'FINALIZATION_CONFLICT'
  | 'ANCHOR_PROFILE_COMPROMISED';

const SAFE_MESSAGES: Record<BlockchainRegistrationErrorCode, string> = {
  ANCHOR_BINDING_CHANGED:
    'La configuracion de anclaje del emisor cambio durante la emision.',
  ANCHOR_SCOPE_UNDERIVABLE:
    'No se pudo determinar el alcance del registrante de anclaje.',
  FINALIZATION_CONFLICT:
    'La evidencia de blockchain ya registrada no coincide con la observada.',
  ANCHOR_PROFILE_COMPROMISED:
    'El perfil de anclaje dejo de ser utilizable antes de enviar la registracion.'
};

export function safeBlockchainRegistrationMessage(
  code: BlockchainRegistrationErrorCode
): string {
  return SAFE_MESSAGES[code];
}

@Injectable()
export class BlockchainRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signerResolver: IssuerSignerResolver,
    private readonly coordinator: AnchorWriteCoordinator
  ) {}

  /**
   * Resuelve el signer de ANCLAJE del issuer.
   *
   * FUERA de toda transaccion: puede leer SSM en un miss de cache, y esa
   * latencia no entra en una transaccion de PostgreSQL. S8c2 ya garantiza
   * identidad tecnica activa, perfil activo, proposito `anchor`,
   * `addressVerifiedAt` presente y correspondencia direccion/clave.
   */
  async prepareAnchorSigner(issuerId: string): Promise<PreparedAnchorSigner> {
    const resolved = await this.signerResolver.resolveAnchorSignerForIssuer(
      issuerId
    );

    return {
      snapshot: {
        profileId: resolved.profileId,
        keyVersion: resolved.keyVersion,
        address: resolved.address,
        wallet: resolved.wallet
      }
    };
  }

  /**
   * REVALIDACION DEL BINDING dentro de TX #1, con metadata PUBLICA unicamente.
   *
   * Entre la resolucion del signer y este punto pudo haber una rotacion. No
   * alcanza con comparar el id del perfil: se exige que TODA la metadata de
   * uso actual con la que se resolvio siga vigente -- proposito, estado,
   * verificacion de direccion, direccion persistida y version de clave.
   *
   * Sin SSM, sin leer la clave privada y sin llamar al resolver adentro de la
   * transaccion.
   *
   * Si algo cambio, se aborta TX #1: no se persiste un intent que ya estaba
   * obsoleto al momento de commitear.
   */
  async revalidateAnchorBinding(
    transaction: Prisma.TransactionClient,
    input: { issuerId: string; signer: AnchorSignerSnapshot }
  ): Promise<void> {
    const identity = await transaction.issuerTechnicalIdentity.findUnique({
      where: { issuerId: input.issuerId },
      select: {
        anchorSignerProfileId: true,
        anchorSignerProfile: {
          select: {
            id: true,
            purpose: true,
            status: true,
            addressVerifiedAt: true,
            address: true,
            keyVersion: true
          }
        }
      }
    });

    const profile = identity?.anchorSignerProfile;

    if (
      !identity ||
      !profile ||
      identity.anchorSignerProfileId !== input.signer.profileId ||
      profile.id !== input.signer.profileId ||
      profile.purpose !== SignerProfilePurpose.anchor ||
      profile.status !== SignerProfileStatus.active ||
      profile.addressVerifiedAt === null ||
      profile.keyVersion !== input.signer.keyVersion ||
      !addressEquals(profile.address, input.signer.address)
    ) {
      throw new BlockchainRegistrationError('ANCHOR_BINDING_CHANGED');
    }
  }

  /**
   * Deriva `anchorRegistrantScope` como SNAPSHOT del momento del intent.
   *
   * La cardinalidad se cuenta DENTRO de TX #1 -- que corre en `Serializable`,
   * asi que ve el mismo snapshot que la revalidacion del binding. Contarla
   * fuera de la transaccion, o despues del commit, daria un valor que no
   * corresponde a la procedencia historica que este campo describe.
   *
   * S8c1 congelo el significado: es un snapshot del momento de registracion y
   * NO se recalcula despues, porque los bindings pueden cambiar y eso
   * reescribiria el pasado.
   */
  async deriveAnchorRegistrantScope(
    transaction: Prisma.TransactionClient,
    profileId: string
  ): Promise<AnchorRegistrantScope> {
    const bindings = await transaction.issuerTechnicalIdentity.count({
      where: { anchorSignerProfileId: profileId }
    });

    if (bindings < 1) {
      // El binding se acaba de revalidar, asi que esto no deberia pasar. Si
      // pasa, no se adivina el enum.
      throw new BlockchainRegistrationError('ANCHOR_SCOPE_UNDERIVABLE');
    }

    return bindings === 1
      ? AnchorRegistrantScope.issuer_exclusive
      : AnchorRegistrantScope.shared_custodial;
  }

  /**
   * Crea el intent PENDING durable. Se llama DENTRO de TX #1.
   *
   * Persiste SOLO lo que ya se sabe de la intencion y de la configuracion. Los
   * tres hechos de la cadena -- `txHash`, `issuerAddress` (registrante
   * observado) y `registeredAt` (fecha del bloque) -- quedan en NULL: null
   * significa "todavia no observado", y no hay placeholder posible que sea
   * honesto.
   */
  async createPendingIntent(
    transaction: Prisma.TransactionClient,
    input: {
      credentialId: string;
      credentialHash: string;
      canonicalizationVersion: string;
      target: CredentialRegistryTarget;
      anchor: AnchorIntentSnapshot;
    }
  ) {
    return transaction.blockchainRecord.create({
      data: {
        credentialId: input.credentialId,
        credentialHash: input.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: input.canonicalizationVersion,
        network: input.target.network,
        chainId: input.target.chainId,
        contractAddress: input.target.contractAddress,
        deploymentId: input.target.deploymentId,
        evidenceMode: BlockchainEvidenceMode.credential_registry,
        status: BlockchainRecordStatus.pending,
        anchorSignerProfileId: input.anchor.anchorSignerProfileId,
        anchorRegistrantScope: input.anchor.anchorRegistrantScope
      }
    });
  }

  /**
   * Ejecuta la escritura en la cadena y finaliza. Se llama DESPUES del commit
   * de TX #1, SIN ninguna transaccion abierta.
   *
   * Cualquier fallo se propaga al llamador, que ya sabe que la credencial esta
   * emitida y que el intent sigue pendiente. Esta funcion NO intenta deshacer
   * nada: no revierte la credencial, no borra el intent y no reenvia.
   */
  async executeRegistration(input: {
    recordId: string;
    credentialHash: string;
    target: CredentialRegistryTarget;
    signer: AnchorSignerSnapshot;
  }): Promise<AnchorRegistrationEvidence> {
    // COMPROMISO POSTERIOR A TX #1: en la ventana entre el commit y el envio el
    // perfil pudo marcarse comprometido. No se transmite una registracion
    // nueva con una clave comprometida, y tampoco se cambia el intent al ancla
    // actual ni se resuelve un reemplazo automatico: queda pendiente para una
    // politica explicita de recuperacion.
    //
    // Esta primera lectura es solo un FALLO RAPIDO: evita encolarse detras de
    // un minado de 90 s para despues rechazar. NO es la verificacion
    // autorizante -- esa corre DENTRO del carril, abajo.
    await this.assertAnchorIntentStillUsable(input.signer);

    const evidence = await this.coordinator.registerCredentialHash({
      target: input.target,
      signer: input.signer,
      credentialHash: input.credentialHash,
      // COMPUERTA AUTORIZANTE: el coordinador la invoca despues de adquirir el
      // carril del ancla y antes del preflight. Mientras este intento espera
      // el carril de otro Issuer que comparte el perfil, el perfil puede
      // marcarse comprometido; una verificacion hecha antes de esperar no lo
      // detectaria y la clave se usaria igual.
      assertSignerUsable: () => this.assertAnchorIntentStillUsable(input.signer)
    });

    await this.finalizeRegistration({
      recordId: input.recordId,
      credentialHash: input.credentialHash,
      target: input.target,
      anchorSignerProfileId: input.signer.profileId,
      evidence
    });

    return evidence;
  }

  /**
   * Valida que el perfil de anclaje HISTORICO del intent siga siendo usable.
   *
   * Es validacion del intent ya commiteado, NO una seleccion nueva de signer:
   * se lee por el `anchorSignerProfileId` congelado y NO se vuelve a resolver
   * el binding vigente del Issuer, no se reescribe el perfil del registro, no
   * se llama al resolver, no se lee SSM y no se cambia de ancla. La Wallet ya
   * esta en memoria desde antes de TX #1.
   *
   * Metadata PUBLICA unicamente, y sin transaccion: esta lectura ocurre fuera
   * de TX #1 y de TX #2.
   *
   * Politica de estados congelada en S8c6 (addendum C):
   *
   *   active      -> permitido;
   *   retired     -> permitido para un intent YA creado, porque `retired`
   *                  significa "no se elige para intents NUEVOS", no "la clave
   *                  no es segura";
   *   compromised -> PROHIBIDO: no se transmite, el registro queda PENDING.
   */
  private async assertAnchorIntentStillUsable(
    signer: AnchorSignerSnapshot
  ): Promise<void> {
    const profile = await this.prisma.signerProfile.findUnique({
      where: { id: signer.profileId },
      select: { purpose: true, status: true, address: true }
    });

    if (
      !profile ||
      profile.purpose !== SignerProfilePurpose.anchor ||
      profile.status === SignerProfileStatus.compromised ||
      !addressEquals(profile.address, signer.address)
    ) {
      throw new BlockchainRegistrationError('ANCHOR_PROFILE_COMPROMISED');
    }
  }

  /**
   * TX #2 -- FINALIZACION. Corta y sin red: todas las lecturas de cadena
   * terminaron antes de entrar.
   *
   * El `where` es un predicado optimista estrecho: id, estado pendiente, hash
   * congelado, identidad del deployment congelada y perfil de ancla congelado.
   * Si la fila cambio, no hay nada que actualizar y se decide por relectura en
   * vez de sobrescribir a ciegas.
   */
  async finalizeRegistration(input: {
    recordId: string;
    credentialHash: string;
    target: CredentialRegistryTarget;
    anchorSignerProfileId: string;
    evidence: AnchorRegistrationEvidence;
  }): Promise<void> {
    const updated = await this.prisma.blockchainRecord.updateMany({
      where: {
        id: input.recordId,
        status: BlockchainRecordStatus.pending,
        credentialHash: input.credentialHash,
        network: input.target.network,
        chainId: input.target.chainId,
        contractAddress: input.target.contractAddress,
        deploymentId: input.target.deploymentId,
        anchorSignerProfileId: input.anchorSignerProfileId
      },
      data: {
        status: BlockchainRecordStatus.registered,
        txHash: input.evidence.txHash,
        blockNumber: input.evidence.blockNumber,
        // Registrante OBSERVADO, no el esperado.
        issuerAddress: input.evidence.registrant,
        // Fecha de la CADENA.
        registeredAt: input.evidence.registeredAt
      }
    });

    if (updated.count === 1) {
      return;
    }

    // Cero filas afectadas: se relee para distinguir idempotencia de conflicto.
    await this.assertFinalizationIdempotent(input);
  }

  /**
   * Decide si un `count = 0` fue una finalizacion ya hecha con la MISMA
   * evidencia (idempotente, exito) o un conflicto (falla cerrado).
   *
   * Nunca se sobrescribe procedencia historica.
   */
  private async assertFinalizationIdempotent(input: {
    recordId: string;
    credentialHash: string;
    target: CredentialRegistryTarget;
    anchorSignerProfileId: string;
    evidence: AnchorRegistrationEvidence;
  }): Promise<void> {
    const current = await this.prisma.blockchainRecord.findUnique({
      where: { id: input.recordId },
      select: {
        status: true,
        credentialHash: true,
        network: true,
        chainId: true,
        contractAddress: true,
        deploymentId: true,
        anchorSignerProfileId: true,
        txHash: true,
        blockNumber: true,
        issuerAddress: true,
        registeredAt: true
      }
    });

    if (!current) {
      throw new BlockchainRegistrationError('FINALIZATION_CONFLICT');
    }

    const sameIntent =
      current.credentialHash === input.credentialHash &&
      current.network === input.target.network &&
      current.chainId === input.target.chainId &&
      current.contractAddress === input.target.contractAddress &&
      current.deploymentId === input.target.deploymentId &&
      current.anchorSignerProfileId === input.anchorSignerProfileId;

    const sameEvidence =
      current.txHash === input.evidence.txHash &&
      current.blockNumber === input.evidence.blockNumber &&
      addressEquals(current.issuerAddress, input.evidence.registrant) &&
      current.registeredAt instanceof Date &&
      current.registeredAt.getTime() === input.evidence.registeredAt.getTime();

    if (
      current.status === BlockchainRecordStatus.registered &&
      sameIntent &&
      sameEvidence
    ) {
      // Ya finalizada con exactamente esta evidencia: exito idempotente.
      return;
    }

    throw new BlockchainRegistrationError('FINALIZATION_CONFLICT');
  }
}

function addressEquals(left: string | null, right: string): boolean {
  if (typeof left !== 'string' || left.length === 0) {
    return false;
  }

  return left.toLowerCase() === right.toLowerCase();
}
