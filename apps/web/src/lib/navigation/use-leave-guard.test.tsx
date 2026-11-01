/**
 * Guarda de abandono: cada forma de salir de un formulario con cambios.
 *
 * Los enlaces se prueban con un listener nativo en el propio <a>: si la guarda
 * intercepta en captura, ese listener no llega a ejecutarse.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestLeave, useLeaveGuard } from '@/lib/navigation/use-leave-guard';

const COPY = {
  title: '¿Salir sin guardar?',
  description: 'Vas a perder los cambios.',
  stayLabel: 'Seguir editando',
  discardLabel: 'Salir y descartar'
};

function Harness({ dirty, onNavigate }: { dirty: boolean; onNavigate: (href: string) => void }) {
  const guard = useLeaveGuard(dirty, COPY);
  const internalRef = useRef<HTMLAnchorElement>(null);
  const hashRef = useRef<HTMLAnchorElement>(null);
  const externalRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const anchors = [internalRef.current, hashRef.current, externalRef.current];
    const handler = (event: Event) => {
      event.preventDefault();
      onNavigate((event.currentTarget as HTMLAnchorElement).getAttribute('href') ?? '');
    };
    anchors.forEach((anchor) => anchor?.addEventListener('click', handler));
    return () => anchors.forEach((anchor) => anchor?.removeEventListener('click', handler));
  }, [onNavigate]);
  return (
    <div>
      {/* <a> crudo a proposito: la guarda debe interceptar cualquier enlace interno, sea o no un Link de Next. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a ref={internalRef} href="/wallet/objectives">Volver a objetivos</a>
      <a ref={hashRef} href="#contenido">Saltar al contenido</a>
      <a ref={externalRef} href="https://sepolia.basescan.org/tx/1">Explorador</a>
      {guard.dialog}
    </div>
  );
}

let onNavigate: ReturnType<typeof vi.fn<(href: string) => void>>;

beforeEach(() => {
  onNavigate = vi.fn<(href: string) => void>();
  window.history.replaceState({ __NA: true }, '', '/wallet/objectives/new');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLeaveGuard', () => {
  it('sin cambios no pregunta nada: el enlace navega', () => {
    render(<Harness dirty={false} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'));

    expect(onNavigate).toHaveBeenCalledWith('/wallet/objectives');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('con cambios intercepta el enlace interno y pregunta', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    // La opcion segura recibe el foco.
    expect(document.activeElement?.textContent).toBe('Seguir editando');
  });

  it('"Seguir editando" se queda: no navega y cierra el dialogo', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'));
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape tambien se queda', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('"Salir y descartar" navega al MISMO destino que se pidio', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'));
    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/wallet/objectives');
  });

  it('no intercepta un ancla de la misma pagina ni un enlace externo', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Saltar al contenido'));
    fireEvent.click(screen.getByText('Explorador'));

    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no intercepta abrir en otra pestaña (Ctrl/Cmd + clic)', () => {
    render(<Harness dirty onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Volver a objetivos'), { ctrlKey: true });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('protege recarga y cierre de pestaña solo cuando hay cambios', () => {
    const { rerender } = render(<Harness dirty onNavigate={onNavigate} />);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender(<Harness dirty={false} onNavigate={onNavigate} />);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it('Atras del navegador: repone la entrada centinela y pregunta', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(<Harness dirty onNavigate={onNavigate} />);
    // Al activarse deja un centinela que conserva el estado de Next.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ __NA: true, __scopeLeaveGuard: true });

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });

    expect(push).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Atras confirmado sale dos entradas: el centinela y la pagina actual', () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    render(<Harness dirty onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));

    expect(go).toHaveBeenCalledWith(-2);
  });

  it('al quedar sin cambios retira el centinela para que Atras no quede inerte', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = render(<Harness dirty onNavigate={onNavigate} />);
    rerender(<Harness dirty={false} onNavigate={onNavigate} />);

    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('requestLeave', () => {
  it('sin formulario protegido ejecuta la accion enseguida', () => {
    const logout = vi.fn();
    requestLeave(logout);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('con un formulario con cambios pregunta antes de ejecutarla', () => {
    const logout = vi.fn();
    render(<Harness dirty onNavigate={onNavigate} />);

    act(() => requestLeave(logout));
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
