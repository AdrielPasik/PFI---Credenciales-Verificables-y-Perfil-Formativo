/**
 * Resolucion de la autoridad de un enlace para verificacion contextual.
 *
 * Una sola definicion, usada al crear una solicitud y al congelar un run, para
 * que "este enlace autoriza computo" signifique lo mismo en los dos puntos.
 */

import { CredentialStatus, Prisma } from '@prisma/client';

import { isShareActive, supportsContextualVerification } from '../profile-sharing/share-lifecycle';
import { hashOpaqueToken, normalizeOpaqueToken } from './opaque-token';
import { PublicVerificationError } from './public-verification.errors';

export const SHARE_AUTHORITY_SELECT = {
  id: true,
  userId: true,
  scope: true,
  expiresAt: true,
  revokedAt: true,
  verificationPolicy: {
    select: {
      enabled: true,
      policyVersion: true,
      authorizedCredentials: { select: { credentialId: true } }
    }
  }
} satisfies Prisma.SharingGrantSelect;

export type ShareAuthorityRow = Prisma.SharingGrantGetPayload<{
  select: typeof SHARE_AUTHORITY_SELECT;
}>;

export interface ContextualShareAuthority {
  readonly sharingGrantId: string;
  readonly holderUserId: string;
  readonly policyVersion: number;
  /** Ordenados: el conjunto no tiene orden, y compararlo tiene que ser estable. */
  readonly authorizedCredentialIds: readonly string[];
}

type Reader = Pick<Prisma.TransactionClient, 'sharingGrant'>;
type EvidenceReader = Pick<Prisma.TransactionClient, 'credential'>;

export async function loadShareAuthorityByToken(
  reader: Reader,
  rawShareToken: unknown
): Promise<ShareAuthorityRow> {
  const token = normalizeOpaqueToken(rawShareToken);
  if (token === null) throw new PublicVerificationError('SHARE_NOT_AVAILABLE');

  const grant = await reader.sharingGrant.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: SHARE_AUTHORITY_SELECT
  });
  if (!grant) throw new PublicVerificationError('SHARE_NOT_AVAILABLE');
  return grant;
}

/**
 * Permiso de computo del enlace, evaluado sobre UNA fila leida.
 *
 * El grant es la autoridad de orden superior: revocado, vencido o de alcance no
 * soportado, la politica ni se mira.
 */
export function assertContextualShareAuthority(
  grant: ShareAuthorityRow | null,
  now: Date = new Date()
): ContextualShareAuthority {
  if (
    !grant ||
    !supportsContextualVerification(grant.scope) ||
    !isShareActive(grant, now)
  ) {
    throw new PublicVerificationError('SHARE_NOT_AVAILABLE');
  }

  const policy = grant.verificationPolicy;
  if (!policy || !policy.enabled) {
    throw new PublicVerificationError('CONTEXTUAL_VERIFICATION_NOT_AVAILABLE');
  }

  return {
    sharingGrantId: grant.id,
    holderUserId: grant.userId,
    policyVersion: policy.policyVersion,
    authorizedCredentialIds: policy.authorizedCredentials
      .map((row) => row.credentialId)
      .sort()
  };
}

export function sameAuthorizedSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const reference = new Set(left);
  return right.every((value) => reference.has(value));
}

/**
 * El enlace sigue siendo una autoridad publica, SIN mirar la politica.
 *
 * Es la condicion de LECTURA: una sesion propia, o un run ya congelado. Revocado,
 * vencido o de alcance no soportado corta todo. La politica, en cambio, solo
 * gobierna trabajo NUEVO: deshabilitarla no vuelve inexistente lo que ya existe.
 */
export function assertShareValid(grant: ShareAuthorityRow | null, now: Date = new Date()): ShareAuthorityRow {
  if (
    !grant ||
    !supportsContextualVerification(grant.scope) ||
    !isShareActive(grant, now)
  ) {
    throw new PublicVerificationError('SHARE_NOT_AVAILABLE');
  }
  return grant;
}

/**
 * Condicion para TRABAJO NUEVO: enlace valido + politica habilitada + al menos una
 * credencial autorizada todavia emitida.
 *
 * Es exactamente la misma regla que `contextualVerificationEnabled` en el perfil
 * publico: un tercero no puede abrir trabajo que el perfil no anuncia. No mira la
 * disponibilidad tecnica de F3 (extraccion, analisis): eso se resuelve al congelar.
 */
export async function assertComputeAllowed(
  evidence: EvidenceReader,
  grant: ShareAuthorityRow | null,
  now: Date = new Date()
): Promise<ContextualShareAuthority> {
  const authority = assertContextualShareAuthority(grant, now);
  if (authority.authorizedCredentialIds.length === 0) {
    throw new PublicVerificationError('CONTEXTUAL_VERIFICATION_NOT_AVAILABLE');
  }
  const stillIssued = await evidence.credential.count({
    where: {
      id: { in: [...authority.authorizedCredentialIds] },
      subjectUserId: authority.holderUserId,
      status: CredentialStatus.issued
    }
  });
  if (stillIssued === 0) {
    // Mismo codigo que una politica apagada: para el tercero es la misma
    // situacion, y distinguirla revelaria el estado de las credenciales.
    throw new PublicVerificationError('CONTEXTUAL_VERIFICATION_NOT_AVAILABLE');
  }
  return authority;
}
