import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  adaptCourseTemplateSummary,
  adaptCourseTemplateSummaryList
} from '@/lib/adapters/course-templates.adapter';
import { ApiError } from '@/lib/errors/api-error';
import type {
  ListCourseTemplatesCommand,
  SaveCourseTemplateFromCredentialCommand
} from '@/models/credentials';

// C3b: guarda una credencial course o certification (nunca
// academic_subject/degree, el backend rechaza esos con 400) como
// IssuerCourseTemplate reutilizable del issuer actual. No manda body --
// el backend deriva todos los campos de la credencial ya emitida/borrador.
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
