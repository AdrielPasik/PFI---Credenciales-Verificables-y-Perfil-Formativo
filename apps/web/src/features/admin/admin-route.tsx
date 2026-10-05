'use client';

import { useEffect, useState } from 'react';

import { AdminRouteBoundary } from '@/features/admin/admin-route-boundary';
import {
  AdminIssuersView,
  type AdminIssuersLoadState,
  type AdminMembershipsLoadState
} from '@/features/admin/admin-issuers-view';
import {
  getAdminIssuerMembershipsRequest,
  getAdminIssuersRequest
} from '@/lib/api/admin-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';

/**
 * Orquestacion de datos de /admin -- slice S6a, READ-ONLY.
 *
 * Mismo patron que `WalletHomeContent`: `useSession()` para el
 * `requestAuthenticated`, un `useEffect` por recurso con guarda `active` en el
 * cleanup, estados como union discriminada, y una "version" que se incrementa
 * para reintentar. Ningun fetch directo, ningun manejo de token.
 *
 * DOS RECURSOS INDEPENDIENTES, A PROPOSITO:
 *
 *   - el padron de instituciones se pide UNA vez (y de nuevo solo si se
 *     reintenta explicitamente). Cambiar de institucion seleccionada NO lo
 *     vuelve a pedir;
 *   - las memberships se piden por institucion seleccionada, y su loading es
 *     local: el listado y la seleccion no desaparecen de la pantalla.
 *
 * STALE RESPONSES. Al cambiar de seleccion rapido, la respuesta de la
 * institucion anterior podria llegar DESPUES que la de la nueva y pintarse
 * como si fuera suya. Se evita con dos mecanismos complementarios: un
 * `AbortController` que cancela la request anterior en el cleanup del efecto,
 * y la guarda `active`, que ignora cualquier resolucion tardia aunque el
 * abort no haya llegado a tiempo. La guarda sola alcanzaria para la
 * correccion; el abort ademas libera la conexion.
 */

/** La seleccion vive en estado local: S6a no necesita una ruta por issuer. */
export function AdminRoute() {
  return (
    <AdminRouteBoundary>
      <AdminContent />
    </AdminRouteBoundary>
  );
}

