import {
  adaptDocumentAnalysisTriggerResponse,
  adaptIssuerAnalysisRunResponse,
  adaptLatestIssuerAnalysisRunResponse
} from '@/lib/adapters/analysis-runs.adapter';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';

interface CredentialAnalysisReferences {
  issuerReference: string;
  credentialReference: string;
}

interface ExactAnalysisRunReferences extends CredentialAnalysisReferences {
  analysisRunReference: string;
}

export async function getLatestIssuerAnalysisRunRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  references: CredentialAnalysisReferences
) {
  const path = analysisRunPath(references);
  const payload = await requestAuthenticated(`${path}/latest`);
  const result = adaptLatestIssuerAnalysisRunResponse(payload);
  if (
    result &&
    result.credentialReference !== references.credentialReference.trim()
  ) {
    incompatibleReference();
  }
  return result;
}

export async function getIssuerAnalysisRunByIdRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  references: ExactAnalysisRunReferences
) {
  const path = analysisRunPath(references);
  const analysisRunReference = validReference(
    references.analysisRunReference
  );
  const payload = await requestAuthenticated(
    `${path}/${encodeURIComponent(analysisRunReference)}`
  );
  const result = adaptIssuerAnalysisRunResponse(payload);
  if (
    result.credentialReference !== references.credentialReference.trim() ||
    result.analysisRunReference !== analysisRunReference
  ) {
    incompatibleReference();
  }
  return result;
}

export async function triggerIssuerDocumentAnalysisRequest(
  requestAuthenticated: AuthenticatedApiRequest,
  references: CredentialAnalysisReferences
) {
  const path = analysisRunPath(references);
  const payload = await requestAuthenticated(`${path}/document`, {
    method: 'POST'
  });
  const result = adaptDocumentAnalysisTriggerResponse(payload);
  if (result.credentialReference !== references.credentialReference.trim()) {
    incompatibleReference();
  }
  return result;
}

function analysisRunPath(references: CredentialAnalysisReferences) {
  const issuerReference = validReference(references.issuerReference);
  const credentialReference = validReference(references.credentialReference);

  return `/issuers/${encodeURIComponent(issuerReference)}/credentials/${encodeURIComponent(credentialReference)}/analysis-runs` as const;
}

function validReference(value: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(
      'La referencia institucional del análisis no es válida.',
      'http',
      400
    );
  }
  return value.trim();
}

function incompatibleReference(): never {
  throw new IncompatiblePayloadError(
    'La respuesta del análisis no corresponde al recurso solicitado.'
  );
}
