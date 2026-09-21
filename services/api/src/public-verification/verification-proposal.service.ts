/**
 * Propuesta de requisitos para una sesion de verificador.
 *
 * REUSA EL NUCLEO DEL HOLDER SIN TOCARLO. `ObjectiveRequirementProposalService`
 * ya es agnostico: recibe `{ objectiveType, title, rawObjectiveText }`, llama UNA
 * vez al ai-service, verifica el artefacto de forma independiente contra el texto
 * enviado y devuelve un DTO por allowlist. No conoce al holder ni a Prisma. Lo que
 * este servicio agrega es lo que un endpoint ANONIMO necesita y uno autenticado
 * no: claim persistente, cuota, cooldown y re-verificacion de autoridad.
 *
 * GARANTIAS, dichas con precision:
 *
 *   A. UNA propuesta autoritativa por solicitud.                     SI
 *   B. A lo sumo UN claim ACTIVO por solicitud.                      SI
 *   C. Exactamente UNA invocacion externa al proveedor.              NO
 *
 * C no se puede afirmar. Un lease en base no prueba ejecucion unica: si la llamada
 * arranca y el proceso muere antes de persistir, el lease vence y un reintento
 * vuelve a llamar. Lo que SI se garantiza es que ese costo este acotado por la
 * cuota y que solo un resultado pueda volverse autoritativo.
 *
 * ORDEN CAUSAL:
 *
 *   claim()   UNA transaccion SERIALIZABLE, sin I/O externo:
 *               enlace valido, politica + evidencia, solicitud vigente en draft,
 *               sin claim activo, cuota y cooldown del enlace -> inserta intento
 *   COMMIT
 *   proveedor (fuera de toda transaccion)
 *   accept()  UNA transaccion SERIALIZABLE corta:
 *               el intento sigue abierto (no supersedido), enlace + politica +
 *               evidencia siguen valiendo, solicitud sigue en draft y vigente
 *               -> persiste la propuesta y cierra el intento, o la descarta
 */

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  VerificationProposalAttemptOutcome,
  VerificationRequestStatus
} from '@prisma/client';

import { type ObjectiveRequirementProposalResponseDto } from '../objective-requirement-proposal/dto/objective-requirement-proposal.dto';
import { ObjectiveRequirementProposalError } from '../objective-requirement-proposal/objective-requirement-proposal.errors';
import { ObjectiveRequirementProposalService } from '../objective-requirement-proposal/objective-requirement-proposal.service';
import { PrismaService } from '../prisma/prisma.service';
import { SHARE_AUTHORITY_SELECT, assertComputeAllowed } from './contextual-share-authority';
import {
  MAX_VERIFIER_REQUIREMENTS,
  PROPOSAL_COOLDOWN_MS,
  PROPOSAL_LEASE_MS,
  PROPOSAL_QUOTA_WINDOW_MS,
  PROPOSAL_STARTS_PER_SHARE_WINDOW
} from './public-verification.limits';
import { PublicVerificationError, type PublicVerificationErrorCode } from './public-verification.errors';
import {
  hasOpenProposal,
  loadSessionForShare,
  mapTransactionError
} from './verification-request.service';
import {
  SESSION_SELECT,
  type SessionRow,
  type VerificationSessionDto,
  projectVerificationSession
} from './verification-session.projection';

type Clock = () => Date;

type ClaimResult =
  | { readonly kind: 'EXISTING'; readonly session: VerificationSessionDto }
  | {
      readonly kind: 'CLAIMED';
      readonly attemptId: string;
      readonly verificationRequestId: string;
      readonly sharingGrantId: string;
      readonly input: {
        readonly objectiveType: SessionRow['objectiveType'];
        readonly title: string;
        readonly rawObjectiveText: string;
      };
    };

type AcceptResult =
  | { readonly kind: 'ACCEPTED'; readonly row: SessionRow }
  | { readonly kind: 'REJECTED'; readonly code: PublicVerificationErrorCode };

/** Reintentos de `accept()` ante conflicto de serializacion. Sin proveedor. */
const ACCEPT_SERIALIZATION_RETRIES = 3;

