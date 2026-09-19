import { createHash, randomBytes } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { CredentialStatus, SharingGrantScope } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { mapHolderCurrentProfileResponse } from '../profiles/holder-current-profile.mapper';
import {
  shareEffectiveStatus,
  supportsContextualVerification,
  type ShareEffectiveStatus
} from './share-lifecycle';

export interface CreateProfileShareResponseDto {
  sharePath: string;
  expiresAt: string | null;
}

export interface PublicProfileShareResponseDto {
  holder: { displayLabel: string | null };
  profile: {
    narrative: string | null;
    areas: Array<{ label: string; estimatedHours: number | null }>;
    skills: Array<{ label: string; confidence: number | null }>;
    concepts: string[];
    totalOfficialHours: number | null;
    credentialsCount: number;
  };
  credentials: Array<{
    credentialReference: string;
    title: string;
    type: 'academic_subject' | 'course' | 'certification' | 'degree';
    typeLabel: string;
    issuerName: string;
    issuedAt: string | null;
  }>;
  /**
   * UNICO dato nuevo del contrato publico. Es un booleano y nada mas: nunca los
   * ids autorizados, nunca `policyVersion`, nunca el id de la politica.
   *
   * Que sea `true` NO significa que exista todavia un endpoint publico de
   * analisis -- en esta version no existe. Significa que el holder dio su
   * permiso y que el enlace sigue valiendo.
   */
  contextualVerificationEnabled: boolean;
}

export interface HolderProfileShareListItemDto {
  shareId: string;
  scope: SharingGrantScope;
  status: ShareEffectiveStatus;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  contextualVerificationEnabled: boolean;
  /** Lo que el holder eligio. */
  authorizedCredentialCount: number;
  /** Cuantas de esas siguen `issued` hoy. Menor que la anterior = alguna se revoco. */
  effectiveAuthorizedCredentialCount: number;
}

