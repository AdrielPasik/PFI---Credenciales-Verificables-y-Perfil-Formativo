/**
 * Transporte del token de sesion del verificador.
 *
 * EN UN HEADER DEDICADO, NUNCA EN LA URL. El token de la solicitud es un secreto
 * portador: en el path o en la query terminaria en el historial del navegador, en
 * los logs de acceso de cualquier proxy, en el header `Referer` de la siguiente
 * navegacion y en herramientas de analitica.
 *
 * No se reusa `Authorization`: en esta API ese header transporta el JWT humano de
 * `/me`, y mezclar dos autoridades distintas en el mismo lugar invita a que un
 * guard lea una como si fuera la otra.
 *
 * El token del ENLACE sigue en el path, como ya lo esta en `/share/profile/:token`.
 * Esa convencion es previa: el enlace se comparte, y compartir es poner algo en
 * una URL. La sesion no se comparte: es del verificador que la abrio.
 */

/** En minusculas: Node normaliza los nombres de header entrantes. */
export const VERIFICATION_REQUEST_TOKEN_HEADER = 'x-verification-request-token';

export function readRequestTokenHeader(headers: Record<string, unknown>): unknown {
  const value = headers[VERIFICATION_REQUEST_TOKEN_HEADER];
  // Un header repetido llega como arreglo: es ambiguo, se trata como ausente.
  return Array.isArray(value) ? undefined : value;
}
