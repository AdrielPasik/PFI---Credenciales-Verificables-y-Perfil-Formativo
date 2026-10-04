import {
  type AdminIssuerMembershipDto,
  type AdminIssuerMembershipsIssuerDto
} from './admin-issuer-memberships-response.dto';

/**
 * Respuesta de `POST /admin/issuers/:issuerId/memberships` -- slice S5a.
 *
 * REUSA EXACTAMENTE los dos DTOs de S3 en vez de declarar una tercera forma de
 * "membership administrativa". Consecuencias deliberadas:
 *
 *   - `membership.email` conserva su nullability `string | null`, congelada en
 *     S3: `User.email` es nullable en el schema, y "sin email" y "email vacio"
 *     son estados distintos. En el happy path de S5a el User elegible SIEMPRE
 *     tiene email (la resolucion lo exige), pero el contrato COMPARTIDO sigue
 *     siendo nullable y no se estrecha para acomodar este POST;
 *   - `GET /admin/issuers/:issuerId/memberships` NO cambia: este DTO solo lo
 *     reusa, con `membership` singular donde el GET tiene `items`.
 *
 * NO lleva: el AuditLog ni su id, `actorId`, nada de `PlatformAdmin`,
 * `passwordHash`/`AuthCredential`, `User.did`, `walletAddress`,
 * `onboardingIntent`, `metadata`, ni objetos Prisma completos.
 */
export interface AdminMembershipGrantResponseDto {
  issuer: AdminIssuerMembershipsIssuerDto;
  membership: AdminIssuerMembershipDto;
}
