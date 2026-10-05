import {
  adaptAdminIssuerList,
  adaptAdminIssuerMemberships
} from '@/lib/adapters/platform-admin.adapter';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';

/**
 * Cliente del plano de plataforma -- slice S6a, READ-ONLY.
 *
 * Mismo patron exacto que `holder-api.ts` / `credentials-api.ts`: funciones
 * libres que reciben el `AuthenticatedApiRequest` del `SessionProvider`,
 * delegan en `ApiClient` (que pone el `Authorization: Bearer`, mapea estados
 * HTTP a `ApiError` y nunca serializa headers en un error) y devuelven view
 * models ya adaptados. Ningun componente hace `fetch` ni toca el token.
 *
 * ESTE MODULO ES LA SUPERFICIE COMPLETA de /admin contra el backend. S6a es
 * lectura pura: NO existe ninguna funcion que llame a
 * `POST /admin/users/resolve`, `POST /admin/issuers/:issuerId/memberships` ni
 * `POST /admin/issuers`. Esos tres endpoints existen desde S4/S5a/S5b y
 * pertenecen a S6b. Que no esten aca es una propiedad congelada por
 * `admin-api.read-only.test.ts`, no un olvido.
 *
 * LA AUTORIDAD NO ESTA ACA. Que estas dos funciones existan no autoriza nada:
 * cada request pasa por `AuthGuard` + `PlatformAdminGuard`, que releen la
 * tabla `PlatformAdmin` server-side. Un cliente que las invoque sin la
 * capacidad recibe 403.
 */

/** `GET /admin/issuers` -- el padron completo de instituciones. */
export async function getAdminIssuersRequest(
  request: AuthenticatedApiRequest,
  options: { signal?: AbortSignal } = {}
) {
  return adaptAdminIssuerList(
    await request('/admin/issuers', { signal: options.signal })
  );
}

/**
 * `GET /admin/issuers/:issuerId/memberships` -- quien tiene acceso a una
 * institucion, en cualquier estado.
 *
 * `signal` existe para que un cambio rapido de seleccion pueda abandonar la
 * request anterior: sin eso, la respuesta de un issuer podria pintarse como si
 * fuera la del issuer recien seleccionado.
 */
export async function getAdminIssuerMembershipsRequest(
  request: AuthenticatedApiRequest,
  issuerReference: string,
  options: { signal?: AbortSignal } = {}
) {
  const reference = issuerReference.trim();

  if (!reference) {
    throw new Error('La referencia de institución no es válida.');
  }

  return adaptAdminIssuerMemberships(
    await request(
      `/admin/issuers/${encodeURIComponent(reference)}/memberships`,
      { signal: options.signal }
    )
  );
}