@Injectable()
export class ProfileSharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formativeProfiles: FormativeProfileService
  ) {}

  async createForUser(userId: string): Promise<CreateProfileShareResponseDto> {
    const current = await this.formativeProfiles.getCurrentForUser(userId);
    if (!current.currentProfile) {
      throw new NotFoundException('No hay un perfil disponible para compartir.');
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.sharingGrant.create({
      data: {
        userId,
        profileId: current.currentProfile.id,
        createdByUserId: userId,
        scope: SharingGrantScope.profile,
        tokenHash: hashToken(token)
      }
    });

    return { sharePath: `/share/profile/${token}`, expiresAt: null };
  }

  async getPublicProfile(token: string): Promise<PublicProfileShareResponseDto> {
    const normalizedToken = normalizeToken(token);
    const grant = await this.prisma.sharingGrant.findUnique({
      where: { tokenHash: hashToken(normalizedToken) },
      select: {
        scope: true,
        expiresAt: true,
        revokedAt: true,
        verificationPolicy: {
          select: {
            enabled: true,
            authorizedCredentials: { select: { credentialId: true } }
          }
        },
        user: {
          select: {
            displayName: true,
            firstName: true,
            lastName: true
          }
        },
        profile: {
          select: {
            id: true,
            userId: true,
            profileVersion: true,
            isCurrent: true,
            credentialsCount: true,
            totalHours: true,
            areasSummary: true,
            skillsSummary: true,
            qualityFlags: true,
            generatedAt: true,
            profileJson: true
          }
        },
        userId: true
      }
    });

    if (
      !grant ||
      !grant.profile ||
      grant.profile.userId !== grant.userId ||
      (grant.scope !== SharingGrantScope.profile &&
        grant.scope !== SharingGrantScope.credential_and_profile) ||
      grant.revokedAt ||
      (grant.expiresAt && grant.expiresAt <= new Date())
    ) {
      throw publicNotFound();
    }

    const mapped = mapHolderCurrentProfileResponse({
      userId: grant.userId,
      currentProfile: {
        ...grant.profile,
        profileVersion: grant.profile.profileVersion ?? 'formative_profile_v1',
        totalHours:
          grant.profile.totalHours === null
            ? null
            : Number(grant.profile.totalHours),
        generatedAt: grant.profile.generatedAt.toISOString()
      }
    }).currentProfile;
    if (!mapped) {
      throw publicNotFound();
    }

    const credentials = await this.prisma.credential.findMany({
      where: {
        subjectUserId: grant.userId,
        status: CredentialStatus.issued
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
      take: 10,
      select: {
        id: true,
        title: true,
        type: true,
        issuedAt: true,
        issuer: { select: { name: true } }
      }
    });

    return {
      holder: { displayLabel: displayLabel(grant.user) },
      // C5b.2: remapeo explicito campo-por-campo, nunca spread/slice del
      // objeto holder. El holder mapper puede agregar campos nuevos
      // (provenanceSummary, ids internos, lo que sea) sin que este remapeo
      // los propague de forma automatica/silenciosa al perfil publico --
      // cada campo publico se elige a mano.
      profile: {
        narrative: mapped.narrative,
        areas: mapped.areas.slice(0, 6).map(({ label, estimatedHours }) => ({
          label,
          estimatedHours
        })),
        skills: mapped.skills.slice(0, 12).map(({ label, confidence }) => ({
          label,
          confidence
        })),
        concepts: mapped.concepts.slice(0, 20),
        totalOfficialHours: mapped.totalOfficialHours,
        credentialsCount: mapped.credentialsCount
      },
      credentials: credentials.map((credential) => ({
        credentialReference: credential.id,
        title: credential.title,
        type: credential.type,
        typeLabel: credentialTypeLabel(credential.type),
        issuerName: credential.issuer.name,
        issuedAt: credential.issuedAt?.toISOString() ?? null
      })),
      contextualVerificationEnabled: await this.contextualVerificationAvailable(
        grant.userId,
        grant.scope,
        grant.verificationPolicy
      )
    };
  }

  /**
   * El permiso EFECTIVO de computo. Llegar aca ya implica que el grant esta
   * activo: el guard de mas arriba tira 404 para revocado o vencido, asi que
   * este metodo solo decide sobre la politica y su evidencia.
   *
   * NO depende de que F3 este listo. Que exista extraccion, analisis semantico o
   * evidence units es estado transitorio; mezclarlo aca haria que el CTA
   * parpadeara segun el pipeline. Si al crear un run no hubiera evidencia
   * utilizable, eso se resuelve ahi con un resultado controlado -- no fingiendo
   * que el holder nunca dio permiso.
   */
  private async contextualVerificationAvailable(
    ownerUserId: string,
    scope: SharingGrantScope,
    policy: { enabled: boolean; authorizedCredentials: Array<{ credentialId: string }> } | null
  ): Promise<boolean> {
    // El lector publico NUNCA anuncia computo que el VerificationRun despues
    // rechazaria. Una politica habilitada sobre un alcance no soportado --estado
    // heredado o inconsistente-- no habilita nada.
    if (!supportsContextualVerification(scope)) return false;
    if (!policy || !policy.enabled) return false;
    const authorizedIds = policy.authorizedCredentials.map((row) => row.credentialId);
    if (authorizedIds.length === 0) return false;

    // Se cuenta contra la BASE, no contra las 10 tarjetas que muestra el perfil:
    // esa lista es una proyeccion de presentacion y el holder puede haber
    // autorizado una credencial que no aparece entre ellas.
    const stillIssued = await this.prisma.credential.count({
      where: {
        id: { in: authorizedIds },
        subjectUserId: ownerUserId,
        status: CredentialStatus.issued
      }
    });
    return stillIssued > 0;
  }

  /**
   * Los enlaces del holder. Hasta esta version no habia forma de ver cuantos
   * enlaces tenia abiertos: cada click en "Compartir perfil" creaba uno nuevo,
   * permanente e invisible.
   *
   * El token crudo NO esta aca y no puede estarlo: solo se guarda su SHA-256, y
   * se muestra una unica vez al crearlo. Eso es deliberado y no se debilita.
   */
  async listForUser(userId: string): Promise<HolderProfileShareListItemDto[]> {
    const grants = await this.prisma.sharingGrant.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        scope: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        verificationPolicy: {
          select: {
            enabled: true,
            authorizedCredentials: { select: { credentialId: true } }
          }
        }
      }
    });

    const authorizedIds = [
      ...new Set(
        grants.flatMap((grant) =>
          (grant.verificationPolicy?.authorizedCredentials ?? []).map((row) => row.credentialId)
        )
      )
    ];
    // Una sola consulta para todos los enlaces, no una por enlace.
    const issuedIds = new Set(
      authorizedIds.length === 0
        ? []
        : (
            await this.prisma.credential.findMany({
              where: {
                id: { in: authorizedIds },
                subjectUserId: userId,
                status: CredentialStatus.issued
              },
              select: { id: true }
            })
          ).map((row) => row.id)
    );

    const now = new Date();
    return grants.map((grant) => {
      const authorized = (grant.verificationPolicy?.authorizedCredentials ?? []).map(
        (row) => row.credentialId
      );
      const effective = authorized.filter((id) => issuedIds.has(id));
      const status = shareEffectiveStatus(grant, now);
      return {
        shareId: grant.id,
        scope: grant.scope,
        status,
        createdAt: grant.createdAt.toISOString(),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        revokedAt: grant.revokedAt?.toISOString() ?? null,
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
        // El permiso que ve el holder es el EFECTIVO, el mismo que resolveria el
        // lector publico: politica encendida, enlace vigente y al menos una
        // credencial autorizada todavia emitida.
        contextualVerificationEnabled:
          status === 'ACTIVE' &&
          supportsContextualVerification(grant.scope) &&
          (grant.verificationPolicy?.enabled ?? false) &&
          effective.length > 0,
        authorizedCredentialCount: authorized.length,
        effectiveAuthorizedCredentialCount: effective.length
      };
    });
  }

  /**
   * Revocacion, terminal e idempotente.
   *
   * `updateMany` con `revokedAt: null` en el WHERE es un compare-and-set: dos
   * pedidos simultaneos solo pueden escribir uno, y el segundo no pisa la marca
   * de tiempo del primero. Revocar algo ya revocado devuelve exito sin escribir.
   *
   * No hay borrado ni reactivacion: la fila queda como registro historico y un
   * token filtrado nunca vuelve a valer.
   */
  async revokeForUser(userId: string, shareId: string): Promise<{ status: ShareEffectiveStatus; revokedAt: string }> {
    const grant = await this.prisma.sharingGrant.findFirst({
      // El scope del holder va en el WHERE: un enlace ajeno responde igual que
      // uno inexistente y no confirma su existencia.
      where: { id: shareId, userId },
      select: { id: true, revokedAt: true }
    });
    if (!grant) throw new NotFoundException('No se encontro el enlace compartido solicitado.');

    if (grant.revokedAt) {
      return { status: 'REVOKED', revokedAt: grant.revokedAt.toISOString() };
    }

    const revokedAt = new Date();
    await this.prisma.sharingGrant.updateMany({
      where: { id: grant.id, userId, revokedAt: null },
      data: { revokedAt }
    });

    // Se relee en lugar de asumir: si otro pedido gano la carrera, la marca
    // autoritativa es la suya.
    const persisted = await this.prisma.sharingGrant.findFirst({
      where: { id: grant.id, userId },
      select: { revokedAt: true }
    });
    return {
      status: 'REVOKED',
      revokedAt: (persisted?.revokedAt ?? revokedAt).toISOString()
    };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(value)) {
    throw publicNotFound();
  }
  return value;
}

function publicNotFound(): NotFoundException {
  return new NotFoundException('No encontramos un perfil compartido disponible.');
}

function displayLabel(user: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string | null {
  if (user.displayName?.trim()) return user.displayName.trim();
  const names = [user.firstName, user.lastName].filter(
    (value): value is string => Boolean(value?.trim())
  );
  return names.length > 0 ? names.join(' ') : null;
}

function credentialTypeLabel(type: PublicProfileShareResponseDto['credentials'][number]['type']) {
  return {
    academic_subject: 'Asignatura académica',
    course: 'Curso',
    certification: 'Certificación',
    degree: 'Título académico'
  }[type];
}
