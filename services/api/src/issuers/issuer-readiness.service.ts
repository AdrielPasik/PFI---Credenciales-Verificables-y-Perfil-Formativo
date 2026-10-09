import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CredentialType, Prisma } from '@prisma/client';

import { boundProfileSelect, type BoundAssertionProfile } from '../identity/issuer-did-document.resolver';
import { PrismaService } from '../prisma/prisma.service';
import {
  type IssuerReadinessResult,
  type IssuerReadinessSnapshot,
  type ReadinessSignerProfile,
  evaluateIssuerReadiness,
  resolveReadinessTarget
} from './issuer-readiness';

/**
 * Carga de la readiness -- S8c9.
 *
 * Una sola forma de consulta para uno o muchos issuers: el panel de admin evalua
 * todos los de la pagina con UNA consulta, no una por issuer. La semantica vive
 * en `evaluateIssuerReadiness`, que es pura; aca solo se carga el snapshot.
 *
 * Sin `IssuerSignerResolver`, sin almacen de secretos, sin provider y sin red.
 */

/** Metadata PUBLICA de un perfil vigente. Nunca `secretRef`. */
const currentProfileSelect = {
  id: true,
  purpose: true,
  status: true,
  keyVersion: true,
  address: true,
  addressVerifiedAt: true
} as const;

export const issuerReadinessSelect = {
  id: true,
  authorizationStatus: true,
  allowedCredentialTypes: true,
  technicalIdentity: {
    select: {
      status: true,
      did: true,
      assertionSignerProfileId: true,
      assertionSignerProfile: { select: currentProfileSelect },
      anchorSignerProfile: { select: currentProfileSelect }
    }
  },
  assertionKeyBindings: {
    select: { signerProfile: { select: boundProfileSelect } }
  }
} as const;

type IssuerReadinessRow = Prisma.IssuerGetPayload<{
  select: typeof issuerReadinessSelect;
}>;

export type IssuerReadinessErrorCode =
  | 'ISSUER_NOT_FOUND'
  | 'ISSUER_NOT_READY'
  | 'CREDENTIAL_TYPE_NOT_ENABLED';

const SAFE_MESSAGES: Record<IssuerReadinessErrorCode, string> = {
  ISSUER_NOT_FOUND: 'No se encontro el emisor solicitado.',
  ISSUER_NOT_READY: 'El emisor no esta listo para emitir credenciales.',
  // Neutral: ya no menciona "academicas" ni ningun DID. Los cuatro tipos
  // siguen la misma politica.
  CREDENTIAL_TYPE_NOT_ENABLED:
    'Este emisor no tiene habilitado este tipo de credencial.'
};

const STATUS_BY_CODE: Record<IssuerReadinessErrorCode, HttpStatus> = {
  ISSUER_NOT_FOUND: HttpStatus.NOT_FOUND,
  ISSUER_NOT_READY: HttpStatus.BAD_REQUEST,
  CREDENTIAL_TYPE_NOT_ENABLED: HttpStatus.BAD_REQUEST
};

/** Error de dominio estable. Sin DIDs, direcciones ni configuracion interna. */
export class IssuerReadinessError extends HttpException {
  readonly code: IssuerReadinessErrorCode;

  constructor(code: IssuerReadinessErrorCode) {
    super({ code, message: SAFE_MESSAGES[code] }, STATUS_BY_CODE[code]);
    this.code = code;
  }
}

@Injectable()
export class IssuerReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(issuerId: string): Promise<IssuerReadinessResult | null> {
    const row = await this.prisma.issuer.findUnique({
      where: { id: issuerId },
      select: issuerReadinessSelect
    });

    return row ? evaluateIssuerReadiness(toSnapshot(row), resolveReadinessTarget()) : null;
  }

  /**
   * Evaluacion en LOTE: una consulta para todos los issuers, y el target del
   * entorno se resuelve UNA vez. Misma semantica que `evaluate`.
   */
  async evaluateMany(
    issuerIds: readonly string[]
  ): Promise<Map<string, IssuerReadinessResult>> {
    const result = new Map<string, IssuerReadinessResult>();

    if (issuerIds.length === 0) {
      return result;
    }

    const rows = await this.prisma.issuer.findMany({
      where: { id: { in: [...issuerIds] } },
      select: issuerReadinessSelect
    });
    const target = resolveReadinessTarget();

    for (const row of rows) {
      result.set(row.id, evaluateIssuerReadiness(toSnapshot(row), target));
    }

    return result;
  }

  /**
   * Precondicion de emision para el tipo T: autorizado + configuracion tecnica
   * coherente + T habilitado. Falla ANTES de resolver signers, de leer SSM y de
   * tocar la red.
   */
  async assertIssuerCanIssueType(
    issuerId: string,
    credentialType: CredentialType
  ): Promise<IssuerReadinessResult> {
    const row = await this.prisma.issuer.findUnique({
      where: { id: issuerId },
      select: issuerReadinessSelect
    });

    if (!row) {
      throw new IssuerReadinessError('ISSUER_NOT_FOUND');
    }

    const readiness = evaluateIssuerReadiness(
      toSnapshot(row),
      resolveReadinessTarget()
    );

    if (!readiness.administrativelyAuthorized || !readiness.configurationReady) {
      throw new IssuerReadinessError('ISSUER_NOT_READY');
    }

    assertCredentialTypeAllowed(row.allowedCredentialTypes, credentialType);

    return readiness;
  }
}

/**
 * Regla de CAPACIDAD, unica. La usan crear borrador, editar borrador, la
 * precondicion de emision y la revalidacion dentro de TX #1.
 *
 * Aplica a los CUATRO `CredentialType`: `[]` significa que el issuer no tiene
 * habilitado ningun tipo, como congelo S8c1.
 */
export function assertCredentialTypeAllowed(
  allowedCredentialTypes: readonly CredentialType[],
  credentialType: CredentialType
): void {
  if (!allowedCredentialTypes.includes(credentialType)) {
    throw new IssuerReadinessError('CREDENTIAL_TYPE_NOT_ENABLED');
  }
}

export function toSnapshot(row: IssuerReadinessRow): IssuerReadinessSnapshot {
  const identity = row.technicalIdentity;

  return {
    issuerId: row.id,
    authorizationStatus: row.authorizationStatus,
    allowedCredentialTypes: row.allowedCredentialTypes,
    technicalIdentity: identity
      ? {
          status: identity.status,
          did: identity.did,
          assertionSignerProfileId: identity.assertionSignerProfileId,
          assertionSignerProfile:
            identity.assertionSignerProfile as ReadinessSignerProfile | null,
          anchorSignerProfile:
            identity.anchorSignerProfile as ReadinessSignerProfile | null
        }
      : null,
    assertionHistory: row.assertionKeyBindings.map(
      (binding) => binding.signerProfile as BoundAssertionProfile
    )
  };
}
