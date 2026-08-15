import { createHash, randomBytes } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import { CredentialStatus, SharingGrantScope } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { mapHolderCurrentProfileResponse } from '../profiles/holder-current-profile.mapper';

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
      }))
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
