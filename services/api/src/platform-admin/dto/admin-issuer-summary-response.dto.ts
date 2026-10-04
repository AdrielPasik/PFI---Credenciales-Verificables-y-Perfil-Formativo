import { IssuerAuthorizationStatus } from '@prisma/client';

/**
 * Proyeccion administrativa de un Issuer -- slice S3, READ-ONLY.
 *
 * ALLOWLIST EXPLICITA. Se enumera lo que SE expone; todo lo demas queda afuera
 * por construccion, no por olvido. En particular NUNCA sale de aca:
 *
 *   - el VALOR de `Issuer.did` ni de `Issuer.walletAddress` -- solo booleanos
 *     derivados (ver `AdminIssuerTechnicalIdentityDto`);
 *   - `Issuer.metadata` (campo Json libre, sin ningun lector productivo);
 *   - credenciales, evidencia, catalogo en detalle ni objetos Prisma completos.
 */
export interface AdminIssuerTechnicalIdentityDto {
  /** `Issuer.did !== null`. Nunca el valor. */
  didConfigured: boolean;
  /** `Issuer.walletAddress !== null`. Nunca el valor. */
  walletConfigured: boolean;
  /**
   * Derivado: `authorizationStatus === authorized && didConfigured &&
   * walletConfigured`.
   *
   * Es exactamente la precondicion que `IssuersService.assertIssuerCanIssue`
   * comprueba antes de emitir, proyectada para que /admin pueda mostrar
   * "identidad tecnica lista / pendiente" sin duplicar la regla en el cliente.
   *
   * NO afirma nada sobre verificacion institucional o juridica. Un issuer con
   * `readyToIssue: true` esta habilitado OPERACIONALMENTE dentro de Scope; eso
   * es todo lo que `authorized` significa en este sistema.
   */
  readyToIssue: boolean;
}

export interface AdminIssuerMembershipCountsDto {
  /** Memberships con `status: active`. Son las unicas que habilitan operar. */
  active: number;
  /** Todas las memberships del issuer, cualquiera sea su status. */
  total: number;
}

/**
 * Conteos del catalogo academico propio del issuer.
 *
 * Estan aca porque son el dato que responde "cual de estos issuers es el dueno
 * del catalogo" sin abrir una consola SQL: `AcademicCourse` y `Program` son
 * issuer-scoped directamente, y `CurriculumVersion`/`ProgramCourse` lo son de
 * forma transitiva (via `Program`).
 */
export interface AdminIssuerCatalogCountsDto {
  academicCourses: number;
  programs: number;
  curriculumVersions: number;
  programCourses: number;
}

export interface AdminIssuerSummaryDto {
  id: string;
  name: string;
  legalName: string | null;
  /**
   * Habilitacion OPERACIONAL dentro de Scope. No es una afirmacion de
   * verificacion institucional: ese concepto no esta modelado en este sistema.
   */
  authorizationStatus: IssuerAuthorizationStatus;
  technicalIdentity: AdminIssuerTechnicalIdentityDto;
  membershipCounts: AdminIssuerMembershipCountsDto;
  catalogCounts: AdminIssuerCatalogCountsDto;
  createdAt: Date;
}

export interface AdminIssuerListResponseDto {
  items: AdminIssuerSummaryDto[];
}
