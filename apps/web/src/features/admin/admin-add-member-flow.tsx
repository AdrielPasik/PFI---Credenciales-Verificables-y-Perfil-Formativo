'use client';

import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  grantAdminMembershipRequest,
  resolveAdminUserRequest
} from '@/lib/api/admin-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type {
  AdminMembershipVM,
  ResolvedAdminUserVM
} from '@/models/platform-admin';

/**
 * FLOW A -- agregar un administrador institucional a un Issuer existente.
 * Slice S6b.
 *
 * ESTO OTORGA AUTORIDAD, no es un CRUD. De ahi la forma del flujo:
 *
 *     email -> resolve (S4) -> ver a quien se le va a dar acceso
 *           -> confirmar explicitamente -> grant (S5a)
 *
 * No existe el camino "email + Enter -> membership creada". La confirmacion es
 * un paso propio porque lo que se esta por hacer es darle a una persona el
 * control de una institucion.
 *
 * S4 ES CONFIRMACION VISUAL, NUNCA AUTORIDAD. No devuelve `userId` --
 * deliberadamente -- y este componente nunca transporta un identificador: lo
 * unico que viaja al grant es el EMAIL que el backend volvio a resolver. Entre
 * el resolve y el confirm la persona puede dejar de ser elegible, y en ese caso
 * S5a responde con el 404 uniforme; el flujo invalida la resolucion y vuelve al
 * paso de busqueda. Eso es precisamente lo que demuestra que S4 no autorizaba
 * nada.
 *
 * EL ROL NO SE ELIGE. S5a fija `role = admin` / `status = active` server-side.
 * No hay selector de rol, y el body no puede llevarlo.
 *
 * EL ISSUER NO PUEDE CAMBIAR POR DEBAJO. El componente recibe su issuer por
 * prop y `AdminContent` lo monta con `key={issuerReference}`, asi que cambiar
 * la seleccion desmonta este flujo en vez de reapuntarlo. El contexto de la
 * institucion esta visible en todos los pasos.
 */

interface AddMemberFlowIssuer {
  issuerReference: string;
  name: string;
}

interface AdminAddMemberFlowProps {
  issuer: AddMemberFlowIssuer;
  /**
   * Relee los datos administrativos canonicos despues de un grant confirmado.
   * Resuelve `true` si el refresh salio bien.
   *
   * Es una operacion DISTINTA de la mutacion: un 201 ya ocurrido no se
   * desconfirma porque falle un GET posterior.
   */
  onGranted: () => Promise<boolean>;
  onClose: () => void;
  onRevalidateSession: () => void;
}

type AddMemberStep =
  | { status: 'email' }
  | { status: 'resolving' }
  | { status: 'confirm'; resolved: ResolvedAdminUserVM }
  | { status: 'granting'; resolved: ResolvedAdminUserVM }
  | { status: 'granted'; membership: AdminMembershipVM; refreshFailed: boolean };

/**
 * `capability` es el 403: no es un error de datos reintentable, sino la
 * plataforma diciendo que esta sesion ya no tiene la capacidad.
 */
type FlowFeedback =
  | { kind: 'message'; message: string }
  | { kind: 'capability'; message: string };

const UNIFORM_USER_NOT_FOUND =
  'No encontramos una cuenta activa disponible para ese email. La persona debe crear su cuenta en Scope antes de poder ser asignada.';

const ALREADY_MEMBER =
  'Esta persona ya tiene una membresía asociada a esta institución.';

const CAPABILITY_LOST =
  'El servicio rechazó la operación. Si tu acceso cambió recientemente, revalidá la sesión y volvé a iniciar la acción.';

