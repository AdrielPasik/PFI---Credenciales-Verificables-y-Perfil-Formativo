/**
 * Proyeccion publica de una sesion de verificador.
 *
 * ALLOWLIST campo por campo, nunca un spread de la fila. Lo que el verificador ve
 * es SU propia sesion: su texto, su tipo de objetivo, la propuesta que se le hizo
 * y lo que el confirmo.
 *
 * NUNCA sale: id de la solicitud, `sharingGrantId`, `requestTokenHash`, ids o
 * version de politica, credenciales autorizadas, ids de intento, metadata del
 * proveedor, prompts ni diagnosticos internos. No hay campo donde ponerlos.
 */

import { type ObjectiveType, type Prisma, type VerificationRequestStatus } from '@prisma/client';

export const SESSION_SELECT = {
  id: true,
  sharingGrantId: true,
  status: true,
  rawObjectiveText: true,
  objectiveType: true,
  objectiveTitle: true,
  proposedRequirements: true,
  confirmedObjectiveDefinition: true,
  createdAt: true,
  expiresAt: true,
  confirmedAt: true,
  consumedAt: true
} satisfies Prisma.VerificationRequestSelect;

export type SessionRow = Prisma.VerificationRequestGetPayload<{ select: typeof SESSION_SELECT }>;

export interface VerificationSessionDto {
  readonly status: VerificationRequestStatus;
  readonly objectiveType: ObjectiveType;
  /** El texto propio del verificador, verbatim. */
  readonly rawObjectiveText: string;
  readonly objectiveTitle: string | null;
  /** `objective_requirement_proposal_v1`, PROPOSAL_ONLY. Nunca autoridad de ejecucion. */
  readonly proposal: unknown | null;
  /** Hay un trabajo de proveedor en curso para esta sesion. */
  readonly proposalInProgress: boolean;
  /** `objective_definition_v1` confirmado por el verificador, o null. */
  readonly confirmedObjectiveDefinition: unknown | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
}

export function projectVerificationSession(
  row: SessionRow,
  proposalInProgress: boolean
): VerificationSessionDto {
  return {
    status: row.status,
    objectiveType: row.objectiveType,
    rawObjectiveText: row.rawObjectiveText,
    objectiveTitle: row.objectiveTitle,
    proposal: row.proposedRequirements ?? null,
    proposalInProgress,
    confirmedObjectiveDefinition: row.confirmedObjectiveDefinition ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null
  };
}
