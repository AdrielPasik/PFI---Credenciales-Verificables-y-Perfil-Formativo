import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  adaptApplyReusableSemanticInterpretationResult,
  adaptReusableSemanticInterpretationCandidate,
  adaptReusableSemanticInterpretationRead
} from '@/lib/adapters/reusable-semantic-interpretation.adapter';
import { ApiError } from '@/lib/errors/api-error';
import type {
  ApplyReusableSemanticInterpretationCommand,
  GetReusableSemanticInterpretationCandidateCommand,
  GetReusableSemanticInterpretationCommand
} from '@/models/credentials';

function requireCredentialReferences(command: {
  issuerReference: string;
  credentialReference: string;
}) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();

  if (issuerReference.length === 0 || credentialReference.length === 0) {
    throw new ApiError(
      'La referencia institucional de la credencial no es válida.',
      'http',
      400
    );
  }

  return { issuerReference, credentialReference };
}

function reusableSemanticInterpretationPath(command: {
  issuerReference: string;
  credentialReference: string;
}) {
  const { issuerReference, credentialReference } =
    requireCredentialReferences(command);

  return `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}/reusable-semantic-interpretation` as const;
}

// C4b.2: consulta si esta credencial ya tiene una interpretacion revisada
// aplicada. GET puro -- 200 con null si no hay aplicacion active (nunca
// error), 404 solo si la credencial no existe/no es de este issuer.
export async function getReusableSemanticInterpretation(
  requestAuthenticated: AuthenticatedApiRequest,
  command: GetReusableSemanticInterpretationCommand
) {
  const path = reusableSemanticInterpretationPath(command);
  const payload = await requestAuthenticated(path, { signal: command.signal });

  return adaptReusableSemanticInterpretationRead(payload);
}

// C4b.2: candidato de solo lectura para un template elegido explicitamente
// por el emisor (sourceTemplateId sigue diferido). Nunca crea, guarda ni
// modifica nada.
export async function getReusableSemanticInterpretationCandidate(
  requestAuthenticated: AuthenticatedApiRequest,
  command: GetReusableSemanticInterpretationCandidateCommand
) {
  const path = reusableSemanticInterpretationPath(command);
  const templateReference = command.templateReference.trim();

  if (templateReference.length === 0) {
    throw new ApiError(
      'La referencia del contenido reutilizable no es válida.',
      'http',
      400
    );
  }

  const params = new URLSearchParams({ templateId: templateReference });
  const payload = await requestAuthenticated(
    `${path}/candidate?${params.toString()}`,
    { signal: command.signal }
  );

  return adaptReusableSemanticInterpretationCandidate(payload);
}

// C4b.2: aplica la interpretacion revisada del template elegido. Manda
// exactamente templateId/approvalRevision/acknowledgeDestinationDrift --
// nunca approvedSnapshot, source* ni destinationCompatibility (el backend
// los recalcula siempre server-side, nunca confia en lo que mande el
// cliente).
export async function applyReusableSemanticInterpretation(
  requestAuthenticated: AuthenticatedApiRequest,
  command: ApplyReusableSemanticInterpretationCommand
) {
  const path = reusableSemanticInterpretationPath(command);
  const templateReference = command.templateReference.trim();
  const approvalRevision = command.approvalRevision.trim();

  if (templateReference.length === 0 || approvalRevision.length === 0) {
    throw new ApiError(
      'La referencia de la interpretación a aplicar no es válida.',
      'http',
      400
    );
  }

  const payload = await requestAuthenticated(`${path}/apply`, {
    method: 'POST',
    body: {
      templateId: templateReference,
      approvalRevision,
      ...(command.acknowledgeDestinationDrift
        ? { acknowledgeDestinationDrift: true }
        : {})
    }
  });

  return adaptApplyReusableSemanticInterpretationResult(payload);
}
