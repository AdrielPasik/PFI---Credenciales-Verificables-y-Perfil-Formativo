import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Regreso contextual de Scope Web.
 *
 * UN SOLO PATRON para las pantallas que no son raiz de su espacio: va ARRIBA, antes
 * del titulo, y dice A DONDE vuelve ("Volver a mis credenciales"), no solo
 * "Volver".
 *
 * `href` es SIEMPRE el padre jerarquico, fijo. No usa `router.back()`: con un
 * enlace profundo, una recarga o un historial ajeno, "atras" podria sacar a la
 * persona de Scope o llevarla a una pantalla de otro rol. Un enlace real funciona
 * igual en todos esos casos y las guardas de ruta siguen decidiendo el acceso.
 *
 * Si la pantalla tiene cambios sin guardar, la guarda de abandono intercepta el
 * clic como a cualquier otro enlace interno (`useLeaveGuard`).
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" className="w-fit">
      <Link href={href}>
        <ArrowLeft aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}