export function AdminContent() {
  const { requestAuthenticated, retry } = useSession();
  const [issuersState, setIssuersState] = useState<AdminIssuersLoadState>({
    status: 'loading'
  });
  /**
   * El resultado de memberships va ETIQUETADO con el issuer al que pertenece.
   *
   * Asi la invariante "nunca mostrar datos del issuer anterior" es
   * ESTRUCTURAL y no depende solo de la guarda `active`: un resultado cuyo
   * `issuerReference` no es el seleccionado no se puede renderizar, porque el
   * estado derivado de abajo lo descarta. Guardar el estado "pelado" permitia,
   * al menos en teoria, pintar datos viejos durante un render intermedio.
   */
  const [membershipsResult, setMembershipsResult] = useState<{
    issuerReference: string;
    state: AdminMembershipsLoadState;
  } | null>(null);
  const [selectedIssuerReference, setSelectedIssuerReference] = useState<
    string | null
  >(null);
  const [issuersVersion, setIssuersVersion] = useState(0);
  const [membershipsVersion, setMembershipsVersion] = useState(0);

  // Padron de instituciones. NO depende de la seleccion.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void getAdminIssuersRequest(requestAuthenticated, {
      signal: controller.signal
    })
      .then((list) => {
        if (!active) return;
        setIssuersState({ status: 'ready', issuers: list.items });
        // Seleccion inicial: la primera del orden que fijo el backend. Con
        // cero instituciones no hay nada que seleccionar y queda el empty
        // state.
        setSelectedIssuerReference((current) => {
          if (list.items.length === 0) return null;
          const stillPresent = list.items.some(
            (issuer) => issuer.issuerReference === current
          );
          return stillPresent && current
            ? current
            : list.items[0].issuerReference;
        });
      })
      .catch((error) => {
        if (!active) return;
        setIssuersState(issuersErrorState(error));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [issuersVersion, requestAuthenticated]);

  // Memberships de la institucion seleccionada.
  //
  // No hay NINGUN setState sincronico en el cuerpo del efecto: el "cargando"
  // y el "sin seleccion" son estados DERIVADOS (ver `membershipsState` abajo),
  // asi que solo se escribe estado desde los callbacks de la promesa.
  useEffect(() => {
    if (!selectedIssuerReference) {
      return;
    }

    const issuerReference = selectedIssuerReference;
    let active = true;
    const controller = new AbortController();

    void getAdminIssuerMembershipsRequest(requestAuthenticated, issuerReference, {
      signal: controller.signal
    })
      .then((response) => {
        if (!active) return;
        setMembershipsResult({
          issuerReference,
          state: { status: 'ready', memberships: response.items }
        });
      })
      .catch((error) => {
        if (!active) return;
        setMembershipsResult({
          issuerReference,
          state: membershipsErrorState(error)
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [membershipsVersion, requestAuthenticated, selectedIssuerReference]);

  /**
   * Sin seleccion -> `idle`. Con seleccion pero sin un resultado PARA ESA
   * seleccion -> `loading`. Solo cuando el resultado corresponde al issuer
   * seleccionado se muestra.
   */
  const membershipsState: AdminMembershipsLoadState = !selectedIssuerReference
    ? { status: 'idle' }
    : membershipsResult?.issuerReference === selectedIssuerReference
      ? membershipsResult.state
      : { status: 'loading' };

  function handleSelectIssuer(issuerReference: string) {
    if (issuerReference === selectedIssuerReference) return;
    setSelectedIssuerReference(issuerReference);
  }

  return (
    <AdminIssuersView
      issuersState={issuersState}
      membershipsState={membershipsState}
      selectedIssuerReference={selectedIssuerReference}
      onSelectIssuer={handleSelectIssuer}
      onRetryIssuers={() => {
        setIssuersState({ status: 'loading' });
        setIssuersVersion((version) => version + 1);
      }}
      onRetryMemberships={() => {
        // Descartar el resultado anterior es lo que hace que el estado
        // derivado vuelva a `loading` mientras se reintenta.
        setMembershipsResult(null);
        setMembershipsVersion((version) => version + 1);
      }}
      // El unico "recovery" ante un 403 es revalidar la sesion por el
      // mecanismo que ya existe. Ver `CapabilityLostPanel`.
      onRevalidateSession={() => void retry()}
    />
  );
}

/**
 * Un 403 NO es un error de datos reintentable: el backend nego la capacidad de
 * plataforma, y repetir el GET volveria a dar 403. Se separa del resto para
 * que la UI ofrezca revalidar la sesion en vez de un reintento infinito.
 *
 * El 401 no llega hasta aca: `SessionProvider.requestAuthenticated` lo
 * intercepta, limpia el store y pone la sesion en `expired`.
 */
function isCapabilityDenied(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function issuersErrorState(error: unknown): AdminIssuersLoadState {
  if (isCapabilityDenied(error)) return { status: 'capability-lost' };
  return { status: 'error', message: messageFor(error) };
}

function membershipsErrorState(error: unknown): AdminMembershipsLoadState {
  if (isCapabilityDenied(error)) return { status: 'capability-lost' };
  return { status: 'error', message: messageFor(error) };
}

function messageFor(error: unknown) {
  if (error instanceof IncompatiblePayloadError) {
    return 'La información disponible no tiene el formato esperado. Intentá nuevamente más tarde.';
  }

  if (error instanceof ApiError && error.status === 404) {
    return 'No encontramos la institución solicitada.';
  }

  return 'No pudimos completar la consulta. Intentá nuevamente más tarde.';
}
