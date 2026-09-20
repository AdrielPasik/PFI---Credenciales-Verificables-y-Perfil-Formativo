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

import { SHARE_MANAGEMENT_SECTION_ID } from '@/features/holder/profile-share-management';

export function ProfileShareAction() {
  function openShareManagement() {
    const section = document.getElementById(SHARE_MANAGEMENT_SECTION_ID);
    if (!(section instanceof HTMLDetailsElement)) return;
    section.open = true;
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    section.querySelector('summary')?.focus();
  }

  return (
    <div data-testid="profile-share-action" className="order-1 min-w-0 lg:col-start-2 lg:row-start-1">
      <button
        type="button"
        className="w-fit rounded-control border border-border-strong px-4 py-2 text-sm font-semibold text-text-strong transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        onClick={openShareManagement}
      >
        Compartir perfil
      </button>
    </div>
  );
}