export function AdminAddMemberFlow({
  issuer,
  onGranted,
  onClose,
  onRevalidateSession
}: AdminAddMemberFlowProps) {
  const { requestAuthenticated } = useSession();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<AddMemberStep>({ status: 'email' });
  const [feedback, setFeedback] = useState<FlowFeedback | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const busy = step.status === 'resolving' || step.status === 'granting';
  const finished = step.status === 'granted';
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Si el flujo se cierra con un resolve en vuelo, el resultado tardio no
      // puede reabrirlo ni dejar a nadie "confirmable".
      mounted.current = false;
    };
  }, []);

  /**
   * ESTRATEGIA B del contrato: si el email se edita despues de resolver, la
   * resolucion se invalida INMEDIATAMENTE y el flujo vuelve al paso de
   * busqueda.
   *
   * Asi es imposible confirmar sobre una persona distinta de la que esta en
   * pantalla: el estado `confirm` siempre lleva adentro la resolucion que le
   * corresponde, y editar el input lo destruye.
   */
  function handleEmailChange(value: string) {
    setEmail(value);
    setEmailError(null);
    setFeedback(null);
    setStep((current) =>
      current.status === 'confirm' ? { status: 'email' } : current
    );
  }

  async function handleResolve() {
    if (inFlight.current || finished) return;

    const normalized = email.trim();

    if (!normalized) {
      setEmailError('Ingresá el email de la persona.');
      return;
    }

    inFlight.current = true;
    setEmailError(null);
    setFeedback(null);
    setStep({ status: 'resolving' });

    try {
      const resolved = await resolveAdminUserRequest(
        requestAuthenticated,
        normalized
      );
      if (!mounted.current) return;
      setStep({ status: 'confirm', resolved });
    } catch (error) {
      if (!mounted.current) return;
      setStep({ status: 'email' });
      setFeedback(resolveFeedback(error));
    } finally {
      inFlight.current = false;
    }
  }

  async function handleConfirm() {
    if (step.status !== 'confirm' || inFlight.current) return;

    inFlight.current = true;
    const resolved = step.resolved;
    setFeedback(null);
    setStep({ status: 'granting', resolved });

    let membership: AdminMembershipVM;

    try {
      // El email es el QUE DEVOLVIO EL BACKEND, no el del input: si alguien
      // edito el campo, el paso `confirm` ya no existiria.
      const result = await grantAdminMembershipRequest(
        requestAuthenticated,
        issuer.issuerReference,
        resolved.email
      );
      membership = result.membership;
    } catch (error) {
      // NUNCA se reintenta sola una mutacion de autoridad.
      inFlight.current = false;
      setStep(grantFailureStep(error, resolved));
      setFeedback(grantFeedback(error));
      return;
    }

    inFlight.current = false;

    // Desde aca la mutacion esta CONFIRMADA por el backend. Lo que siga puede
    // fallar, pero ya no se vuelve a enviar el POST ni se ofrece una CTA que
    // parezca intentarlo otra vez.
    const refreshed = await onGranted();
    setStep({ status: 'granted', membership, refreshFailed: !refreshed });
  }

  async function handleRetryRefresh() {
    if (step.status !== 'granted') return;
    const refreshed = await onGranted();
    setStep({ ...step, refreshFailed: !refreshed });
  }

  return (
    <Card aria-labelledby="admin-add-member-title" className="min-w-0">
      <CardContent className="grid min-w-0 gap-5 pt-5 sm:pt-6">
        <div className="min-w-0">
          <h3
            id="admin-add-member-title"
            className="text-lg font-semibold text-text-strong"
          >
            Agregar administrador
          </h3>
          {/* El contexto del issuer esta visible en TODOS los pasos. */}
          <p className="mt-1 text-sm break-words text-text-muted">
            Vas a agregar un administrador a: <strong>{issuer.name}</strong>
          </p>
        </div>

        {feedback ? (
          <div className="grid min-w-0 gap-3">
            <FeedbackAlert
              variant={feedback.kind === 'capability' ? 'warning' : 'error'}
              title={
                feedback.kind === 'capability'
                  ? 'La administración de plataforma no está disponible para esta sesión'
                  : 'No pudimos completar la acción'
              }
            >
              {feedback.message}
            </FeedbackAlert>
            {feedback.kind === 'capability' ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onRevalidateSession}
                >
                  Revalidar sesión
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {finished ? (
          <GrantedPanel
            issuerName={issuer.name}
            membership={step.membership}
            refreshFailed={step.refreshFailed}
            onRetryRefresh={() => void handleRetryRefresh()}
            onClose={onClose}
          />
        ) : (
          <>
            <TextField
              label="Email de la persona"
              type="email"
              autoComplete="off"
              value={email}
              disabled={busy}
              error={emailError ?? undefined}
              description="La persona ya debe tener una cuenta en Scope."
              onChange={(event) => handleEmailChange(event.target.value)}
            />

            {step.status === 'resolving' ? (
              <p role="status" aria-live="polite" className="text-sm text-text-muted">
                Buscando persona…
              </p>
            ) : null}

            {step.status === 'confirm' || step.status === 'granting' ? (
              <ConfirmGrantPanel
                issuerName={issuer.name}
                resolved={step.resolved}
              />
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="ghost"
                // Cancelable DURANTE el resolve a proposito: abandonar una
                // busqueda es seguro. Solo se bloquea mientras el POST esta en
                // vuelo, para no cerrar la vista justo antes del resultado.
                disabled={step.status === 'granting'}
                onClick={onClose}
              >
                Cancelar
              </Button>
              {step.status === 'confirm' || step.status === 'granting' ? (
                <Button
                  type="button"
                  // Proteccion contra doble submit: mientras el POST esta en
                  // vuelo la CTA no puede volver a disparar.
                  disabled={step.status === 'granting'}
                  onClick={() => void handleConfirm()}
                >
                  {step.status === 'granting'
                    ? 'Asignando…'
                    : 'Confirmar asignación'}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve()}
                >
                  {step.status === 'resolving' ? 'Buscando…' : 'Buscar persona'}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Lo que el PlatformAdmin tiene que mirar antes de otorgar: QUIEN, DONDE y con
 * QUE rol. Los tres juntos y explicitos, para que un grant accidental requiera
 * ignorar los tres.
 */
function ConfirmGrantPanel({
  issuerName,
  resolved
}: {
  issuerName: string;
  resolved: ResolvedAdminUserVM;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-card border border-border-strong bg-surface-muted/50 p-4">
      <p className="text-xs font-semibold tracking-wider text-text-muted uppercase">
        Persona encontrada
      </p>
      <dl className="grid min-w-0 gap-2 text-sm">
        <div className="min-w-0">
          <dt className="text-text-muted">Persona</dt>
          <dd className="font-semibold break-words text-text-strong">
            {resolved.displayLabel}
          </dd>
          <dd className="break-all text-text-muted">{resolved.email}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Institución</dt>
          <dd className="font-semibold break-words text-text-strong">
            {issuerName}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Rol que recibirá</dt>
          {/* No hay selector: S5a fija `admin` server-side. */}
          <dd className="font-semibold text-text-strong">Administrador</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Exito de la mutacion, con el fallo del refresh como un problema SEPARADO.
 *
 * Un 201 ya ocurrido no se desconfirma porque un GET posterior falle, asi que
 * aca no hay ninguna CTA que parezca reintentar la asignacion: lo unico que se
 * puede reintentar son las lecturas.
 */
function GrantedPanel({
  issuerName,
  membership,
  refreshFailed,
  onRetryRefresh,
  onClose
}: {
  issuerName: string;
  membership: AdminMembershipVM;
  refreshFailed: boolean;
  onRetryRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <FeedbackAlert variant="success" title="Administrador agregado">
        {membership.displayLabel} ya tiene acceso de administrador a{' '}
        {issuerName}.
      </FeedbackAlert>

      {refreshFailed ? (
        <div className="grid min-w-0 gap-3">
          <FeedbackAlert
            variant="warning"
            title="No pudimos actualizar la vista"
          >
            La asignación quedó registrada. Lo que falló fue volver a leer los
            datos administrativos.
          </FeedbackAlert>
          <div>
            <Button type="button" variant="secondary" onClick={onRetryRefresh}>
              Actualizar datos
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapeo de errores
// ---------------------------------------------------------------------------

/**
 * S4 UNIFORMIZA a proposito: inexistente, `pending`, `suspended`, `archived` y
 * email no elegible dan todos el mismo 404. El frontend NO los distingue --
 * hacerlo filtraria el estado de la cuenta de otra persona.
 */
function resolveFeedback(error: unknown): FlowFeedback {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return { kind: 'message', message: UNIFORM_USER_NOT_FOUND };
    }
    if (error.status === 403) {
      return { kind: 'capability', message: CAPABILITY_LOST };
    }
    if (error.status === 400) {
      return {
        kind: 'message',
        message: 'El email no tiene un formato válido.'
      };
    }
    if (error.status === 500) {
      return {
        kind: 'message',
        message: 'No pudimos resolver esa cuenta en este momento.'
      };
    }
  }

  if (error instanceof IncompatiblePayloadError) {
    return {
      kind: 'message',
      message: 'La respuesta del servicio no tiene el formato esperado.'
    };
  }

  return {
    kind: 'message',
    message: 'No pudimos resolver esa cuenta en este momento.'
  };
}

/**
 * A donde vuelve el flujo cuando el grant falla.
 *
 * 404 y 409 INVALIDAN la resolucion y mandan al paso de busqueda: en el primer
 * caso porque la persona dejo de ser elegible -- S4 nunca fue autoridad -- y en
 * el segundo porque ese par (persona, institucion) ya tiene una membership y
 * reintentar daria 409 otra vez. El 403 tambien vuelve: la accion hay que
 * reiniciarla si se recupera la capacidad.
 *
 * Un error transitorio, en cambio, CONSERVA la resolucion para que el reintento
 * sea un click y no haya que volver a tipear el email. Reintentar a mano es
 * seguro aqui porque S5a es create-only: si el POST original si habia llegado,
 * el segundo responde 409 y lo dice. (Flow B no puede permitirse lo mismo -- ver
 * `admin-create-issuer-flow.tsx`.)
 */
function grantFailureStep(
  error: unknown,
  resolved: ResolvedAdminUserVM
): AddMemberStep {
  if (error instanceof ApiError) {
    if (
      error.status === 404 ||
      error.status === 409 ||
      error.status === 403
    ) {
      return { status: 'email' };
    }
  }

  return { status: 'confirm', resolved };
}

function grantFeedback(error: unknown): FlowFeedback {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      // NO se afirma "ya es administrador": la membership existente podria ser
      // `operator`, `viewer` o estar revocada. Y no se ofrece reactivarla ni
      // modificarla -- no existe ese endpoint.
      return { kind: 'message', message: ALREADY_MEMBER };
    }
    if (error.status === 404) {
      return { kind: 'message', message: UNIFORM_USER_NOT_FOUND };
    }
    if (error.status === 403) {
      return { kind: 'capability', message: CAPABILITY_LOST };
    }
  }

  if (error instanceof IncompatiblePayloadError) {
    return {
      kind: 'message',
      message: 'La respuesta del servicio no tiene el formato esperado.'
    };
  }

  return {
    kind: 'message',
    message:
      'No pudimos completar la asignación. Podés volver a intentarlo ahora.'
  };
}
