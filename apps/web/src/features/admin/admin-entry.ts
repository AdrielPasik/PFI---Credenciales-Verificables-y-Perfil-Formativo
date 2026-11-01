/**
 * Desde donde se entro a Administracion de plataforma, y a donde se vuelve.
 *
 * `/` NO sirve como regreso: el router de contexto manda a quien tiene una
 * membresia institucional siempre al panel del emisor, aunque haya entrado a
 * Administracion desde su espacio personal.
 *
 * El origen viaja como `?from=` con un valor CERRADO, nunca como una URL: se
 * traduce a una ruta fija de esta tabla, asi que no hay redireccion abierta
 * posible. Cualquier otro valor, o ninguno, cae en el espacio personal, al que
 * accede todo usuario autenticado. Las guardas de cada ruta siguen decidiendo el
 * acceso real.
 */

export const ADMIN_ENTRIES = ['wallet', 'issuer', 'pending'] as const;
export type AdminEntry = (typeof ADMIN_ENTRIES)[number];

export interface AdminReturnDestination {
  href: string;
  label: string;
}

const DESTINATIONS: Record<AdminEntry, AdminReturnDestination> = {
  wallet: { href: '/wallet', label: 'Volver a mi espacio personal' },
  issuer: { href: '/issuer', label: 'Volver al panel del emisor' },
  pending: { href: '/institutional-access-pending', label: 'Volver a mi acceso institucional' }
};

/** Sin origen conocido no se "vuelve": se ofrece ir a un lugar seguro. */
const DEFAULT_DESTINATION: AdminReturnDestination = {
  href: '/wallet',
  label: 'Ir a mi espacio personal'
};

export function parseAdminEntry(raw: unknown): AdminEntry | null {
  return typeof raw === 'string' && (ADMIN_ENTRIES as readonly string[]).includes(raw)
    ? (raw as AdminEntry)
    : null;
}

export function adminReturnDestination(entry: AdminEntry | null): AdminReturnDestination {
  return entry === null ? DEFAULT_DESTINATION : DESTINATIONS[entry];
}

export function adminHrefFrom(entry: AdminEntry): string {
  return `/admin?from=${entry}`;
}
