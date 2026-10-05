import {
  adaptAdminIssuerList,
  adaptAdminIssuerMemberships,
  adaptAdminIssuerProvisionResult,
  adaptAdminMembershipGrantResult,
  adaptResolvedAdminUser
} from '@/lib/adapters/platform-admin.adapter';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';

/**
 * Cliente del plano de plataforma -- slices S6a (lecturas) y S6b (acciones).
 *
 * Mismo patron exacto que `holder-api.ts` / `credentials-api.ts`: funciones
 * libres que reciben el `AuthenticatedApiRequest` del `SessionProvider`,
 * delegan en `ApiClient` (que pone el `Authorization: Bearer`, mapea estados
 * HTTP a `ApiError` y nunca serializa headers en un error) y devuelven view
 * models ya adaptados. Ningun componente hace `fetch` ni toca el token.
 *
 * ESTE MODULO ES LA SUPERFICIE COMPLETA de /admin contra el backend, y en S6b
 * pasa de ser lectura pura a una MUTATION SURFACE EXPLICITAMENTE ALLOWLISTED:
 *
 *   GET   /admin/issuers
 *   GET   /admin/issuers/:issuerId/memberships
 *   POST  /admin/users/resolve                        (S4)
 *   POST  /admin/issuers/:issuerId/memberships        (S5a)
 *   POST  /admin/issuers                              (S5b)
 *
 * Cinco, y nada mas. Sin PUT, sin PATCH, sin DELETE, y sin ningun otro path
 * bajo /admin. Eso lo congela `admin-api.test.ts`, que ademas comprueba que
 * los bodies sean exactamente los tres campos permitidos y que ningun archivo
 * de /admin mencione claves de autoridad o de identidad tecnica.
 *
 * LA AUTORIDAD NO ESTA ACA. Que estas funciones existan no autoriza nada:
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

// ---------------------------------------------------------------------------
// S6b -- MUTACIONES
//
// NINGUNA DE LAS DOS MUTACIONES ACEPTA `AbortSignal`, y es deliberado. Abortar
// un POST no cancela nada en el servidor: deja al cliente sin saber si la
// operacion ocurrio, que es exactamente la ambiguedad que hay que evitar
// cuando lo que se escribe es autoridad institucional. El `resolve` SI lo
// acepta, porque no muta nada y abandonarlo es seguro.
// ---------------------------------------------------------------------------

/**
 * `POST /admin/users/resolve` (S4) -- confirmacion visual previa, NUNCA
 * autoridad.
 *
 * Devuelve `{ email, displayLabel }` y NADA mas: sin `userId`, a proposito.
 * Lo que el PlatformAdmin ve aca sirve para reconocer a la persona antes de
 * otorgarle acceso; la decision real la toma el backend, que vuelve a resolver
 * el email cuando se ejecuta el grant. Entre este resolve y esa ejecucion la
 * persona puede dejar de ser elegible.
 */
export async function resolveAdminUserRequest(
  request: AuthenticatedApiRequest,
  email: string,
  options: { signal?: AbortSignal } = {}
) {
  return adaptResolvedAdminUser(
    await request('/admin/users/resolve', {
      method: 'POST',
      body: { email },
      signal: options.signal
    })
  );
}

/**
 * `POST /admin/issuers/:issuerId/memberships` (S5a) -- otorga autoridad admin
 * sobre una institucion existente.
 *
 * El body lleva UN campo: `userEmail`. Nunca `userId`, nunca `role`, nunca
 * `status`, nunca `issuerId` (sale del path). El backend fija
 * `role = admin` / `status = active` y rechaza con 400 cualquier intento de
 * proponerlos.
 *
 * CREATE-ONLY: si ya existe cualquier membership para ese par (persona,
 * institucion) -- activa, pendiente o revocada -- responde 409 y no escribe
 * nada. No hay reactivacion ni update, ni aca ni en el backend.
 */
export async function grantAdminMembershipRequest(
  request: AuthenticatedApiRequest,
  issuerReference: string,
  userEmail: string
) {
  const reference = issuerReference.trim();

  if (!reference) {
    throw new Error('La referencia de institución no es válida.');
  }

  return adaptAdminMembershipGrantResult(
    await request(
      `/admin/issuers/${encodeURIComponent(reference)}/memberships`,
      { method: 'POST', body: { userEmail } }
    )
  );
}

/**
 * `POST /admin/issuers` (S5b) -- da de alta una institucion con su primer
 * administrador.
 *
 * El body lleva EXACTAMENTE tres campos. El servidor fija
 * `authorizationStatus = authorized` y `authorizedAt`, y la institucion nace
 * con `did = null` / `walletAddress = null`: habilitada para operar dentro de
 * Scope, todavia no lista para emitir.
 *
 * NO ES IDEMPOTENTE, y el schema no tiene unique sobre `name` ni `legalName`:
 * dos llamadas crean dos instituciones. Por eso esta operacion NUNCA se
 * reintenta automaticamente.
 */
export async function provisionAdminIssuerRequest(
  request: AuthenticatedApiRequest,
  command: { name: string; legalName: string; initialAdminUserEmail: string }
) {
  return adaptAdminIssuerProvisionResult(
    await request('/admin/issuers', {
      method: 'POST',
      body: {
        name: command.name,
        legalName: command.legalName,
        initialAdminUserEmail: command.initialAdminUserEmail
      }
    })
  );
}
