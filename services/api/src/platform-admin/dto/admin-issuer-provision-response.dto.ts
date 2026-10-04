import { IssuerAuthorizationStatus } from '@prisma/client';

import { type AdminIssuerMembershipDto } from './admin-issuer-memberships-response.dto';
import { type AdminIssuerTechnicalIdentityDto } from './admin-issuer-summary-response.dto';

/**
 * Respuesta de `POST /admin/issuers` -- slice S5b.
 *
 * REUSA DOS FRAGMENTOS CONGELADOS DE S3, sin tocarlos:
 *
 *   - `AdminIssuerTechnicalIdentityDto` para `technicalIdentity`. Es
 *     exactamente el mismo concepto y exactamente los mismos tres booleanos
 *     derivados que ya devuelve `GET /admin/issuers`; declarar una segunda
 *     forma de "identidad tecnica" habilitaria que las dos se desincronicen;
 *   - `AdminIssuerMembershipDto` para `initialAdminMembership`. Sus seis campos
 *     (`userId`, `email`, `displayLabel`, `role`, `status`, `createdAt`) son
 *     justo los que corresponde devolver del primer admin.
 *
 * `initialAdminMembership.email` CONSERVA su nullability `string | null`,
 * congelada en S3 y reafirmada en S5a. En el happy path de S5b el User elegible
 * SIEMPRE tiene email -- la resolucion lo exige -- pero el contrato COMPARTIDO
 * sigue siendo nullable y no se estrecha para acomodar este POST. Tampoco se
 * introduce `null -> ""`: "sin email" y "email vacio" son estados
 * semanticamente distintos.
 *
 * `GET /admin/issuers`, `GET /admin/issuers/:issuerId/memberships` y
 * `POST /admin/issuers/:issuerId/memberships` NO cambian: S5b solo reusa.
 *
 * NO LLEVA: ningun AuditLog ni su id, `actorId`, nada de `PlatformAdmin`, el
 * VALOR de `did` ni de `walletAddress` (solo los booleanos derivados),
 * `Issuer.metadata`, `revokedAt`, `authorizedAt`, `passwordHash`/
 * `AuthCredential`, `User.did`, `onboardingIntent`, ni objetos Prisma
 * completos.
 */
export interface AdminProvisionedIssuerDto {
  id: string;
  name: string;
  /**
   * `Issuer.legalName` tal como quedo persistido, incluido el tipo `null`.
   *
   * La columna es nullable y `AdminIssuerSummaryDto` ya la proyecta asi desde
   * S3; estrechar el tipo aqui crearia dos verdades sobre el mismo campo. En
   * este camino el validador exige un valor no vacio, asi que en la practica
   * nunca es `null` -- pero el TIPO sigue el schema, no el happy path.
   */
  legalName: string | null;
  /**
   * Siempre `authorized` para un issuer recien provisionado.
   *
   * Habilitacion OPERACIONAL dentro de Scope, y nada mas: no afirma que la
   * institucion este verificada, acreditada, validada externamente ni que haya
   * pasado ningun KYB. Ese concepto no esta modelado en este sistema.
   */
  authorizationStatus: IssuerAuthorizationStatus;
  /**
   * Para un issuer recien creado: `didConfigured: false`,
   * `walletConfigured: false` y por lo tanto `readyToIssue: false`.
   *
   * ES EL PUNTO IMPORTANTE DEL CONTRATO: `authorized` operacionalmente NO
   * significa listo tecnicamente para emitir. La regla real
   * (`IssuersService.assertIssuerCanIssue`) exige authorized + walletAddress +
   * did, y sigue fallando closed para este issuer -- lo que verifica
   * `__guards__/provisioned-issuer-cannot-issue.test.ts`.
   */
  technicalIdentity: AdminIssuerTechnicalIdentityDto;
  createdAt: Date;
}

export interface AdminIssuerProvisionResponseDto {
  issuer: AdminProvisionedIssuerDto;
  initialAdminMembership: AdminIssuerMembershipDto;
}
