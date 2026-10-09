import { type DidConfig } from '../config/did-config';

const DID_WEB_PREFIX = 'did:web:';
// S8c3: namespace de identidad TECNICA del issuer, en su propio plano y
// separado del de holders (`did:users`). La ruta resoluble resultante es
// /did/issuers/:issuerId/did.json, que segun la transformacion did:web
// (reemplazar cada ':' del identificador especifico de metodo, salvo el host,
// por '/') produce exactamente did:web:<host>:did:issuers:<issuerId>.
const DID_PATH_SEGMENTS = ['did', 'issuers'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unica funcion que concatena el prefijo did:web: para un issuer -- mismo
// criterio que `buildDidForUser`. Deterministica: misma config + mismo
// issuerId -> siempre el mismo string. Nunca deriva de name/legalName/
// walletAddress/metadata, unicamente de Issuer.id, que ya es un UUID unico e
// inmutable.
//
// S8c3 NO escribe DIDs: el aprovisionamiento es fuera de banda. Esta funcion
// existe para que la ruta publica y el DID almacenado puedan compararse contra
// UNA sola definicion, y para que el test de ida y vuelta did:web use la
// implementacion real en vez de un string escrito a mano.
export function buildDidForIssuer(config: DidConfig, issuerId: string): string {
  if (!UUID_PATTERN.test(issuerId)) {
    throw new Error(
      `issuerId invalido para un DID de issuer: "${issuerId}" no es un UUID.`
    );
  }

  return `${DID_WEB_PREFIX}${config.host}:${DID_PATH_SEGMENTS.join(':')}:${issuerId}`;
}

// Usado por el resolver publico (issuer-did.controller.ts) para confirmar que
// un `IssuerTechnicalIdentity.did` YA PERSISTIDO corresponde exactamente al
// :issuerId solicitado en la ruta, SIN recalcularlo contra la configuracion
// ACTUAL (`PUBLIC_DID_BASE_URL` pudo cambiar desde que el DID fue
// aprovisionado -- el DID almacenado es la unica autoridad).
//
// Tambien actua como filtro defensivo: nunca sirve un documento para un
// did:example legacy, para un DID de otro metodo, para un DID del plano de
// holders (`:did:users:`), o para un did:web cuyo identificador especifico de
// metodo no termine exactamente en :did:issuers:<issuerId>.
export function isDidForIssuerPath(did: string, issuerId: string): boolean {
  const suffix = `:${DID_PATH_SEGMENTS.join(':')}:${issuerId}`;

  if (!did.startsWith(DID_WEB_PREFIX) || !did.endsWith(suffix)) {
    return false;
  }

  const host = did.slice(DID_WEB_PREFIX.length, did.length - suffix.length);

  return host.length > 0 && !host.includes(':');
}

// S8c9: URL del Documento DID de un issuer, derivada del DID ALMACENADO por la
// transformacion did:web -- la misma que define la ruta de arriba. No hay una
// segunda regla de base URL: el host sale del propio DID (con `%3A` decodificado
// a `:`, segun la especificacion), y el camino es el de la ruta publica.
//
// Devuelve null si el DID no corresponde exactamente a ESTE issuer: nunca se
// arma un link a un documento que el endpoint publico rechazaria.
export function issuerDidDocumentUrl(
  did: string,
  issuerId: string
): string | null {
  if (!isDidForIssuerPath(did, issuerId)) {
    return null;
  }

  const suffix = `:${DID_PATH_SEGMENTS.join(':')}:${issuerId}`;
  const host = did
    .slice(DID_WEB_PREFIX.length, did.length - suffix.length)
    .replace(/%3A/gi, ':');

  return `https://${host}/${DID_PATH_SEGMENTS.join('/')}/${issuerId}/did.json`;
}
