/**
 * Sesion anonima del verificador: creacion y lectura.
 *
 * SIN PROVEEDOR. Crear un borrador guarda el texto que trajo el tercero y le
 * entrega, una sola vez, el token que direcciona su sesion. No propone requisitos
 * ni consume cuota de proveedor.
 */

import { Injectable } from '@nestjs/common';
import { ObjectiveType, Prisma, VerificationRequestStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  type ShareAuthorityRow,
  assertComputeAllowed,
  assertShareValid,
  loadShareAuthorityByToken
} from './contextual-share-authority';
import { generateOpaqueToken, hashOpaqueToken, normalizeOpaqueToken } from './opaque-token';
import {
  MAX_ACTIVE_REQUESTS_PER_SHARE,
  MAX_VERIFIER_OBJECTIVE_CODE_POINTS,
  MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH,
  VERIFICATION_REQUEST_TTL_MS
} from './public-verification.limits';
import { PublicVerificationError } from './public-verification.errors';
import {
  SESSION_SELECT,
  type SessionRow,
  type VerificationSessionDto,
  projectVerificationSession
} from './verification-session.projection';

export {
  MAX_VERIFIER_OBJECTIVE_CODE_POINTS,
  MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH,
  VERIFICATION_REQUEST_TTL_MS
} from './public-verification.limits';

/** Controles C0 salvo tab, salto de linea y retorno de carro, mas DEL. */
const FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const ALLOWED_DRAFT_KEYS = new Set(['rawObjectiveText', 'objectiveType', 'objectiveTitle']);

export interface CreatedVerificationRequest {
  /** Valor crudo. Unica vez que existe fuera del cliente. */
  readonly requestToken: string;
  readonly session: VerificationSessionDto;
}

@Injectable()
export class VerificationRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Borrador nuevo.
   *
   * UNA transaccion SERIALIZABLE para "contar sesiones abiertas + insertar": dos
   * creaciones concurrentes sobre el mismo enlace no pueden pasar las dos el tope
   * leyendo el mismo conteo. Sin I/O externo adentro.
   */
  async createDraft(
    rawShareToken: unknown,
    body: unknown,
    now: Date = new Date()
  ): Promise<CreatedVerificationRequest> {
    const input = parseDraftInput(body);
    const requestToken = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + VERIFICATION_REQUEST_TTL_MS);

    let row: SessionRow;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          // Trabajo nuevo: enlace valido + politica habilitada + evidencia
          // efectiva. La misma regla que anuncia el perfil publico.
          const grant = await loadShareAuthorityByToken(tx, rawShareToken);
          const authority = await assertComputeAllowed(tx, grant, now);

          // FRONTERA DE ALMACENAMIENTO, no de proveedor. Solo cuentan las
          // sesiones vigentes y sin consumir.
          const active = await tx.verificationRequest.count({
            where: {
              sharingGrantId: authority.sharingGrantId,
              status: { not: VerificationRequestStatus.consumed },
              expiresAt: { gt: now }
            }
          });
          if (active >= MAX_ACTIVE_REQUESTS_PER_SHARE) {
            throw new PublicVerificationError('ACTIVE_REQUEST_LIMIT_REACHED');
          }

          return tx.verificationRequest.create({
            data: {
              sharingGrantId: authority.sharingGrantId,
              // Solo el hash. El valor crudo no toca la base.
              requestTokenHash: hashOpaqueToken(requestToken),
              status: VerificationRequestStatus.draft,
              rawObjectiveText: input.rawObjectiveText,
              objectiveType: input.objectiveType,
              objectiveTitle: input.objectiveTitle,
              expiresAt
            },
            select: SESSION_SELECT
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error: unknown) {
      throw mapTransactionError(error);
    }

    return { requestToken, session: projectVerificationSession(row, false) };
  }

  /**
   * La sesion propia del verificador.
   *
   * Lectura: exige enlace valido, NO politica. Una sesion sin consumir y vencida
   * ya no existe para el publico; una consumida si, porque su run la sobrevive.
   */
  async readSession(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date = new Date()
  ): Promise<VerificationSessionDto> {
    const { row } = await loadSessionForShare(this.prisma, rawShareToken, rawRequestToken, now);
    if (row.status !== VerificationRequestStatus.consumed && row.expiresAt <= now) {
      throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
    }
    return projectVerificationSession(row, await hasOpenProposal(this.prisma, row.id, now));
  }
}

