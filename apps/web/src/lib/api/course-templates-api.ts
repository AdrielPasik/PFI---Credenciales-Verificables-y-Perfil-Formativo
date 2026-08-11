import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import { adaptCourseTemplateSummary } from '@/lib/adapters/course-templates.adapter';
import { ApiError } from '@/lib/errors/api-error';
import type { SaveCourseTemplateFromCredentialCommand } from '@/models/credentials';

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
