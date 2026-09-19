/**
 * Confirmacion humana de los requisitos del verificador.
 *
 * FRONTERA EPISTEMICA, la misma que en el holder:
 *
 *   el modelo       PROPONE requisitos (PROPOSAL_ONLY)
 *   el verificador  CONFIRMA el criterio contra el que despues se evaluara
 *   el sistema      VALIDA el contrato
 *
 * Ninguna propuesta se vuelve autoridad de ejecucion sin este paso. SIN PROVEEDOR.
 *
 * REUSO EXACTO DEL CONTRATO DEL HOLDER. No hay un segundo contrato de Requirement:
 *
 *   mapCreateObjectiveRequest       la MISMA validacion de forma de `/me/objectives`
 *   buildObjectiveDefinitionV1      el MISMO builder (ids y orden los pone el server)
 *   verifyObjectiveDefinitionArtifact  el MISMO verificador (citas literales,
 *                                   claves de persona/evidencia prohibidas)
 *
 * LO QUE EL VERIFICADOR NO PUEDE ELEGIR, a diferencia del holder:
 *
 *   `objectiveType`        sale de la solicitud, declarado al crearla
 *   `source.inputType`     PASTED_TEXT
 *   `source.originalText`  el `rawObjectiveText` PERSISTIDO, verbatim
 *
 * Por eso una cita `DERIVED_FROM_SOURCE_TEXT` se verifica contra el texto que el
 * servidor tiene, no contra uno que el cliente mande en el mismo pedido. La
 * definicion confirmada queda atribuible a la solicitud que la origino.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, VerificationRequestStatus } from '@prisma/client';

import { canonicalJson } from '../source-extraction/canonical-json';
import { buildObjectiveDefinitionV1 } from '../objectives/objective-definition.builder';
import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { mapCreateObjectiveRequest } from '../objectives/objective-request.validator';
import { PrismaService } from '../prisma/prisma.service';
import { assertComputeAllowed } from './contextual-share-authority';
import { MAX_VERIFIER_REQUIREMENTS, MIN_VERIFIER_REQUIREMENTS } from './public-verification.limits';
import { PublicVerificationError } from './public-verification.errors';
import { loadSessionForShare, mapTransactionError } from './verification-request.service';
import {
  SESSION_SELECT,
  type VerificationSessionDto,
  projectVerificationSession
} from './verification-session.projection';

/** Lo unico que el verificador aporta al confirmar. */
const ALLOWED_CONFIRM_KEYS = new Set(['requirements', 'objectiveContext']);

@Injectable()
export class VerificationConfirmationService {
  constructor(private readonly prisma: PrismaService) {}

  async confirm(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    body: unknown,
    now: Date = new Date()
  ): Promise<VerificationSessionDto> {
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const { grant, row } = await loadSessionForShare(tx, rawShareToken, rawRequestToken, now);

          if (row.status === VerificationRequestStatus.consumed) {
            // Ya produjo su run. Nada de lo confirmado puede cambiar.
            throw new PublicVerificationError('REQUIREMENTS_ALREADY_CONFIRMED');
          }
          if (row.expiresAt <= now) {
            throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
          }
          // Confirmar habilita trabajo nuevo: exige lo mismo que proponer.
          await assertComputeAllowed(tx, grant, now);

          const definition = buildConfirmedDefinition(row, body);

          if (row.status === VerificationRequestStatus.requirements_confirmed) {
            // INMUTABLE. Reenviar EXACTAMENTE lo mismo es idempotente; cualquier
            // diferencia se rechaza. Un objetivo materialmente distinto es una
            // solicitud nueva.
            if (canonicalJson(definition) === canonicalJson(row.confirmedObjectiveDefinition)) {
              return row;
            }
            throw new PublicVerificationError('REQUIREMENTS_ALREADY_CONFIRMED');
          }

          // draft (confirmacion manual, sin propuesta) o requirements_proposed.
          const saved = await tx.verificationRequest.updateMany({
            where: {
              id: row.id,
              status: { in: [VerificationRequestStatus.draft, VerificationRequestStatus.requirements_proposed] }
            },
            data: {
              status: VerificationRequestStatus.requirements_confirmed,
              confirmedObjectiveDefinition: definition as unknown as Prisma.InputJsonValue,
              confirmedAt: now
            }
          });
          if (saved.count !== 1) throw new PublicVerificationError('SESSION_CONFLICT');

          return tx.verificationRequest.findUniqueOrThrow({
            where: { id: row.id },
            select: SESSION_SELECT
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      return projectVerificationSession(row, false);
    } catch (error: unknown) {
      throw mapTransactionError(error);
    }
  }
}

/**
 * Construye y verifica la definicion. Cualquier fallo de forma o de contrato es
 * `REQUIREMENTS_INVALID`: el detalle interno del validador no sale.
 */
function buildConfirmedDefinition(
  row: { rawObjectiveText: string; objectiveType: string; objectiveTitle: string | null },
  body: unknown
): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PublicVerificationError('REQUIREMENTS_INVALID');
  }
  const record = body as Record<string, unknown>;
  // Allowlist ANTES de delegar: `objectiveType` o `source` en el body no se
  // ignoran, se rechazan. Que el servidor los pise igual es defensa en profundidad.
  for (const key of Object.keys(record)) {
    if (!ALLOWED_CONFIRM_KEYS.has(key)) {
      throw new PublicVerificationError('REQUIREMENTS_INVALID');
    }
  }

  const requirements = record.requirements;
  if (!Array.isArray(requirements)) {
    throw new PublicVerificationError('REQUIREMENTS_INVALID');
  }
  // Tope publico V1. No se trunca nada: una propuesta con mas candidatos se
  // REDUCE en la revision, y confirmar mas de 12 se rechaza entero.
  if (requirements.length < MIN_VERIFIER_REQUIREMENTS || requirements.length > MAX_VERIFIER_REQUIREMENTS) {
    throw new PublicVerificationError('REQUIREMENTS_INVALID');
  }

  try {
    const mapped = mapCreateObjectiveRequest({
      objectiveType: row.objectiveType,
      title: row.objectiveTitle ?? '',
      objectiveContext: record.objectiveContext === undefined ? '' : record.objectiveContext,
      source: { inputType: 'PASTED_TEXT', originalText: row.rawObjectiveText },
      requirements
    });
    const definition = buildObjectiveDefinitionV1(mapped.definition);
    verifyObjectiveDefinitionArtifact(definition);
    return definition;
  } catch {
    throw new PublicVerificationError('REQUIREMENTS_INVALID');
  }
}
