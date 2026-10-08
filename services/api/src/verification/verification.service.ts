import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialStatus,
  CredentialType
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CredentialAuthenticityVerifier } from './credential-authenticity.verifier';
import { CredentialBlockchainEvidenceReader } from './credential-blockchain-evidence.reader';
import { type VerifyCredentialResponseDto } from './dto/verify-credential-response.dto';
import {
  type BlockchainEvidence,
  type CredentialAuthenticity,
  type CredentialAuthenticityReason,
  type VerificationHeadline,
  deriveCredentialStatus,
  deriveLegacyVerificationResult,
  deriveVerificationHeadline
} from './verification-outcome';

/**
 * Verificacion publica de credenciales -- reescrita en S8c7.
 *
 * ---------------------------------------------------------------------------
 * LO QUE CAMBIA
 * ---------------------------------------------------------------------------
 *
 * Antes esta ruta respondia "verificada" cuando existia una fila con un
 * `canonicalHash`. Nunca comprobaba una firma, nunca resolvia un DID y nunca
 * leia la cadena: era una consulta a PostgreSQL presentada como verificacion.
 *
 * Ahora orquesta tres dimensiones independientes y deriva UN titular:
 *
 *   autenticidad  -> CredentialAuthenticityVerifier       (canon_v2 + DID)
 *   evidencia     -> CredentialBlockchainEvidenceReader   (lectura de cadena)
 *   estado        -> deriveCredentialStatus               (local + monotonia)
 *   titular       -> deriveVerificationHeadline           (funcion pura)
 *
 * ---------------------------------------------------------------------------
 * SOLO LECTURA
 * ---------------------------------------------------------------------------
 *
 * Toda la ruta es observacion: ni `create`, ni `update`, ni `delete`, ni
 * `upsert`, ni finalizacion de un intent pendiente, ni adopcion de huerfanos,
 * ni llamada a la reconciliacion que escribe. Un test con un doble de Prisma
 * cuyos metodos de mutacion lanzan congela esa propiedad.
 */

/**
 * SELECT angosto. Pide lo que la verificacion necesita y nada mas: sin
 * `secretRef`, sin custodia, sin membership, sin PlatformAdmin, sin analisis
 * de IA, sin documentos y sin otras credenciales.
 */
