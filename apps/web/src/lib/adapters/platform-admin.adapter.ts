import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import { formatIntegrityDate } from '@/lib/formatters/credential-integrity';
import type {
  AdminIssuerListVM,
  AdminIssuerMembershipsVM,
  AdminIssuerVM,
  AdminMembershipVM,
  IssuerAuthorizationStatus,
  IssuerMembershipRole,
  IssuerMembershipStatus
} from '@/models/platform-admin';

/**
 * Adapters del plano de plataforma -- slice S6a, READ-ONLY.
 *
 * Mismo criterio que el resto de `lib/adapters`: se valida el payload campo
 * por campo y se lanza `IncompatiblePayloadError` con un diagnostico cuando el
 * contrato no se cumple. Nada de `as` ni de spread del DTO hacia los
 * componentes.
 *
 * POR QUE RECHAZO DURO Y NO DEGRADACION. En `holder.adapter` hay campos
 * secundarios que degradan a `null` ante un shape invalido (el provenance
 * summary, por ejemplo) para no tirar abajo el perfil entero. Aca no
 * corresponde: /admin es una superficie de DIAGNOSTICO de plataforma. Si el
 * contrato cambio y el cliente no lo entiende, mostrar una version
 * parcialmente adivinada de la realidad institucional es peor que mostrar un
 * error -- un Platform Admin podria concluir que una institucion no tiene
 * miembros cuando lo que pasa es que el cliente no supo leerlos.
 *
 * `role` y `status` en particular se rechazan ante un valor desconocido, igual
 * que `adaptRole` en `auth.adapter`: son contratos de AUTORIZACION, y adivinar
 * uno es inseguro.
 */

const authorizationStatuses = ['pending', 'authorized', 'revoked'] as const;
const membershipRoles = ['admin', 'operator', 'viewer'] as const;
const membershipStatuses = ['active', 'pending', 'revoked'] as const;

/**
 * Etiquetas de habilitacion propias de /admin.
 *
 * DELIBERADAMENTE DISTINTAS de las de `auth.adapter` ("Autorizada"), que
 * describen la membership de la persona en su propio contexto. Aca el sujeto
 * es la INSTITUCION vista desde la plataforma, y "habilitada" dice con mas
 * precision lo unico que `authorized` significa en Scope: habilitacion
 * OPERACIONAL. Ninguna de estas etiquetas afirma verificacion institucional,
 * KYB ni acreditacion, porque el sistema no modela nada de eso.
 */
const authorizationLabels: Record<IssuerAuthorizationStatus, string> = {
  authorized: 'Habilitada',
  pending: 'Pendiente de habilitación',
  revoked: 'Habilitación revocada'
};

/**
 * Mismos textos que el mapa privado de `auth.adapter`, a proposito: el rol de
 * una persona dentro de una institucion no puede llamarse distinto en /admin
 * que en el portal del emisor.
 */
const roleLabels: Record<IssuerMembershipRole, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Solo lectura'
};

const membershipStatusLabels: Record<IssuerMembershipStatus, string> = {
  active: 'Activa',
  pending: 'Pendiente',
  revoked: 'Revocada'
};

export function adaptAdminIssuerList(payload: unknown): AdminIssuerListVM {
  const response = record(payload, 'adminIssuers');

  return {
    // El ORDEN DEL BACKEND SE CONSERVA: `PlatformAdminReadService` ordena por
    // `name asc, id asc` para que la lista sea estable entre requests. El
    // cliente no reordena ni filtra.
    items: array(response.items, 'adminIssuers.items').map((value, index) =>
      adaptAdminIssuer(value, `adminIssuers.items[${index}]`)
    )
  };
}

export function adaptAdminIssuerMemberships(
  payload: unknown
): AdminIssuerMembershipsVM {
  const response = record(payload, 'adminMemberships');
  const issuer = record(response.issuer, 'adminMemberships.issuer');

  return {
    issuer: {
      issuerReference: requiredString(issuer.id, 'adminMemberships.issuer.id'),
      name: requiredString(issuer.name, 'adminMemberships.issuer.name')
    },
    // Tambien se conserva el orden del backend (`user.email asc, userId asc`).
    items: array(response.items, 'adminMemberships.items').map((value, index) =>
      adaptAdminMembership(value, `adminMemberships.items[${index}]`)
    )
  };
}

