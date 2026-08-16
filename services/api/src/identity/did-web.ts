import { type DidConfig } from '../config/did-config';

const DID_WEB_PREFIX = 'did:web:';
// A2.1: namespace elegido para identidad -- nunca CRUD de Users. El path
// resoluble resultante es /did/users/:userId/did.json (ver did.controller.ts),
// que segun la transformacion did:web (reemplazar cada '/' del path por ':')
// produce exactamente did:web:<host>:did:users:<userId>.
const DID_PATH_SEGMENTS = ['did', 'users'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unica funcion que concatena el prefijo did:web: -- ni AuthService ni
// CredentialsService ni ensureDidForUser arman este string por su cuenta
// (ver seccion "BUILD PURO DEL DID" del diseno aprobado). Deterministica:
// misma config + mismo userId -> siempre el mismo string. Nunca deriva de
// firstName/lastName/displayName/email -- unicamente de User.id, que ya es
// un UUID unico e inmutable.
export function buildDidForUser(config: DidConfig, userId: string): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error(
      `userId invalido para provisioning de DID: "${userId}" no es un UUID.`
    );
  }

  return `${DID_WEB_PREFIX}${config.host}:${DID_PATH_SEGMENTS.join(':')}:${userId}`;
}

// Usado por el resolver publico (did.controller.ts) para confirmar que un
// User.did YA PERSISTIDO corresponde exactamente al :userId solicitado en
// la ruta, sin recalcular contra la configuracion ACTUAL (PUBLIC_DID_BASE_URL
// pudo cambiar desde que el DID fue provisionado -- User.did es la unica
// autoridad, ver seccion "RESOLVER Y WRITE-ONCE" del diseno). Tambien actua
// como filtro defensivo: nunca sirve un documento para un did:example, un
// DID de otro metodo, o un did:web cuyo identificador especifico de metodo
// no termine exactamente en :did:users:<userId>.
export function isDidForUserPath(did: string, userId: string): boolean {
  const suffix = `:${DID_PATH_SEGMENTS.join(':')}:${userId}`;

  if (!did.startsWith(DID_WEB_PREFIX) || !did.endsWith(suffix)) {
    return false;
  }

  const host = did.slice(DID_WEB_PREFIX.length, did.length - suffix.length);

  return host.length > 0 && !host.includes(':');
}