@Injectable()
export class VerificationProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ObjectiveRequirementProposalService
  ) {}

  async propose(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    clock: Clock = () => new Date()
  ): Promise<VerificationSessionDto> {
    const claim = await this.claim(rawShareToken, rawRequestToken, clock());
    if (claim.kind === 'EXISTING') return claim.session;

    // EL TOPE ES DEL PRODUCTO, y por eso viaja con el pedido.
    //
    // La confirmacion publica rechaza mas de MAX_VERIFIER_REQUIREMENTS. Una
    // propuesta de 34 candidatos no es "una propuesta un poco larga": es un
    // estado que el verificador no puede confirmar nunca. Se pide la SELECCION a
    // la etapa que lee la fuente; si igual vuelve excedida, cae por el camino de
    // salida inutilizable que ya existe -- sin recortar, sin aceptar los primeros
    // 12 y sin persistirla. Cuota, cooldown y reintentos no cambian.
    let proposal: ObjectiveRequirementProposalResponseDto;
    try {
      proposal = await this.proposals.propose(claim.input, MAX_VERIFIER_REQUIREMENTS);
    } catch (error: unknown) {
      throw await this.onProviderFailure(claim.attemptId, error, clock());
    }

    const accepted = await this.acceptWithRetry(claim, proposal, clock);
    if (accepted.kind === 'REJECTED') {
      throw new PublicVerificationError(accepted.code);
    }
    return projectVerificationSession(accepted.row, false);
  }

  // -------------------------------------------------------------------------
  // Claim
  // -------------------------------------------------------------------------

  private async claim(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date
  ): Promise<ClaimResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { grant, row } = await loadSessionForShare(tx, rawShareToken, rawRequestToken, now);

          // Vencida y sin consumir: la sesion ya no puede proponer.
          if (row.status !== VerificationRequestStatus.consumed && row.expiresAt <= now) {
            throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
          }

          // REPLAY. La propuesta ya existe: se devuelve la MISMA, sin proveedor
          // y sin consumir cuota. Es lo que recupera una respuesta HTTP perdida.
          // Una sesion ya confirmada tampoco abre trabajo nuevo.
          if (row.proposedRequirements !== null || row.status !== VerificationRequestStatus.draft) {
            return {
              kind: 'EXISTING',
              session: projectVerificationSession(row, await hasOpenProposal(tx, row.id, now))
            };
          }

          // Trabajo nuevo: politica habilitada y evidencia efectiva, no solo un
          // enlace activo.
          const authority = await assertComputeAllowed(tx, grant, now);

          // UN claim activo por solicitud. Uno vencido se cierra como DISCARDED
          // en ESTA transaccion, antes de insertar el nuevo: asi un resultado
          // tardio del intento viejo nunca puede aceptarse.
          const open = await tx.verificationProposalAttempt.findMany({
            where: { verificationRequestId: row.id, outcome: null },
            select: { id: true, leaseExpiresAt: true }
          });
          if (open.some((attempt) => attempt.leaseExpiresAt > now)) {
            throw new PublicVerificationError('PROPOSAL_IN_PROGRESS');
          }
          if (open.length > 0) {
            await tx.verificationProposalAttempt.updateMany({
              where: { id: { in: open.map((attempt) => attempt.id) }, outcome: null },
              data: { outcome: VerificationProposalAttemptOutcome.DISCARDED, finishedAt: now }
            });
          }

          // CUOTA: cada fila es un arranque de proveedor, termine como termine.
          const started = await tx.verificationProposalAttempt.count({
            where: {
              sharingGrantId: authority.sharingGrantId,
              startedAt: { gt: new Date(now.getTime() - PROPOSAL_QUOTA_WINDOW_MS) }
            }
          });
          if (started >= PROPOSAL_STARTS_PER_SHARE_WINDOW) {
            throw new PublicVerificationError('PROPOSAL_QUOTA_EXCEEDED');
          }

          // COOLDOWN del enlace, no de la solicitud: un enlace filtrado no puede
          // repartir su ritmo entre varias sesiones.
          const recent = await tx.verificationProposalAttempt.count({
            where: {
              sharingGrantId: authority.sharingGrantId,
              startedAt: { gt: new Date(now.getTime() - PROPOSAL_COOLDOWN_MS) }
            }
          });
          if (recent > 0) {
            throw new PublicVerificationError('PROPOSAL_COOLDOWN_ACTIVE');
          }

          const attempt = await tx.verificationProposalAttempt.create({
            data: {
              verificationRequestId: row.id,
              sharingGrantId: authority.sharingGrantId,
              startedAt: now,
              leaseExpiresAt: new Date(now.getTime() + PROPOSAL_LEASE_MS)
            },
            select: { id: true }
          });

          return {
            kind: 'CLAIMED',
            attemptId: attempt.id,
            verificationRequestId: row.id,
            sharingGrantId: authority.sharingGrantId,
            input: {
              objectiveType: row.objectiveType,
              title: row.objectiveTitle ?? '',
              // VERBATIM: el verificador del artefacto compara offsets contra
              // exactamente este texto.
              rawObjectiveText: row.rawObjectiveText
            }
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error: unknown) {
      // P2034 aca significa que otro claim concurrente del mismo enlace gano la
      // carrera. NINGUNA llamada al proveedor arranco.
      throw mapTransactionError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Fallo del proveedor
  // -------------------------------------------------------------------------

  /**
   * DOS FAMILIAS, y la diferencia es si el trabajo del proveedor TERMINO.
   *
   *   hubo respuesta y no sirve   el trabajo termino: el intento se cierra FAILED
   *                               y la solicitud queda disponible para otro
   *                               intento, sujeto a cuota y cooldown.
   *   transporte / desconocido    NO se sabe si termino. El cliente de IA colapsa
   *                               en un mismo codigo el timeout de NestJS (60 s) y
   *                               el fallo reportado por el ai-service, cuyo
   *                               proveedor puede seguir corriendo hasta 300 s.
   *                               El intento queda ABIERTO: el lease decide.
   */
  private async onProviderFailure(
    attemptId: string,
    error: unknown,
    now: Date
  ): Promise<PublicVerificationError> {
    const definitive =
      error instanceof ObjectiveRequirementProposalError &&
      (error.code === 'UNABLE_TO_PRODUCE_PROPOSAL' ||
        error.code === 'OBJECTIVE_TOO_LARGE' ||
        error.code === 'INVALID_OBJECTIVE_INPUT');

    if (!definitive) {
      return new PublicVerificationError('PROPOSAL_TEMPORARILY_UNAVAILABLE');
    }

    await this.prisma.verificationProposalAttempt.updateMany({
      where: { id: attemptId, outcome: null },
      data: { outcome: VerificationProposalAttemptOutcome.FAILED, finishedAt: now }
    });
    return new PublicVerificationError('PROPOSAL_UNAVAILABLE');
  }

  // -------------------------------------------------------------------------
  // Accept
  // -------------------------------------------------------------------------

  private async acceptWithRetry(
    claim: Extract<ClaimResult, { kind: 'CLAIMED' }>,
    proposal: ObjectiveRequirementProposalResponseDto,
    clock: Clock
  ): Promise<AcceptResult> {
    // Un conflicto de serializacion aca NO debe tirar una propuesta ya pagada: se
    // reintenta la transaccion corta. No hay proveedor en este bucle.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.accept(claim, proposal, clock());
      } catch (error: unknown) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!conflict || attempt >= ACCEPT_SERIALIZATION_RETRIES) {
          throw mapTransactionError(error);
        }
      }
    }
  }

  /**
   * Nunca lanza para los rechazos de dominio: devuelve el codigo, para que la
   * marca DISCARDED se COMMITEE. Lanzar adentro haria rollback de esa marca.
   */
  private async accept(
    claim: Extract<ClaimResult, { kind: 'CLAIMED' }>,
    proposal: ObjectiveRequirementProposalResponseDto,
    now: Date
  ): Promise<AcceptResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const discard = async (code: PublicVerificationErrorCode): Promise<AcceptResult> => {
          await tx.verificationProposalAttempt.updateMany({
            where: { id: claim.attemptId, outcome: null },
            data: { outcome: VerificationProposalAttemptOutcome.DISCARDED, finishedAt: now }
          });
          return { kind: 'REJECTED', code };
        };

        // FENCING. Lo que invalida un resultado es quedar SUPERSEDIDO, no que el
        // lease haya vencido: vencer solo le da permiso a OTRO intento para
        // reclamar. Si nadie reclamo, este sigue siendo el unico dueño y su
        // resultado --ya pagado-- se acepta. Si alguien reclamo, este intento
        // quedo DISCARDED en esa transaccion y su resultado se tira.
        const attempt = await tx.verificationProposalAttempt.findUnique({
          where: { id: claim.attemptId },
          select: { outcome: true }
        });
        if (!attempt || attempt.outcome !== null) {
          return { kind: 'REJECTED', code: 'SESSION_CONFLICT' };
        }

        // La autoridad se RELEE: el holder pudo revocar el enlace o apagar la
        // politica mientras el proveedor trabajaba.
        const grant = await tx.sharingGrant.findUnique({
          where: { id: claim.sharingGrantId },
          select: SHARE_AUTHORITY_SELECT
        });
        try {
          await assertComputeAllowed(tx, grant, now);
        } catch (error: unknown) {
          if (error instanceof PublicVerificationError) return discard(error.code);
          throw error;
        }

        const request = await tx.verificationRequest.findUnique({
          where: { id: claim.verificationRequestId },
          select: { status: true, expiresAt: true }
        });
        if (!request) return discard('REQUEST_NOT_AVAILABLE');
        if (request.status !== VerificationRequestStatus.draft) {
          // La confirmo a mano mientras tanto: gana la decision humana.
          return discard('SESSION_CONFLICT');
        }
        if (request.expiresAt <= now) return discard('REQUEST_NOT_AVAILABLE');

        const closed = await tx.verificationProposalAttempt.updateMany({
          where: { id: claim.attemptId, outcome: null },
          data: { outcome: VerificationProposalAttemptOutcome.SUCCEEDED, finishedAt: now }
        });
        if (closed.count !== 1) return { kind: 'REJECTED', code: 'SESSION_CONFLICT' };

        const saved = await tx.verificationRequest.updateMany({
          where: { id: claim.verificationRequestId, status: VerificationRequestStatus.draft },
          data: {
            status: VerificationRequestStatus.requirements_proposed,
            // El DTO VERIFICADO y por allowlist. Nunca la respuesta cruda.
            proposedRequirements: proposal as unknown as Prisma.InputJsonValue
          }
        });
        if (saved.count !== 1) {
          // Imposible leyendo `draft` en esta misma transaccion SERIALIZABLE; si
          // pasa, se deshace todo en lugar de dejar un intento SUCCEEDED huerfano.
          throw new PublicVerificationError('SESSION_CONFLICT');
        }

        const row = await tx.verificationRequest.findUniqueOrThrow({
          where: { id: claim.verificationRequestId },
          select: SESSION_SELECT
        });
        return { kind: 'ACCEPTED', row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}
