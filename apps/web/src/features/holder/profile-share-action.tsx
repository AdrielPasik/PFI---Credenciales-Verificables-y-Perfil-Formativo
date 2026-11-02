'use client';

/**
 * Entrada a la gestion de enlaces compartidos.
 *
 * ANTES ESTE BOTON CREABA UN ENLACE. Cada click producia un `SharingGrant`
 * nuevo, y como el token crudo solo existia en esa respuesta, el enlace anterior
 * quedaba sin forma de recuperarse. La QA manual termino con varios enlaces
 * activos y ninguno utilizable.
 *
 * Ahora "Compartir perfil" ABRE la gestion: ahi el holder copia el enlace que ya
 * tiene y, si de verdad quiere otro, existe una accion explicita para crearlo.
 */

import { Button } from '@/components/ui/button';
import { SHARE_MANAGEMENT_SECTION_ID } from '@/features/holder/profile-share-management';

/** `inverse`: sobre la banda de bienvenida, oscura en ambos temas. */
export function ProfileShareAction({ tone = 'default' }: { tone?: 'default' | 'inverse' }) {
  function openShareManagement() {
    const section = document.getElementById(SHARE_MANAGEMENT_SECTION_ID);
    if (!(section instanceof HTMLDetailsElement)) return;
    section.open = true;
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    section.querySelector('summary')?.focus();
  }

  return (
    <div data-testid="profile-share-action" className="min-w-0">
      <Button
        type="button"
        variant={tone === 'inverse' ? 'inverse' : 'secondary'}
        onClick={openShareManagement}
      >
        Compartir perfil
      </Button>
    </div>
  );
}
