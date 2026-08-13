'use client';

import { BookmarkPlus } from 'lucide-react';
import { useState } from 'react';


// C5: an explicit local intention, never a persistence action. The actual
// template is created/recovered only after the issuer reviews and approves an
// available semantic interpretation.
export function ReusableTemplateIntentSection() {
  const [intended, setIntended] = useState(false);
  return (
    <section className="flex items-start gap-3 rounded-card border border-border-default bg-surface-muted px-4 py-3" data-testid="reusable-template-intent">
      <BookmarkPlus aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" />
      <div className="min-w-0">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text-strong">
          <input
            type="checkbox"
            checked={intended}
            onChange={(event) => setIntended(event.target.checked)}
            className="size-4 accent-teal-700"
          />
          Guardar como reutilizable después de revisar la interpretación
        </label>
        <p className="mt-1 text-sm leading-6 text-text-muted">Podrás revisar y aprobar el contenido reutilizable luego de emitir.</p>
      </div>
    </section>
  );
}
