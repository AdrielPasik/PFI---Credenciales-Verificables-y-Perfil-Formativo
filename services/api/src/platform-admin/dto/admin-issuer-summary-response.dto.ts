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
  /**
   * COMPATIBILIDAD (S8c9): hay `IssuerTechnicalIdentity` y su DID almacenado es
   * exactamente un did:web de ESTE issuer. Ya NO lee `Issuer.did`, que es un
   * campo legacy sin autoridad. Nunca expone el valor. No significa que toda la
   * configuracion este lista.
   */
  didConfigured: boolean;
  /**
   * COMPATIBILIDAD (S8c9): nombre historico para "la cuenta de ANCLAJE vigente
   * esta configurada estructuralmente" -- existe, es anchor, esta activa,
   * verificada y con direccion valida. Ya NO lee `Issuer.walletAddress`.
   */
  walletConfigured: boolean;
  /**
   * `administrativelyAuthorized && configurationReady &&
   * hasCredentialCapabilities`, de la readiness UNICA de S8c9. No hay una
   * segunda regla. DB/configuracion unicamente: no depende del RPC.
   */
  readyToIssue: boolean;
  /** `Issuer.authorizationStatus === authorized`. Aditivo, S8c9. */
  administrativelyAuthorized: boolean;
  /** Configuracion TECNICA coherente. No incluye autorizacion ni capacidades. */
  configurationReady: boolean;
  /** `Issuer.allowedCredentialTypes` no vacio. */
  hasCredentialCapabilities: boolean;
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
