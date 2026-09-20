import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { CredentialStatus, SharingGrantScope } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FormativeProfileService } from '../profiles/formative-profile.service';
import { mapHolderCurrentProfileResponse } from '../profiles/holder-current-profile.mapper';
import {
  shareEffectiveStatus,
  supportsContextualVerification,
  type ShareEffectiveStatus
} from './share-lifecycle';
import {
  ShareTokenRecoveryError,
  buildSharePath,
  buildShareUrl,
  openShareToken,
  sealShareToken
} from './share-token-recovery';

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

/**
 * Lo unico que devuelve la recuperacion del DUENO. No lleva el sobre cifrado, no
 * lleva el hash y no se guarda en ningun lado: se arma en el momento.
 */
export interface HolderShareLinkDto {
  /** URL absoluta cuando hay origen publico configurado; si no, `null`. */
  shareUrl: string | null;
  /** Siempre utilizable desde la propia web. */
  sharePath: string;
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

/** Un enlace ajeno responde igual que uno inexistente. */
const SHARE_NOT_FOUND_MESSAGE = 'No se encontro el enlace compartido solicitado.';
const SHARE_LINK_UNRECOVERABLE_MESSAGE =
  'No pudimos recuperar este enlace. Crea uno nuevo para volver a compartirlo.';
const SHARE_CREATION_UNAVAILABLE_MESSAGE =
  'No podemos crear enlaces compartidos en este momento. Intenta mas tarde.';

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
    // El id se genera ACA, antes de insertar, porque entra en la AAD del sobre:
    // ata el material de recuperacion a esta fila y a este dueno.
    const sharingGrantId = randomUUID();

    // INVARIANTE DEL PRODUCTO: todo enlace nuevo nace recuperable.
    //
    // El sellado ocurre ANTES del INSERT, a proposito. Si la clave falta o no
    // sirve, no se persiste nada: no existe un camino que deje `tokenHash` sin
    // `tokenRecovery`. Crear un enlace que su dueno no va a poder volver a
    // copiar es exactamente el defecto que esta version elimina.
    const tokenRecovery = this.sealRecoveryMaterial(token, { sharingGrantId, userId });

    await this.prisma.sharingGrant.create({
      data: {
        id: sharingGrantId,
        userId,
        profileId: current.currentProfile.id,
        createdByUserId: userId,
        scope: SharingGrantScope.profile,
        // Autoridad PUBLICA: lo unico contra lo que se resuelve un token.
        tokenHash: hashToken(token),
        // Autoridad de GESTION del dueno. Nunca sale por el listado ni por nada
        // publico. Si el despliegue no tiene clave configurada, el enlace se
        // crea igual pero no va a poder recuperarse: no se guarda nada debil.
        tokenRecovery
      }
    });

    return { sharePath: buildSharePath(token), expiresAt: null };
  }

  /**
   * El enlace utilizable de UN grant propio.
   *
   * Operacion EXPLICITA y por enlace: el listado no descifra nada. Un enlace
   * ajeno o inexistente responde igual —404— y no confirma que exista.
   */
  async recoverLinkForUser(userId: string, shareId: string): Promise<HolderShareLinkDto> {
    const grant = await this.prisma.sharingGrant.findFirst({
      // El dueno va en el WHERE, como en revoke: sin filtrado posterior.
      where: { id: shareId, userId },
      select: { id: true, tokenRecovery: true, revokedAt: true }
    });
    if (!grant) throw new NotFoundException(SHARE_NOT_FOUND_MESSAGE);

    if (grant.revokedAt !== null) {
      // Un enlace revocado no vuelve a entregarse: ya no abre nada.
      throw new NotFoundException(SHARE_NOT_FOUND_MESSAGE);
    }
    if (!grant.tokenRecovery) {
      throw new ConflictException(SHARE_LINK_UNRECOVERABLE_MESSAGE);
    }

    let token: string;
    try {
      token = openShareToken(grant.tokenRecovery, { sharingGrantId: grant.id, userId });
    } catch (error: unknown) {
      // FALLA CERRADO. No se devuelve el hash, no se inventa una URL y NO se
      // revoca nada: un problema de clave o de formato afecta la gestion del
      // dueno, no el acceso publico, que sigue resolviendose por `tokenHash`.
      if (error instanceof ShareTokenRecoveryError) {
        throw new ConflictException(SHARE_LINK_UNRECOVERABLE_MESSAGE);
      }
      throw error;
    }

    // La URL se arma con el origen configurado HOY: cambiar de dominio no
    // invalida nada persistido.
    return {
      shareUrl: buildShareUrl(token, process.env.WEB_ORIGIN),
      sharePath: buildSharePath(token)
    };
  }

  /**
   * Sella el material de recuperacion o FALLA.
   *
   * Un problema de configuracion no degrada el producto a enlaces irrecuperables:
   * se responde 503 y el holder no se queda con un enlace inservible en la lista.
   * El error no lleva el nombre de la variable ni nada de la clave.
   */
  private sealRecoveryMaterial(
    token: string,
    context: { sharingGrantId: string; userId: string }
  ): string {
    try {
      return sealShareToken(token, context);
    } catch (error: unknown) {
      if (error instanceof ShareTokenRecoveryError) {
        throw new ServiceUnavailableException(SHARE_CREATION_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }
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
  /**
   * Los enlaces del holder, bajo el contrato NUEVO.
   *
   * El filtro `tokenRecovery: { not: null }` es parte de la CONSULTA, no de la
   * presentacion: una fila heredada —sin material de recuperacion— es dato de
   * desarrollo desechable y no se trae para despues esconderla. No existe una
   * modalidad "enlace viejo" en el producto.
   *
   * No cambia nada publico: mientras esas filas existan, su URL sigue
   * resolviendo por `tokenHash` hasta que se revoquen o se limpien.
   */
  async listForUser(userId: string): Promise<HolderProfileShareListItemDto[]> {
    const grants = await this.prisma.sharingGrant.findMany({
      where: { userId, tokenRecovery: { not: null } },
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
