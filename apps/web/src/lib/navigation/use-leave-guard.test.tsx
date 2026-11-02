/**
 * Guarda de abandono: cada forma de salir de un formulario con cambios.
 *
 * Los enlaces se prueban con un listener nativo en el propio <a>: si la guarda
 * intercepta en captura, ese listener no llega a ejecutarse.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HISTORY_FALLBACK_DELAY_MS,
  leaveGuardNavigation,
  requestLeave,
  useLeaveGuard
} from '@/lib/navigation/use-leave-guard';

const COPY = {
  title: '¿Salir sin guardar?',
  description: 'Vas a perder los cambios.',
  stayLabel: 'Seguir editando',
  discardLabel: 'Salir y descartar'
};

function Harness({ dirty, onNavigate }: { dirty: boolean; onNavigate: (href: string) => void }) {
  const guard = useLeaveGuard(dirty, COPY, { fallbackHref: '/wallet/objectives' });
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

  it('quedar sin cambios NO toca el historial por si solo (no compite con la app)', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = render(<Harness dirty onNavigate={onNavigate} />);
    rerender(<Harness dirty={false} onNavigate={onNavigate} />);
    rerender(<Harness dirty onNavigate={onNavigate} />);

    expect(back).not.toHaveBeenCalled();
    // Un solo centinela por montaje, aunque los cambios vayan y vuelvan.
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('Atras sin cambios (ya guardado): completa el paso pedido, sin dialogo', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = render(<Harness dirty onNavigate={onNavigate} />);
    rerender(<Harness dirty={false} onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Adelante hacia el centinela no abandona nada', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<Harness dirty onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: { __NA: true, __scopeLeaveGuard: true } })
      );
    });

    expect(back).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adopta un centinela de una visita anterior: Atras sin cambios no queda inerte', () => {
    window.history.replaceState({ __NA: true, __scopeLeaveGuard: true }, '', '/wallet/objectives/new');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<Harness dirty={false} onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });

    expect(back).toHaveBeenCalledTimes(1);
  });

  it('entrada directa por URL: si Atras no tiene a donde ir, va al padre jerarquico', () => {
    vi.useFakeTimers();
    vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const assign = vi.spyOn(leaveGuardNavigation, 'assign').mockImplementation(() => undefined);
    render(<Harness dirty onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));

    expect(assign).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(HISTORY_FALLBACK_DELAY_MS);
    });
    expect(assign).toHaveBeenCalledWith('/wallet/objectives');
    vi.useRealTimers();
  });

  it('si Atras si salio de la pagina, no hay navegacion de respaldo', () => {
    vi.useFakeTimers();
    vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const assign = vi.spyOn(leaveGuardNavigation, 'assign').mockImplementation(() => undefined);
    const { unmount } = render(<Harness dirty onNavigate={onNavigate} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salir y descartar' }));
    unmount();
    act(() => {
      vi.advanceTimersByTime(HISTORY_FALLBACK_DELAY_MS);
    });

    expect(assign).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('despues de liberar (guardado con exito) no pregunta ni toca el historial', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    function Released() {
      const guard = useLeaveGuard(true, COPY);
      return (
        <div>
          <button type="button" onClick={guard.release}>
            guardado
          </button>
          {guard.dialog}
        </div>
      );
    }
    render(<Released />);
    fireEvent.click(screen.getByRole('button', { name: 'guardado' }));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __NA: true } }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
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
