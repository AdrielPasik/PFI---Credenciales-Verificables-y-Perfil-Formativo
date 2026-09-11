/**
 * Cliente de Objetivos — P2.3.
 *
 * Sigue la convencion del repo (`holder-api.ts`): funciones sueltas que reciben
 * `AuthenticatedApiRequest` y devuelven el resultado de un adapter.
 *
 * NO existe `createObjectiveRevisionRequest`. El backend soporta revisiones,
 * pero su semantica frente a los ReasoningRuns de P2.4 esta deliberadamente
 * diferida: exponerla ahora congelaria una decision sin su consumidor.
 */

import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  adaptObjectiveDetail,
  adaptObjectiveProposal,
  adaptObjectiveSummaries
} from '@/lib/adapters/objectives.adapter';
import type {
  CreateObjectiveRequestBody,
  ObjectiveProposalRequestBody
} from '@/models/objectives';

export async function proposeObjectiveRequirementsRequest(
  request: AuthenticatedApiRequest,
  body: ObjectiveProposalRequestBody,
  signal?: AbortSignal
) {
  return adaptObjectiveProposal(
    await request('/me/objective-requirement-proposals', {
      method: 'POST',
      body,
      signal
    })
  );
}

export async function createObjectiveRequest(
  request: AuthenticatedApiRequest,
  body: CreateObjectiveRequestBody
) {
  return adaptObjectiveDetail(
    await request('/me/objectives', { method: 'POST', body })
  );
}

export async function listMyObjectivesRequest(request: AuthenticatedApiRequest) {
  return adaptObjectiveSummaries(await request('/me/objectives'));
}

export async function getMyObjectiveRequest(
  request: AuthenticatedApiRequest,
  objectiveReference: string
) {
  const reference = objectiveReference.trim();
  if (!reference) throw new Error('La referencia del objetivo no es valida.');
  return adaptObjectiveDetail(
    await request(`/me/objectives/${encodeURIComponent(reference)}`)
  );
}
