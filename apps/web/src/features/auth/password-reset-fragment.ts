/**
 * Lectura del token de recuperacion desde el FRAGMENTO de la URL
 * (`/reset-password#token=...`) y limpieza de la direccion visible.
 *
 * POR QUE UN FRAGMENTO. El navegador no envia el fragmento al servidor: ni a Next.js
 * en el GET de la pagina, ni a los logs de acceso, ni en `Referer`. El token solo
 * existe en el navegador. Por eso este modulo es codigo de CLIENTE puro y no hay
 * ninguna forma de que el servidor lo vea al renderizar.
 *
 * QUE NO SE HACE CON EL TOKEN: no se guarda (ni `localStorage`, ni `sessionStorage`,
 * ni cookies), no se pone en la query, no se renderiza, no se imprime y no se usa de
 * `key`. Quien lo lee lo conserva solo en memoria.
 */

export type ResetFragmentRead =
  | { kind: 'token'; token: string }
  /** No hay fragmento, o no trae un `token`. */
  | { kind: 'missing' }
  /** Trae algo, pero no tiene forma de token (o viene repetido). */
  | { kind: 'malformed' };

/**
 * Forma basica del token: caracteres base64url y un largo razonable.
 *
 * Es DELIBERADAMENTE laxa. Solo evita pedirle al backend algo evidentemente
 * invalido (vacio, enorme, con caracteres imposibles); si el backend cambiara el
 * largo del token, esta pantalla no tendria que cambiar. Si un token pasa esto pero
 * no es real, el backend responde `PASSWORD_RESET_TOKEN_INVALID`: la autoridad es
 * el, no esta regex.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,512}$/;

export function parseResetFragment(hash: string): ResetFragmentRead {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;

  if (raw.length === 0) {
    return { kind: 'missing' };
  }

  const params = new URLSearchParams(raw);
  const tokens = params.getAll('token');

  if (tokens.length === 0) {
    return { kind: 'missing' };
  }

  // Un `token` repetido es ambiguo: no se elige uno.
  if (tokens.length !== 1 || !TOKEN_SHAPE.test(tokens[0])) {
    return { kind: 'malformed' };
  }

  return { kind: 'token', token: tokens[0] };
}

interface HistoryTarget {
  history: Pick<History, 'replaceState' | 'state'>;
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
}

/**
 * Quita el fragmento de la URL visible SIN agregar una entrada al historial.
 *
 * Se usa `replaceState` pasando `history.state` TAL CUAL. El App Router de Next.js
 * guarda su estado interno de navegacion en `history.state`; reemplazarlo por
 * `null` lo perderia y romperia el Back/Forward y la sincronizacion con
 * `usePathname`. Pasarlo intacto hace que Next lo reconozca como propio y no lo
 * toque.
 *
 * Solo toca la URL si hay un fragmento: sin hash no hace nada (no genera ni siquiera
 * un `replaceState` innecesario).
 */
export function clearResetFragment(
  target: HistoryTarget = window
): void {
  if (target.location.hash.length === 0) {
    return;
  }

  const { pathname, search } = target.location;
  target.history.replaceState(target.history.state, '', `${pathname}${search}`);
}