function adaptAdminIssuer(value: unknown, path: string): AdminIssuerVM {
  const issuer = record(value, path);
  const technicalIdentity = record(
    issuer.technicalIdentity,
    `${path}.technicalIdentity`
  );
  const membershipCounts = record(
    issuer.membershipCounts,
    `${path}.membershipCounts`
  );
  const catalogCounts = record(issuer.catalogCounts, `${path}.catalogCounts`);

  const authorizationStatus = enumValue(
    issuer.authorizationStatus,
    authorizationStatuses,
    `${path}.authorizationStatus`
  );
  const didConfigured = boolean(
    technicalIdentity.didConfigured,
    `${path}.technicalIdentity.didConfigured`
  );
  const walletConfigured = boolean(
    technicalIdentity.walletConfigured,
    `${path}.technicalIdentity.walletConfigured`
  );
  const readyToIssue = boolean(
    technicalIdentity.readyToIssue,
    `${path}.technicalIdentity.readyToIssue`
  );
  const active = nonNegativeInteger(
    membershipCounts.active,
    `${path}.membershipCounts.active`
  );
  const total = nonNegativeInteger(
    membershipCounts.total,
    `${path}.membershipCounts.total`
  );

  return {
    issuerReference: requiredString(issuer.id, `${path}.id`),
    name: requiredString(issuer.name, `${path}.name`),
    legalName: nullableString(issuer.legalName, `${path}.legalName`),
    authorizationStatus,
    authorizationLabel: authorizationLabels[authorizationStatus],
    technicalIdentity: {
      didConfigured,
      walletConfigured,
      readyToIssue,
      // Neutra a proposito: "Pendiente" describe un estado legitimo, no un
      // fallo. Una institucion recien provisionada por S5b vive aca.
      readinessLabel: readyToIssue ? 'Lista' : 'Pendiente'
    },
    membershipCounts: {
      active,
      total,
      summaryLabel:
        total === 0 ? 'Sin miembros' : `${active} activos de ${total}`
    },
    catalogCounts: {
      academicCourses: nonNegativeInteger(
        catalogCounts.academicCourses,
        `${path}.catalogCounts.academicCourses`
      ),
      programs: nonNegativeInteger(
        catalogCounts.programs,
        `${path}.catalogCounts.programs`
      ),
      curriculumVersions: nonNegativeInteger(
        catalogCounts.curriculumVersions,
        `${path}.catalogCounts.curriculumVersions`
      ),
      programCourses: nonNegativeInteger(
        catalogCounts.programCourses,
        `${path}.catalogCounts.programCourses`
      )
    },
    createdAtLabel: dateLabel(issuer.createdAt, `${path}.createdAt`)
  };
}

function adaptAdminMembership(value: unknown, path: string): AdminMembershipVM {
  const membership = record(value, path);
  const role = enumValue(membership.role, membershipRoles, `${path}.role`);
  const status = enumValue(
    membership.status,
    membershipStatuses,
    `${path}.status`
  );

  return {
    userReference: requiredString(membership.userId, `${path}.userId`),
    // `string | null`, contrato congelado en S3. No se convierte a `""`.
    email: nullableString(membership.email, `${path}.email`),
    displayLabel: requiredString(
      membership.displayLabel,
      `${path}.displayLabel`
    ),
    role,
    roleLabel: roleLabels[role],
    status,
    statusLabel: membershipStatusLabels[status],
    createdAtLabel: dateLabel(membership.createdAt, `${path}.createdAt`)
  };
}

// ---------------------------------------------------------------------------
// Primitivas de validacion -- mismo criterio y mismas firmas que
// `holder.adapter` / `auth.adapter`.
// ---------------------------------------------------------------------------

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'object', value);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'array', value);
  return value;
}

function requiredString(value: unknown, path: string): string {
  const normalized = nullableString(value, path);
  if (!normalized) invalid(path, 'non-empty string', value);
  return normalized;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(path, 'string or null', value);
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean', value);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(path, 'non-negative integer', value);
  }
  return value;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string
): T[number] {
  const normalized = requiredString(value, path);
  if (!allowed.includes(normalized)) {
    invalid(path, `one of: ${allowed.join(', ')}`, value);
  }
  return normalized as T[number];
}

function dateLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    invalid(path, 'ISO date string', value);
  }
  return formatIntegrityDate(value);
}

function invalid(path: string, expected: string, value: unknown): never {
  throw new IncompatiblePayloadError(
    'La respuesta de administración no cumple el contrato esperado.',
    { path, expected, actualCategory: actualCategory(value) }
  );
}

function actualCategory(value: unknown) {
  if (value === undefined) return 'missing' as const;
  if (value === null) return 'null' as const;
  if (Array.isArray(value)) return 'array' as const;
  if (typeof value === 'string') return 'string' as const;
  if (typeof value === 'number') return 'number' as const;
  if (typeof value === 'boolean') return 'boolean' as const;
  return 'object' as const;
}