const publicVerificationCredentialSelect = {
  id: true,
  status: true,
  schemaVersion: true,
  type: true,
  title: true,
  description: true,
  hours: true,
  credentialSubject: true,
  issuedAt: true,
  revokedAt: true,
  revocationReason: true,
  canonicalHash: true,
  canonicalizationVersion: true,
  proof: true,
  issuerId: true,
  issuer: {
    select: {
      name: true,
      did: true,
      technicalIdentity: {
        select: {
          did: true
        }
      }
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
  /**
   * TODAS las filas de evidencia, sin `orderBy` y sin `take`.
   *
   * Deliberado: la multiplicidad es parte de la respuesta. El dominio crea
   * exactamente una fila por credencial, asi que mas de una es una anomalia de
   * integridad y no una serie temporal. Ordenar y quedarse con la primera
   * elegiria una fila arbitraria -- la tabla no tiene `createdAt`, una fila
   * `pending` tiene `registeredAt` NULL, y el orden de UUID no es cronologia.
   */
  blockchainRecords: {
    select: {
      network: true,
      chainId: true,
      contractAddress: true,
      credentialHash: true,
      txHash: true,
      status: true,
      registeredAt: true,
      issuerAddress: true,
      anchorSignerProfileId: true,
      anchorSignerProfile: {
        select: {
          // Direccion PUBLICA persistida. Nunca `secretRef`, nunca la clave.
          address: true
        }
      }
    }
  }
} as const;

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authenticityVerifier: CredentialAuthenticityVerifier,
    private readonly blockchainEvidenceReader: CredentialBlockchainEvidenceReader
  ) {}

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

    const issuerTechnicalDid = credential.issuer.technicalIdentity?.did ?? null;

    // DIMENSION 1: autenticidad. No conoce la cadena.
    const authenticity = await this.authenticityVerifier.verify({
      credentialId: credential.id,
      schemaVersion: credential.schemaVersion,
      canonicalizationVersion: credential.canonicalizationVersion,
      canonicalHash: credential.canonicalHash,
      proof: credential.proof,
      type: credential.type,
      title: credential.title,
      description: credential.description,
      issuedAt: credential.issuedAt,
      hours: credential.hours,
      credentialSubject: credential.credentialSubject,
      issuerId: credential.issuerId,
      issuerTechnicalDid,
      subjectDid: credential.subjectUser.did
    });

    // DIMENSION 2: evidencia de cadena. No mira el proof.
    const evidence = await this.blockchainEvidenceReader.read({
      credentialCanonicalHash: credential.canonicalHash,
      records: credential.blockchainRecords.map((record) => ({
        network: record.network,
        chainId: record.chainId,
        contractAddress: record.contractAddress,
        credentialHash: record.credentialHash,
        status: record.status,
        issuerAddress: record.issuerAddress,
        anchorSignerProfileId: record.anchorSignerProfileId,
        anchorSignerAddress: record.anchorSignerProfile?.address ?? null
      }))
    });

    // DIMENSION 3: estado, con revocacion monotonica.
    const credentialStatus = deriveCredentialStatus({
      persistedStatus: credential.status,
      blockchainEvidence: evidence.blockchainEvidence
    });

    // TITULAR: una sola funcion pura, sin ifs repartidos.
    const headline = deriveVerificationHeadline({
      authenticity: authenticity.authenticity,
      status: credentialStatus,
      blockchainEvidence: evidence.blockchainEvidence
    });

    // Con mas de una fila ninguna puede presentarse como "la ultima".
    const singleBlockchainRecord =
      credential.blockchainRecords.length === 1
        ? credential.blockchainRecords[0]
        : null;

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
        did: this.optionalText(credential.issuer.did),
        technicalDid: this.optionalText(issuerTechnicalDid)
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
        latestBlockchainRecord: singleBlockchainRecord
          ? {
              network: singleBlockchainRecord.network,
              networkLabel: this.networkLabel(singleBlockchainRecord.network),
              chainId: singleBlockchainRecord.chainId,
              txHash: singleBlockchainRecord.txHash,
              txHashShort: this.abbreviateReference(singleBlockchainRecord.txHash),
              status: singleBlockchainRecord.status,
              statusLabel: this.blockchainRecordStatusLabel(
                singleBlockchainRecord.status
              ),
              registeredAt: this.serializeDateTime(
                singleBlockchainRecord.registeredAt
              )
            }
          : null
      },
      verification: {
        // PROYECCION de compatibilidad. Unico origen: el titular.
        result: deriveLegacyVerificationResult(headline),
        summary: this.buildSummary({
          headline,
          authenticity: authenticity.authenticity,
          authenticityReason: authenticity.reason,
          blockchainEvidence: evidence.blockchainEvidence
        }),
        checkedAt: new Date().toISOString(),
        headline,
        authenticity: {
          result: authenticity.authenticity,
          reason: authenticity.reason
        },
        credentialStatus,
        blockchainEvidence: {
          result: evidence.blockchainEvidence,
          reason: evidence.reason
        }
      }
    };
  }

  /**
   * Texto para humanos derivado de las dimensiones YA decididas.
   *
   * No vuelve a decidir nada: no mira `Credential.status`, ni el
   * `canonicalHash`, ni el estado de la fila de evidencia. Si lo hiciera habria
   * una segunda decision de validez escondida en el texto.
   */
  private buildSummary(input: {
    headline: VerificationHeadline;
    authenticity: CredentialAuthenticity;
    authenticityReason: CredentialAuthenticityReason;
    blockchainEvidence: BlockchainEvidence;
  }): string {
    if (input.headline === 'INVALID') {
      return 'La prueba criptográfica de esta credencial no se corresponde con su contenido, así que Scope no puede presentarla como auténtica.';
    }

    if (input.headline === 'REVOKED') {
      return 'La credencial fue revocada. La evidencia histórica se conserva para consulta.';
    }

    if (input.headline === 'INDETERMINATE') {
      // Una credencial de formato anterior NO es una credencial dañada, y el
      // texto no debe sugerirlo: su emisor simplemente nunca la firmo.
      if (input.authenticityReason === 'LEGACY_UNSIGNED_CREDENTIAL') {
        return 'Esta credencial fue emitida con una versión anterior de Scope y no incluye una prueba criptográfica de autoría. Su información se conserva tal como fue registrada.';
      }

      if (input.authenticityReason === 'UNSUPPORTED_CREDENTIAL_VERSION') {
        return 'Esta credencial usa un formato que esta versión de la verificación pública todavía no sabe interpretar.';
      }

      if (input.authenticity === 'INDETERMINATE') {
        return 'No se pudo comprobar la autoría de la credencial en este momento porque la identidad pública del emisor no está disponible. Volvé a intentarlo más tarde.';
      }

      // Autenticidad verificada, pero la evidencia de la cadena contradice la
      // procedencia del anclaje. Es evidencia en conflicto, no una ausencia.
      return 'La autoría de la credencial se verificó, pero la evidencia registrada en la red no coincide con la cuenta que debía registrarla.';
    }

    if (input.headline === 'VERIFIED') {
      return 'La autoría de la credencial se verificó criptográficamente y su registro está confirmado en la red.';
    }

    // VERIFIED_WITH_LIMITED_EVIDENCE: la firma vale igual; lo que falta es la
    // atestacion externa, y se nombra sin disfrazarla de exito.
    return {
      PENDING:
        'La autoría de la credencial se verificó criptográficamente. Su registro en la red todavía está pendiente de confirmación.',
      NOT_FOUND:
        'La autoría de la credencial se verificó criptográficamente, pero no se encontró su registro en la red.',
      UNAVAILABLE:
        'La autoría de la credencial se verificó criptográficamente. La evidencia de registro en la red no se pudo consultar en este momento.',
      NOT_APPLICABLE_MOCK:
        'La autoría de la credencial se verificó criptográficamente. Esta credencial no tiene registro en una red pública de blockchain.',
      REGISTERED: '',
      REVOKED_ON_CHAIN: '',
      REGISTRANT_UNEXPECTED: ''
    }[input.blockchainEvidence];
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

  private blockchainRecordStatusLabel(status: BlockchainRecordStatus): string {
    if (status === BlockchainRecordStatus.revoked) {
      return 'Registro revocado';
    }

    // S8c6: una fila `pending` es un estado de primera clase, no un error.
    if (status === BlockchainRecordStatus.pending) {
      return 'Registro pendiente de confirmación';
    }

    return 'Registro técnico disponible';
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
