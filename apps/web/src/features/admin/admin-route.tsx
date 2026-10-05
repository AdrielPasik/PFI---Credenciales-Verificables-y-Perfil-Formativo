'use client';

import { useEffect, useState } from 'react';

import { AdminAddMemberFlow } from '@/features/admin/admin-add-member-flow';
import { AdminCreateIssuerFlow } from '@/features/admin/admin-create-issuer-flow';
import { AdminRouteBoundary } from '@/features/admin/admin-route-boundary';
import {
  AdminIssuersView,
  type AdminIssuersLoadState,
  type AdminMembershipsLoadState,
  type AdminOpenFlow
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
 *
 * S6b SUMA LAS DOS ACCIONES ADMINISTRATIVAS, y con ellas dos cosas nuevas:
 *
 *   1. UN REFRESH QUE REPORTA SU RESULTADO. Las lecturas de S6a se disparan
 *      por efecto y por "version": sirve para cargar y para reintentar, pero
 *      es fire-and-forget, y un flujo que acaba de recibir un 201 necesita
 *      saber si el refresh posterior funciono para poder distinguir
 *      "asignado" de "asignado, pero no pudimos actualizar la vista". De ahi
 *      `refreshIssuers` / `refreshMemberships`, que hacen el GET directo y
 *      devuelven un booleano. Son un camino aparte A PROPOSITO: una mutacion
 *      confirmada no se desconfirma porque falle un GET;
 *
 *   2. EL ESTADO DE QUE FLUJO ESTA ABIERTO, que vive aca y no dentro de los
 *      flujos, porque cambiar de institucion tiene que poder cerrar el de
 *      "agregar administrador" (ver `handleSelectIssuer`).
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
  const [openFlow, setOpenFlow] = useState<AdminOpenFlow>('none');

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
  /** La institucion seleccionada, ya resuelta contra el padron cargado. */
  const selectedIssuer =
    issuersState.status === 'ready'
      ? (issuersState.issuers.find(
          (issuer) => issuer.issuerReference === selectedIssuerReference
        ) ?? null)
      : null;

  const membershipsState: AdminMembershipsLoadState = !selectedIssuerReference
    ? { status: 'idle' }
    : membershipsResult?.issuerReference === selectedIssuerReference
      ? membershipsResult.state
      : { status: 'loading' };

  function handleSelectIssuer(issuerReference: string) {
    if (issuerReference === selectedIssuerReference) return;
    setSelectedIssuerReference(issuerReference);
    // FAIL-SAFE: "Agregar administrador" se otorga sobre una institucion
    // concreta, asi que cambiar de seleccion CIERRA ese flujo en vez de
    // reapuntarlo. Nadie puede confirmar sobre B creyendo que era A. El
    // `key={selectedIssuerReference}` del componente es el segundo cerrojo:
    // aunque este reset fallara, el flujo se desmonta y pierde su estado.
    //
    // "Crear institucion" NO se cierra: es platform level y todavia no tiene
    // institucion de destino.
    setOpenFlow((flow) => (flow === 'add-member' ? 'none' : flow));
  }

  /**
   * Relee el padron. Devuelve `false` si fallo, sin tocar la seleccion.
   *
   * No reusa la logica de seleccion inicial del efecto a proposito: aca la
   * seleccion ya esta decidida (o la decide quien llama, como Flow B).
   *
   * SI FALLA, CONSERVA LA LISTA QUE YA ESTABA CARGADA. Es la diferencia clave
   * con el camino del efecto: este refresh corre DESPUES de una mutacion
   * confirmada, y reemplazar la pantalla por un error a pantalla completa
   * desmontaria el flujo -- y con el, el mensaje que le dice a la persona que
   * su asignacion SI quedo registrada. El fallo del refresh se reporta como un
   * error LOCALIZADO dentro del flujo (via el `false` que devuelve), no
   * tirando abajo la superficie entera.
   *
   * Cuando todavia no hay nada cargado (fallo el primer intento) si
   * corresponde el estado de error: no hay nada que preservar.
   */
  async function refreshIssuers(): Promise<boolean> {
    try {
      const list = await getAdminIssuersRequest(requestAuthenticated);
      setIssuersState({ status: 'ready', issuers: list.items });
      return true;
    } catch (error) {
      setIssuersState((current) =>
        current.status === 'ready' ? current : issuersErrorState(error)
      );
      return false;
    }
  }

  /** Relee las memberships de un issuer. Devuelve `false` si fallo. */
  async function refreshMemberships(
    issuerReference: string
  ): Promise<boolean> {
    try {
      const response = await getAdminIssuerMembershipsRequest(
        requestAuthenticated,
        issuerReference
      );
      setMembershipsResult({
        issuerReference,
        state: { status: 'ready', memberships: response.items }
      });
      return true;
    } catch (error) {
      setMembershipsResult({
        issuerReference,
        state: membershipsErrorState(error)
      });
      return false;
    }
  }

  /**
   * Despues de S5a: los conteos del padron cambiaron y la lista de personas
   * tambien. Se releen LAS DOS cosas del backend -- nunca se incrementa un
   * contador en el cliente. La autoridad real se vuelve a leer.
   */
  async function refreshAfterGrant(): Promise<boolean> {
    const issuersOk = await refreshIssuers();
    const membershipsOk = selectedIssuerReference
      ? await refreshMemberships(selectedIssuerReference)
      : true;
    return issuersOk && membershipsOk;
  }

  /**
   * Despues de S5b: se relee el padron PRIMERO y despues se selecciona la
   * institucion nueva, en ese orden, para que cuando quede seleccionada ya
   * exista en la lista. Las memberships del issuer nuevo las carga el efecto
   * que reacciona al cambio de seleccion, asi que no se piden dos veces.
   */
  async function refreshAfterProvision(
    issuerReference: string
  ): Promise<boolean> {
    const issuersOk = await refreshIssuers();
    setSelectedIssuerReference(issuerReference);
    return issuersOk;
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
      openFlow={openFlow}
      onOpenCreateIssuer={() => setOpenFlow('create-issuer')}
      onOpenAddMember={() => setOpenFlow('add-member')}
      renderCreateIssuerFlow={() => (
        <AdminCreateIssuerFlow
          onCreated={refreshAfterProvision}
          onRefreshIssuers={refreshIssuers}
          onClose={() => setOpenFlow('none')}
          onRevalidateSession={() => void retry()}
        />
      )}
      renderAddMemberFlow={() =>
        selectedIssuer ? (
          <AdminAddMemberFlow
            // La `key` ata el estado interno del flujo a la institucion: si la
            // seleccion cambiara, React lo desmonta y no queda ninguna
            // resolucion viva apuntando al issuer anterior.
            key={selectedIssuer.issuerReference}
            issuer={{
              issuerReference: selectedIssuer.issuerReference,
              name: selectedIssuer.name
            }}
            onGranted={refreshAfterGrant}
            onClose={() => setOpenFlow('none')}
            onRevalidateSession={() => void retry()}
          />
        ) : null
      }
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
