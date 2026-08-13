import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  adaptCourseTemplateSummary,
  adaptCourseTemplateSummaryList,
  adaptTemplateSemanticApprovalCandidate
} from '@/lib/adapters/course-templates.adapter';
import { ApiError } from '@/lib/errors/api-error';
import type {
  ApproveTemplateSemanticAnalysisCommand,
  ApproveCredentialSemanticAnalysisCommand,
  GetCredentialSemanticApprovalCandidateCommand,
  GetTemplateSemanticApprovalCandidateCommand,
  ListCourseTemplatesCommand,
  SaveCourseTemplateFromCredentialCommand
} from '@/models/credentials';

// C3b/C5: guarda una credencial issued course o certification (nunca
// academic_subject/degree) como IssuerCourseTemplate reutilizable del issuer
// actual. No manda body: el backend deriva los campos de la credencial.
export async function saveCourseTemplateFromCredential(
  requestAuthenticated: AuthenticatedApiRequest,
  command: SaveCourseTemplateFromCredentialCommand
) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();

  if (issuerReference.length === 0 || credentialReference.length === 0) {
    throw new ApiError(
      'La referencia institucional de la credencial no es válida.',
      'http',
      400
    );
  }

  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates/from-credential/${encodeURIComponent(credentialReference)}`,
    { method: 'POST' }
  );

  return adaptCourseTemplateSummary(payload);
}

// C3c: busca templates reutilizables del issuer actual para precargar el
// formulario de creacion. Nunca crea, guarda ni modifica nada -- es un
// GET puro. No expone issuerId/createdByUserId (el adapter ya los ignora).
export async function listCourseTemplates(
  requestAuthenticated: AuthenticatedApiRequest,
  command: ListCourseTemplatesCommand
) {
  const issuerReference = command.issuerReference.trim();

  if (issuerReference.length === 0) {
    throw new ApiError(
      'La referencia institucional no es válida.',
      'http',
      400
    );
  }

  const params = new URLSearchParams();

  if (command.search !== undefined && command.search.trim().length > 0) {
    params.set('search', command.search.trim());
  }
  if (command.status !== undefined) {
    params.set('status', command.status);
  }
  if (command.credentialType !== undefined) {
    params.set('credentialType', command.credentialType);
  }

  const query = params.toString();

  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates${query ? `?${query}` : ''}`,
    { signal: command.signal }
  );

  return adaptCourseTemplateSummaryList(payload);
}

function requireApprovalReferences(command: {
  issuerReference: string;
  templateReference: string;
  semanticAnalysisReference: string;
}) {
  const issuerReference = command.issuerReference.trim();
  const templateReference = command.templateReference.trim();
  const semanticAnalysisReference = command.semanticAnalysisReference.trim();

  if (
    issuerReference.length === 0 ||
    templateReference.length === 0 ||
    semanticAnalysisReference.length === 0
  ) {
    throw new ApiError(
      'La referencia institucional del contenido reutilizable no es válida.',
      'http',
      400
    );
  }

  return { issuerReference, templateReference, semanticAnalysisReference };
}

function requireCredentialApprovalReferences(command: {
  issuerReference: string;
  credentialReference: string;
  semanticAnalysisReference: string;
}) {
  const issuerReference = command.issuerReference.trim();
  const credentialReference = command.credentialReference.trim();
  const semanticAnalysisReference = command.semanticAnalysisReference.trim();
  if (!issuerReference || !credentialReference || !semanticAnalysisReference) {
    throw new ApiError('La referencia institucional del contenido reutilizable no es válida.', 'http', 400);
  }
  return { issuerReference, credentialReference, semanticAnalysisReference };
}

function reviewBody(command: { review?: ApproveTemplateSemanticAnalysisCommand['review'] }) {
  if (!command.review) return undefined;
  return {
    reviewedAreas: command.review.reviewedAreas.map(({ label }) => ({ label })),
    reviewedSkills: command.review.reviewedSkills.map(({ label }) => ({ label })),
    reviewedConcepts: command.review.reviewedConcepts.map(({ label }) => ({ label })),
    ...(command.review.reviewNote === undefined ? {} : { reviewNote: command.review.reviewNote })
  };
}

// C4a.2: resumen seguro de una SemanticAnalysis candidata a ser aprobada,
// ANTES de aprobarla. Es un GET puro -- nunca crea, guarda ni modifica
// nada, y nunca expone el snapshot completo (ver adaptTemplateSemanticApprovalCandidate).
export async function getTemplateSemanticApprovalCandidate(
  requestAuthenticated: AuthenticatedApiRequest,
  command: GetTemplateSemanticApprovalCandidateCommand
) {
  const { issuerReference, templateReference, semanticAnalysisReference } =
    requireApprovalReferences(command);

  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates/${encodeURIComponent(templateReference)}/approved-analysis/candidate/from-semantic-analysis/${encodeURIComponent(semanticAnalysisReference)}`,
    { signal: command.signal }
  );

  return adaptTemplateSemanticApprovalCandidate(payload);
}

// C4a.2/C5: aprueba una revision humana allowlisted. El body lleva solo
// labels revisados; el backend reconstruye el snapshot v2 y nunca modifica
// la SemanticAnalysis ni la credencial original.
export async function approveTemplateSemanticAnalysis(
  requestAuthenticated: AuthenticatedApiRequest,
  command: ApproveTemplateSemanticAnalysisCommand
) {
  const { issuerReference, templateReference, semanticAnalysisReference } =
    requireApprovalReferences(command);

  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates/${encodeURIComponent(templateReference)}/approved-analysis/from-semantic-analysis/${encodeURIComponent(semanticAnalysisReference)}`,
    { method: 'POST', ...(reviewBody(command) ? { body: reviewBody(command) } : {}) }
  );

  return adaptCourseTemplateSummary(payload);
}

export async function getCredentialSemanticApprovalCandidate(
  requestAuthenticated: AuthenticatedApiRequest,
  command: GetCredentialSemanticApprovalCandidateCommand
) {
  const { issuerReference, credentialReference, semanticAnalysisReference } = requireCredentialApprovalReferences(command);
  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates/approval-candidate/from-credential/${encodeURIComponent(credentialReference)}/semantic-analysis/${encodeURIComponent(semanticAnalysisReference)}`,
    { signal: command.signal }
  );
  return adaptTemplateSemanticApprovalCandidate(payload);
}

export async function approveCredentialSemanticAnalysis(
  requestAuthenticated: AuthenticatedApiRequest,
  command: ApproveCredentialSemanticAnalysisCommand
) {
  const { issuerReference, credentialReference, semanticAnalysisReference } = requireCredentialApprovalReferences(command);
  const payload = await requestAuthenticated(
    `/issuers/${encodeURIComponent(issuerReference)}/course-templates/from-credential/${encodeURIComponent(credentialReference)}/approved-analysis/from-semantic-analysis/${encodeURIComponent(semanticAnalysisReference)}`,
    { method: 'POST', body: reviewBody(command) }
  );
  return adaptCourseTemplateSummary(payload);
}
