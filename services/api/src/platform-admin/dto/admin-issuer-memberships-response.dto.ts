import { IssuerMembershipRole, IssuerMembershipStatus } from '@prisma/client';

/**
 * Memberships de un Issuer, vistas desde el plano de plataforma -- slice S3,
 * READ-ONLY.
 *
 * ALLOWLIST EXPLICITA. Nunca sale de aca: `passwordHash`, nada de
 * `AuthCredential`, `User.did`, `firstName`/`lastName` crudos, ni objetos
 * `User`/`IssuerMembership` completos.
 *
 * `displayLabel` se calcula con `buildHolderDisplayLabel`, la UNICA
 * implementacion del concepto en el repo (la misma que ya usan
 * `issuer-holder-resolution`, `issuer-credential-read` y `/auth/me`). Nunca una
 * segunda regla de "nombre + apellido" propia de /admin.
 *
 * `email` SI se expone: es el identificador con el que un Platform Admin
 * reconoce a una persona, y es el mismo campo que el plano institucional ya
 * devuelve en `POST /issuers/:issuerId/holders/resolve`. Se proyecta nullable
 * porque la columna lo es -- ver el campo.
 */
export interface AdminIssuerMembershipDto {
  userId: string;
  /**
   * `User.email` tal como esta, incluido `null`.
   *
   * `User.email` es nullable en el schema, y "sin email" y "email vacio" son
   * estados semanticamente distintos: `""` no es un email valido y mentiria
   * sobre el dato. La membership NUNCA se oculta por esto -- existe, y el
   * Platform Admin tiene que poder verla; lo que se representa con fidelidad es
   * que no hay email con el que identificar a esa persona.
   */
  email: string | null;
  /**
   * Siempre un string no vacio, incluso cuando `email` es `null`:
   * `buildHolderDisplayLabel` cae a displayName / nombre+apellido / email y,
   * si no hay ninguno, a un fallback fijo.
   */
  displayLabel: string;
  role: IssuerMembershipRole;
  status: IssuerMembershipStatus;
  createdAt: Date;
}

/** Identificacion minima del issuer consultado: solo para encabezar la lista. */
export interface AdminIssuerMembershipsIssuerDto {
  id: string;
  name: string;
}

export interface AdminIssuerMembershipsResponseDto {
  issuer: AdminIssuerMembershipsIssuerDto;
  items: AdminIssuerMembershipDto[];
}
