/**
 * Superficie publica del analisis contextual.
 *
 * DOS autoridades, y viajan distinto:
 *
 *   token del ENLACE   en el path, igual que `/share/profile/:token`
 *   token de SESION    en el header `X-Verification-Request-Token`
 *
 * El token de sesion NUNCA entra en la URL, ni en query, ni en hash: quedaria en
 * el historial del navegador y en el `Referer`. Tampoco se escribe en logs: el
 * cliente de API no serializa headers en sus errores.
 */

import {
  adaptCreatedPublicVerificationSession,
  adaptPublicAnalysisResult,
  adaptPublicVerificationSession
} from '@/lib/adapters/public-analysis.adapter';
import { createApiClient } from '@/lib/api/api-client';
import type { ObjectiveTypeToken } from '@/models/objectives';

export const VERIFICATION_REQUEST_TOKEN_HEADER = 'X-Verification-Request-Token';

function sharePath(shareToken: string, suffix: string): `/${string}` {
  const normalized = shareToken.trim();
  if (!normalized) throw new Error('El enlace compartido no es válido.');
  return `/share/profile/${encodeURIComponent(normalized)}/${suffix}`;
}

function sessionHeaders(requestToken: string): Record<string, string> {
  const normalized = requestToken.trim();
  if (!normalized) throw new Error('La sesión de análisis no es válida.');
  return { [VERIFICATION_REQUEST_TOKEN_HEADER]: normalized };
}

export interface CreateVerificationRequestInput {
  objectiveType: ObjectiveTypeToken;
  objectiveTitle: string | null;
  /** Verbatim: es la autoridad textual contra la que se anclan las citas. */
  rawObjectiveText: string;
}

export async function createVerificationRequestRequest(
  shareToken: string,
  input: CreateVerificationRequestInput,
  signal?: AbortSignal
) {
  return adaptCreatedPublicVerificationSession(
    await createApiClient().request(sharePath(shareToken, 'verification-requests'), {
      method: 'POST',
      body: input,
      signal
    })
  );
}

export async function proposeVerificationRequirementsRequest(
  shareToken: string,
  requestToken: string,
  signal?: AbortSignal
) {
  return adaptPublicVerificationSession(
    await createApiClient().request(sharePath(shareToken, 'verification-requests/propose'), {
      method: 'POST',
      headers: sessionHeaders(requestToken),
      signal
    })
  );
}

export async function getVerificationSessionRequest(
  shareToken: string,
  requestToken: string,
  signal?: AbortSignal
) {
  return adaptPublicVerificationSession(
    await createApiClient().request(sharePath(shareToken, 'verification-session'), {
      headers: sessionHeaders(requestToken),
      signal
    })
  );
}

export interface ConfirmVerificationRequirementsInput {
  requirements: Array<{
    requirementText: string;
    provenanceKind: 'DERIVED_FROM_SOURCE_TEXT' | 'DIRECT_STRUCTURED_INPUT';
    sourceQuote: string | null;
  }>;
}

export async function confirmVerificationRequirementsRequest(
  shareToken: string,
  requestToken: string,
  body: ConfirmVerificationRequirementsInput,
  signal?: AbortSignal
) {
  return adaptPublicVerificationSession(
    await createApiClient().request(sharePath(shareToken, 'verification-requirements'), {
      method: 'PUT',
      headers: sessionHeaders(requestToken),
      body,
      signal
    })
  );
}

/**
 * Dispara el analisis. Es idempotente por sesion: repetirlo nunca crea un
 * segundo run.
 *
 * Puede tardar minutos. Si su respuesta se pierde, el estado se recupera con
 * `getVerificationResultRequest`, nunca creando otra solicitud.
 */
export async function executeVerificationAnalysisRequest(
  shareToken: string,
  requestToken: string,
  signal?: AbortSignal
) {
  return adaptPublicAnalysisResult(
    await createApiClient().request(sharePath(shareToken, 'verification-execute'), {
      method: 'POST',
      headers: sessionHeaders(requestToken),
      signal
    })
  );
}

export async function getVerificationResultRequest(
  shareToken: string,
  requestToken: string,
  signal?: AbortSignal
) {
  return adaptPublicAnalysisResult(
    await createApiClient().request(sharePath(shareToken, 'verification-result'), {
      headers: sessionHeaders(requestToken),
      signal
    })
  );
}
