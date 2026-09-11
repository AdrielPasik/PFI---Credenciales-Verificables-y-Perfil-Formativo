/**
 * Dialogo de objetivo original — accesibilidad.
 *
 * El smoke web de P2.3 observo que al cerrar con Escape el foco caia en
 * `document.body`. En una lista de 17 requisitos eso deja al teclado sin
 * referencia y obliga a recorrerla entera de nuevo.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ObjectiveSourceDialog } from '@/features/holder/objectives/objective-source-dialog';

const RAW = '\n## Requisitos \u{1F680}\n\n- Experiencia con Python.\n';

/** Host minimo con un disparador real, como en la pantalla de revision. */
function Host({ range }: { range?: { start: number; end: number } | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Ver en el objetivo completo
      </button>
      <button type="button">Otro control</button>
      {open ? (
        <ObjectiveSourceDialog
          rawObjectiveText={RAW}
          range={range ?? null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Abre el dialogo como lo haria un navegador.
 *
 * `fireEvent.click` NO enfoca el boton —jsdom no emula esa parte—, mientras que
 * un navegador real si lo hace al pulsarlo, y con teclado el foco ya esta ahi
 * antes de activarlo. Se enfoca explicitamente para que el test reproduzca la
 * condicion real en vez de una artificial.
 */
function openDialog(trigger?: HTMLElement) {
  const target =
    trigger ?? screen.getByRole('button', { name: 'Ver en el objetivo completo' });
  target.focus();
  fireEvent.click(target);
  return target;
}

describe('dialogo de objetivo original', () => {
  it('mueve el foco dentro del dialogo al abrirse', () => {
    render(<Host />);
    openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe(
      'Cerrar el objetivo original'
    );
  });

  it('declara semantica de dialogo modal', () => {
    render(<Host />);
    openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'objective-source-dialog-title'
    );
    expect(document.getElementById('objective-source-dialog-title')?.textContent).toBe(
      'Objetivo original'
    );
  });

  it('Escape cierra y DEVUELVE el foco al disparador', () => {
    render(<Host />);
    const trigger = openDialog();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('el boton de cerrar tambien devuelve el foco al disparador', () => {
    render(<Host />);
    const trigger = openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el objetivo original' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('devuelve el foco al disparador CONCRETO, no a cualquiera', () => {
    // Con 17 requisitos hay 17 disparadores: volver al primero seria tan inutil
    // como volver al body.
    render(
      <div>
        <Host />
        <Host />
      </div>
    );
    const triggers = screen.getAllByRole('button', {
      name: 'Ver en el objetivo completo'
    });
    openDialog(triggers[1]);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.activeElement).toBe(triggers[1]);
    expect(document.activeElement).not.toBe(triggers[0]);
  });

  it('resalta el fragmento por code points tras un caracter astral', () => {
    const points = Array.from(RAW);
    const start = points.indexOf('-');
    const end = start + 25;
    render(<Host range={{ start, end }} />);
    openDialog();

    const mark = screen.getByRole('dialog').querySelector('mark');
    expect(mark?.textContent).toBe(points.slice(start, end).join(''));
    // Con offsets UTF-16 el resaltado estaria corrido: el emoji pesa 2.
    expect(mark?.textContent).not.toBe(RAW.slice(start, end));
  });

  it('muestra el texto completo y ningun dato tecnico', () => {
    render(<Host />);
    openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Experiencia con Python.');
    for (const forbidden of ['charStart', 'charEnd', 'UNICODE_CODE_POINT', 'cand_']) {
      expect(dialog.textContent?.includes(forbidden)).toBe(false);
    }
  });
});
