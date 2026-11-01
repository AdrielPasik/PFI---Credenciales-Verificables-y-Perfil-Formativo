'use client';

/**
 * Guarda de abandono para formularios con cambios sin guardar.
 *
 * QUE CUBRE, mientras `dirty` es true:
 *
 *   enlaces internos      clic en cualquier <a> de la misma app: BackLink, marca,
 *                         menu de cuenta, breadcrumbs, enlaces del contenido.
 *                         Se intercepta en CAPTURA, antes de que Next navegue.
 *   botones de salida     cerrar sesion / cambiar institucion llaman a
 *                         `requestLeave(accion)`.
 *   Atras / Adelante      una entrada "centinela" duplicada en el historial: al
 *                         retroceder se sale del centinela, se lo repone y se
 *                         pregunta. El centinela copia el estado de Next para no
 *                         romper su router.
 *   recarga / cerrar      `beforeunload` (dialogo nativo del navegador).
 *
 * QUE NO HACE: preguntar cuando no hay cambios, ni interceptar la navegacion que
 * el propio formulario dispara al guardar con exito (para eso esta `release`).
 *
 * A lo sumo hay UN formulario protegido por vez en pantalla; `requestLeave` le
 * habla al que este activo y, si no hay ninguno, ejecuta la accion directamente.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { DiscardChangesDialog } from '@/components/feedback/discard-changes-dialog';

type PendingLeave =
  | { kind: 'link'; anchor: HTMLAnchorElement }
  | { kind: 'history' }
  | { kind: 'action'; run: () => void };

const GUARD_STATE_KEY = '__scopeLeaveGuard';

let activeGuard: ((pending: PendingLeave) => void) | null = null;

/** Para acciones que abandonan la pantalla sin ser un enlace. */
export function requestLeave(run: () => void): void {
  if (activeGuard) activeGuard({ kind: 'action', run });
  else run();
}

function isGuardEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[GUARD_STATE_KEY] === true
  );
}

function pushGuardEntry(): void {
  const current =
    typeof window.history.state === 'object' && window.history.state !== null
      ? (window.history.state as Record<string, unknown>)
      : {};
  window.history.pushState({ ...current, [GUARD_STATE_KEY]: true }, '', window.location.href);
}

/** El enlace de un clic que el navegador resolveria como navegacion interna. */
function internalNavigationAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor =
    event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;

  const url = new URL(anchor.href, window.location.href);
  // Externo: lo cubre `beforeunload`.
  if (url.origin !== window.location.origin) return null;
  // Ancla dentro de la misma pagina ("Saltar al contenido"): no abandona nada.
  if (
    url.hash &&
    url.pathname === window.location.pathname &&
    url.search === window.location.search
  ) {
    return null;
  }
  return anchor;
}

export interface LeaveGuardCopy {
  title: string;
  description: string;
  stayLabel: string;
  discardLabel: string;
}

export function useLeaveGuard(
  dirty: boolean,
  copy: LeaveGuardCopy
): { dialog: ReactNode; release: () => void } {
  const [pending, setPending] = useState<PendingLeave | null>(null);
  const dirtyRef = useRef(dirty);
  const releasedRef = useRef(false);
  const sentinelRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
    // Un cambio nuevo despues de un guardado vuelve a proteger.
    if (dirty) releasedRef.current = false;
  }, [dirty]);

  // Recarga o cierre de la pestaña.
  useEffect(() => {
    if (!dirty) return undefined;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (releasedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Enlaces internos y acciones registradas.
  useEffect(() => {
    if (!dirty) return undefined;
    function onClick(event: MouseEvent) {
      if (releasedRef.current) return;
      const anchor = internalNavigationAnchor(event);
      if (anchor === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ kind: 'link', anchor });
    }
    const register = (next: PendingLeave) => setPending(next);
    activeGuard = register;
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      if (activeGuard === register) activeGuard = null;
    };
  }, [dirty]);

  // Atras / Adelante del navegador.
  useEffect(() => {
    if (!dirty) return undefined;
    if (!isGuardEntry(window.history.state)) pushGuardEntry();
    sentinelRef.current = true;
    function onPopState() {
      if (releasedRef.current || !dirtyRef.current) return;
      pushGuardEntry();
      setPending({ kind: 'history' });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty]);

  // Sin cambios pendientes, el centinela sobra: se retira para que "Atras" no
  // quede inerte un paso. El listener de arriba ya no esta montado, asi que este
  // retroceso no abre el dialogo; Next lo resuelve como la misma ruta.
  useEffect(() => {
    if (dirty || !sentinelRef.current || releasedRef.current) return;
    sentinelRef.current = false;
    if (isGuardEntry(window.history.state)) window.history.back();
  }, [dirty]);

  const release = useCallback(() => {
    releasedRef.current = true;
  }, []);

  const stay = useCallback(() => setPending(null), []);

  const discard = useCallback(() => {
    const next = pending;
    setPending(null);
    releasedRef.current = true;
    if (next === null) return;
    // Con la guarda liberada, el mismo enlace vuelve a recibir el clic y navega
    // como siempre (Next Link si lo es, navegacion nativa si no).
    if (next.kind === 'link') next.anchor.click();
    // Desde el centinela repuesto: uno para salir de el, otro para la pagina
    // anterior real.
    else if (next.kind === 'history') window.history.go(-2);
    else next.run();
  }, [pending]);

  const dialog =
    pending === null ? null : (
      <DiscardChangesDialog
        title={copy.title}
        description={copy.description}
        stayLabel={copy.stayLabel}
        discardLabel={copy.discardLabel}
        onStay={stay}
        onDiscard={discard}
      />
    );

  return { dialog, release };
}
