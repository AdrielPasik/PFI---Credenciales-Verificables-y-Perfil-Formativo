/**
 * Donde vive el token de sesion del verificador, en el navegador.
 *
 * `sessionStorage`, y no otra cosa:
 *
 *   URL / query / hash  quedaria en el historial y en el `Referer`
 *   localStorage        sobreviviria a la sesion del navegador sin motivo
 *   cookie              cambiaria la semantica de autoridad (viaja sola)
 *   solo estado React   se perderia en cada recarga, que es justo el caso que
 *                       este token existe para cubrir
 *
 * QUE ES Y QUE NO ES ESTO. `sessionStorage` da PERSISTENCIA acotada a la sesion
 * de navegacion, no una frontera de seguridad: una pestana nueva puede heredar
 * una copia inicial segun como se haya abierto, asi que el aislamiento entre
 * pestanas NO se usa como control de autorizacion. Las propiedades reales son:
 *
 *   - el token nunca entra en URL, query ni hash;
 *   - el token nunca entra en localStorage ni en una cookie;
 *   - el servidor solo guarda su hash, nunca el valor crudo;
 *   - el token sobrevive a una recarga de la misma sesion;
 *   - la autoridad real la valida SIEMPRE el servidor, contra el enlace padre.
 *
 * LA CLAVE NO LLEVA EL SECRETO. Ni el token de sesion ni el token del enlace se
 * escriben en el nombre de la clave: se usa una huella corta y no reversible del
 * enlace, suficiente para no mezclar dos enlaces en la misma pestana.
 */

const KEY_PREFIX = 'scope.public-analysis.';

/** FNV-1a de 32 bits. Solo desambigua enlaces; no es un control de seguridad. */
function shareFingerprint(shareToken: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < shareToken.length; index += 1) {
    hash ^= shareToken.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function requestTokenStorageKey(shareToken: string): string {
  return `${KEY_PREFIX}${shareFingerprint(shareToken)}`;
}

/** Cualquier fallo de almacenamiento (modo privado, storage bloqueado) no rompe la pagina. */
export function readStoredRequestToken(shareToken: string): string | null {
  try {
    const value = globalThis.sessionStorage?.getItem(requestTokenStorageKey(shareToken));
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function storeRequestToken(shareToken: string, requestToken: string): void {
  try {
    globalThis.sessionStorage?.setItem(requestTokenStorageKey(shareToken), requestToken);
  } catch {
    // Sin almacenamiento la sesion sigue funcionando; solo no sobrevive a una
    // recarga. No se degrada a un lugar menos seguro.
  }
}

export function clearStoredRequestToken(shareToken: string): void {
  try {
    globalThis.sessionStorage?.removeItem(requestTokenStorageKey(shareToken));
  } catch {
    // Nada que hacer.
  }
}