type SessionReader = Pick<Prisma.TransactionClient, 'sharingGrant' | 'verificationRequest'>;

/**
 * Enlace primero, solicitud despues, y la solicitud tiene que ser de ESE enlace.
 * No evalua politica ni vencimiento: cada operacion decide eso.
 */
export async function loadSessionForShare(
  reader: SessionReader,
  rawShareToken: unknown,
  rawRequestToken: unknown,
  now: Date
): Promise<{ grant: ShareAuthorityRow; row: SessionRow }> {
  const grant = assertShareValid(await loadShareAuthorityByToken(reader, rawShareToken), now);

  const token = normalizeOpaqueToken(rawRequestToken);
  if (token === null) throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');

  const row = await reader.verificationRequest.findUnique({
    where: { requestTokenHash: hashOpaqueToken(token) },
    select: SESSION_SELECT
  });
  // Una solicitud de OTRO enlace responde igual que una inexistente.
  if (!row || row.sharingGrantId !== grant.id) {
    throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
  }
  return { grant, row };
}

/** Hay un intento de proveedor abierto y dentro de su lease. */
export async function hasOpenProposal(
  reader: Pick<Prisma.TransactionClient, 'verificationProposalAttempt'>,
  verificationRequestId: string,
  now: Date
): Promise<boolean> {
  const open = await reader.verificationProposalAttempt.count({
    where: { verificationRequestId, outcome: null, leaseExpiresAt: { gt: now } }
  });
  return open > 0;
}

export function mapTransactionError(error: unknown): unknown {
  if (error instanceof PublicVerificationError) return error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2002')
  ) {
    // Conflicto de serializacion o de unicidad: nada se persistio. Reintentable.
    return new PublicVerificationError('SESSION_CONFLICT');
  }
  return error;
}

interface DraftInput {
  rawObjectiveText: string;
  objectiveType: ObjectiveType;
  objectiveTitle: string | null;
}

function parseDraftInput(body: unknown): DraftInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PublicVerificationError('INVALID_REQUEST_INPUT');
  }
  const record = body as Record<string, unknown>;
  // Allowlist estricta: el verificador no puede colar credenciales, ids del
  // holder ni nada que no sea su propio objetivo.
  for (const key of Object.keys(record)) {
    if (!ALLOWED_DRAFT_KEYS.has(key)) {
      throw new PublicVerificationError('INVALID_REQUEST_INPUT');
    }
  }

  const text = record.rawObjectiveText;
  if (typeof text !== 'string' || FORBIDDEN_CONTROL.test(text)) {
    throw new PublicVerificationError('INVALID_REQUEST_INPUT');
  }
  // VERBATIM: sin trim. Los offsets de la propuesta se calculan sobre este texto
  // exacto, y el contrato del holder tampoco lo toca. Solo se rechaza en blanco.
  if (text.trim().length === 0 || Array.from(text).length > MAX_VERIFIER_OBJECTIVE_CODE_POINTS) {
    throw new PublicVerificationError('INVALID_REQUEST_INPUT');
  }

  const type = record.objectiveType;
  if (typeof type !== 'string' || !Object.values(ObjectiveType).includes(type as ObjectiveType)) {
    throw new PublicVerificationError('INVALID_REQUEST_INPUT');
  }

  let objectiveTitle: string | null = null;
  if (record.objectiveTitle !== undefined && record.objectiveTitle !== null) {
    const title = record.objectiveTitle;
    if (typeof title !== 'string' || /[\u0000-\u001F\u007F]/.test(title)) {
      throw new PublicVerificationError('INVALID_REQUEST_INPUT');
    }
    const normalized = title.trim().replace(/\s+/g, ' ');
    if (Array.from(normalized).length > MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH) {
      throw new PublicVerificationError('INVALID_REQUEST_INPUT');
    }
    objectiveTitle = normalized || null;
  }

  return { rawObjectiveText: text, objectiveType: type as ObjectiveType, objectiveTitle };
}
