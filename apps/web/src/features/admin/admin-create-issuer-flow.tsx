'use client';

import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  provisionAdminIssuerRequest,
  resolveAdminUserRequest
} from '@/lib/api/admin-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type {
  AdminIssuerProvisionResultVM,
  ResolvedAdminUserVM
} from '@/models/platform-admin';

/**
 * FLOW B -- crear una institucion con su primer administrador. Slice S6b.
 *
 * ES UNA OPERACION DE PLATAFORMA, no institucional: no depende del issuer
 * seleccionado, y cambiar la seleccion mientras este flujo esta abierto no
 * altera nada, porque la institucion todavia no existe.
 *
 * ESTA ES LA UNICA PUERTA DE ALTA DE INSTITUCIONES EN TODO SCOPE. No hay
 * autoservicio: una persona que eligio intencion `institutional` en el signup
 * sigue esperando en `/institutional-access-pending` hasta que un PlatformAdmin
 * ejecute esto. S6b no agrega ninguna accion de alta en `register`, `login`,
 * esa pantalla ni `ContextRouter`.
 *
 *     name + legalName + email -> resolve (S4) -> confirmar -> provision (S5b)
 *
 * NO ES IDEMPOTENTE, y el schema deliberadamente NO tiene unique sobre `name`
 * ni `legalName`: dos POST crean dos instituciones. De ahi la diferencia
 * importante con Flow A -- ante un fallo AMBIGUO (red, 5xx) este flujo NO
 * vuelve a ofrecer "Crear institución". Pasa a un estado donde lo unico
 * disponible es releer el padron, porque el POST pudo haber llegado.
 *
 * Y TAMPOCO SE INVENTA UNICIDAD EN EL CLIENTE: no se busca el nombre en el
 * listado para bloquear duplicados. Seria una constraint falsa (con carrera) y
 * ademas asumiria que dos nombres iguales son la misma entidad, que es falso.
 */

interface AdminCreateIssuerFlowProps {
  /**
   * Relee el padron y selecciona la institucion recien creada. Resuelve `true`
   * si el refresh salio bien.
   */
  onCreated: (issuerReference: string) => Promise<boolean>;
  /** Relee el padron sin seleccionar nada: para el caso ambiguo. */
  onRefreshIssuers: () => Promise<boolean>;
  onClose: () => void;
  onRevalidateSession: () => void;
}

type CreateIssuerStep =
  | { status: 'form' }
  | { status: 'resolving' }
  | { status: 'confirm'; resolved: ResolvedAdminUserVM }
  | { status: 'creating'; resolved: ResolvedAdminUserVM }
  | {
      status: 'created';
      result: AdminIssuerProvisionResultVM;
      refreshFailed: boolean;
    }
  /**
   * El POST salio pero no sabemos si llego. NO hay CTA de creacion aca: solo
   * releer el padron. Afirmar que no se creo nada seria tan incorrecto como
   * reintentar.
   */
  | { status: 'ambiguous' };

type FlowFeedback =
  | { kind: 'message'; message: string }
  | { kind: 'capability'; message: string };

const UNIFORM_USER_NOT_FOUND =
  'No encontramos una cuenta activa disponible para ese email. La persona debe crear su cuenta en Scope antes de poder ser asignada.';

const CAPABILITY_LOST =
  'El servicio rechazó la operación. Si tu acceso cambió recientemente, revalidá la sesión y volvé a iniciar la acción.';

export function AdminCreateIssuerFlow({
  onCreated,
  onRefreshIssuers,
  onClose,
  onRevalidateSession
}: AdminCreateIssuerFlowProps) {
  const { requestAuthenticated } = useSession();
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<CreateIssuerStep>({ status: 'form' });
  const [feedback, setFeedback] = useState<FlowFeedback | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    legalName?: string;
    email?: string;
  }>({});

  const busy = step.status === 'resolving' || step.status === 'creating';
  const closed = step.status === 'created' || step.status === 'ambiguous';

  /**
   * CERROJO SINCRONICO CONTRA DOBLE SUBMIT.
   *
   * `disabled` y un flag derivado del estado NO alcanzan: varios clicks en el
   * MISMO tick ven el estado anterior, porque `setStep` es asincronico. Un ref
   * se lee y se escribe sincronicamente.
   *
   * Aca es CRITICO: `POST /admin/issuers` no es idempotente y el schema no
   * tiene unique sobre `name`, asi que un doble click sin cerrojo crearia DOS
   * instituciones indistinguibles.
   */
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Cambiar el EMAIL invalida la resolucion: no se puede confirmar usando una
   * resolucion que corresponde a otra persona.
   */
  function handleEmailChange(value: string) {
    setEmail(value);
    setFieldErrors((current) => ({ ...current, email: undefined }));
    setFeedback(null);
    setStep((current) =>
      current.status === 'confirm' ? { status: 'form' } : current
    );
  }

  /**
   * Cambiar `name`/`legalName` NO invalida la resolucion: no tienen nada que
   * ver con quien es la persona. Se reflejan en la confirmacion tal cual.
   */
  function handleNameChange(value: string) {
    setName(value);
    setFieldErrors((current) => ({ ...current, name: undefined }));
  }

  function handleLegalNameChange(value: string) {
    setLegalName(value);
    setFieldErrors((current) => ({ ...current, legalName: undefined }));
  }

  async function handleResolve() {
    if (inFlight.current || closed) return;

    const errors: typeof fieldErrors = {};
    if (!name.trim()) errors.name = 'Ingresá el nombre de la institución.';
    if (!legalName.trim()) errors.legalName = 'Ingresá la razón social.';
    if (!email.trim()) {
      errors.email = 'Ingresá el email del primer administrador.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    inFlight.current = true;
    setFieldErrors({});
    setFeedback(null);
    setStep({ status: 'resolving' });

    try {
      const resolved = await resolveAdminUserRequest(
        requestAuthenticated,
        email.trim()
      );
      if (!mounted.current) return;
      setStep({ status: 'confirm', resolved });
    } catch (error) {
      if (!mounted.current) return;
      setStep({ status: 'form' });
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
    setStep({ status: 'creating', resolved });

    let result: AdminIssuerProvisionResultVM;

    try {
      result = await provisionAdminIssuerRequest(requestAuthenticated, {
        name: name.trim(),
        legalName: legalName.trim(),
        // El email que devolvio el backend, no el del input.
        initialAdminUserEmail: resolved.email
      });
    } catch (error) {
      // NUNCA un reintento automatico de este POST.
      inFlight.current = false;
      const next = createFailureStep(error, resolved);
      setStep(next);
      // En el caso ambiguo el panel ya explica la situacion y que hacer;
      // apilarle encima una alerta de error diria dos cosas distintas sobre
      // el mismo hecho.
      setFeedback(next.status === 'ambiguous' ? null : createFeedback(error));
      return;
    }

    inFlight.current = false;

    // 201: la institucion existe. Lo que siga puede fallar sin desconfirmarla.
    const refreshed = await onCreated(result.issuer.issuerReference);
    setStep({ status: 'created', result, refreshFailed: !refreshed });
  }

  async function handleRetryRefresh() {
    if (step.status !== 'created') return;
    const refreshed = await onCreated(step.result.issuer.issuerReference);
    setStep({ ...step, refreshFailed: !refreshed });
  }

  return (
    <Card aria-labelledby="admin-create-issuer-title" className="min-w-0">
      <CardContent className="grid min-w-0 gap-5 pt-5 sm:pt-6">
        <div className="min-w-0">
          <h2
            id="admin-create-issuer-title"
            className="text-lg font-semibold text-text-strong"
          >
            Crear institución
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            El primer administrador debe tener ya una cuenta en Scope.
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

        {step.status === 'ambiguous' ? (
          <AmbiguousCreatePanel
            onRefreshIssuers={() => void onRefreshIssuers()}
            onClose={onClose}
          />
        ) : null}

        {step.status === 'created' ? (
          <CreatedPanel
            result={step.result}
            refreshFailed={step.refreshFailed}
            onRetryRefresh={() => void handleRetryRefresh()}
            onClose={onClose}
          />
        ) : null}

        {!closed ? (
          <>
            <TextField
              label="Nombre"
              autoComplete="off"
              value={name}
              disabled={busy}
              error={fieldErrors.name}
              onChange={(event) => handleNameChange(event.target.value)}
            />
            <TextField
              label="Razón social"
              autoComplete="off"
              value={legalName}
              disabled={busy}
              error={fieldErrors.legalName}
              onChange={(event) => handleLegalNameChange(event.target.value)}
            />
            <TextField
              label="Email del primer administrador"
              type="email"
              autoComplete="off"
              value={email}
              disabled={busy}
              error={fieldErrors.email}
              onChange={(event) => handleEmailChange(event.target.value)}
            />

            {step.status === 'resolving' ? (
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-text-muted"
              >
                Buscando persona…
              </p>
            ) : null}

            {step.status === 'confirm' || step.status === 'creating' ? (
              <ConfirmCreatePanel
                name={name.trim()}
                legalName={legalName.trim()}
                resolved={step.resolved}
              />
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="ghost"
                // Cancelable DURANTE el resolve: abandonar una busqueda es
                // seguro. Solo se bloquea mientras el POST esta en vuelo.
                disabled={step.status === 'creating'}
                onClick={onClose}
              >
                Cancelar
              </Button>
              {step.status === 'confirm' || step.status === 'creating' ? (
                <Button
                  type="button"
                  disabled={step.status === 'creating'}
                  onClick={() => void handleConfirm()}
                >
                  {step.status === 'creating'
                    ? 'Creando…'
                    : 'Crear institución'}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResolve()}
                >
                  {step.status === 'resolving'
                    ? 'Buscando…'
                    : 'Buscar administrador'}
                </Button>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Lo que se va a crear, antes de crearlo. Lo que no puede faltar es QUIEN
 * queda al mando.
 *
 * El estado inicial se anuncia aca para que no sorprenda despues: habilitada
 * para operar, pero sin identidad tecnica y por lo tanto todavia no lista para
 * emitir. "Habilitada" nunca significa verificada ni acreditada.
 */
function ConfirmCreatePanel({
  name,
  legalName,
  resolved
}: {
  name: string;
  legalName: string;
  resolved: ResolvedAdminUserVM;
}) {
  return (
    <div className="grid min-w-0 gap-3 rounded-card border border-border-strong bg-surface-muted/50 p-4">
      <p className="text-xs font-semibold tracking-wider text-text-muted uppercase">
        Nueva institución
      </p>
      <dl className="grid min-w-0 gap-2 text-sm">
        <div className="min-w-0">
          <dt className="text-text-muted">Nombre</dt>
          <dd className="font-semibold break-words text-text-strong">{name}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Razón social</dt>
          <dd className="font-semibold break-words text-text-strong">
            {legalName}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Primer administrador</dt>
          <dd className="font-semibold break-words text-text-strong">
            {resolved.displayLabel}
          </dd>
          <dd className="break-all text-text-muted">{resolved.email}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Estado inicial</dt>
          <dd className="text-text-default">
            Habilitación operativa: Habilitada · Identidad técnica: Pendiente ·
            Lista para emitir: No
          </dd>
        </div>
      </dl>
    </div>
  );
}

function CreatedPanel({
  result,
  refreshFailed,
  onRetryRefresh,
  onClose
}: {
  result: AdminIssuerProvisionResultVM;
  refreshFailed: boolean;
  onRetryRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <FeedbackAlert variant="success" title="Institución creada">
        {result.issuer.name} quedó registrada con{' '}
        {result.initialAdminMembership.displayLabel} como primer administrador.
      </FeedbackAlert>

      {refreshFailed ? (
        <div className="grid min-w-0 gap-3">
          <FeedbackAlert
            variant="warning"
            title="No pudimos actualizar la vista"
          >
            La institución quedó creada. Lo que falló fue volver a leer los
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

/**
 * Fallo AMBIGUO del alta: el POST salio y no hay respuesta.
 *
 * No se afirma que no se creo nada -- no se sabe -- y NO se ofrece crear otra
 * vez, porque `POST /admin/issuers` no es idempotente y el schema no bloquea
 * nombres repetidos: un segundo intento podria dejar dos instituciones. Lo
 * unico disponible es releer el padron y mirar.
 *
 * Tampoco se intenta adivinar el resultado buscando el nombre en el listado:
 * seria una heuristica sobre un campo que no identifica nada.
 */
function AmbiguousCreatePanel({
  onRefreshIssuers,
  onClose
}: {
  onRefreshIssuers: () => void;
  onClose: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <FeedbackAlert
        variant="warning"
        title="No pudimos confirmar si la institución se creó"
      >
        Se envió la solicitud pero no recibimos respuesta del servicio.
        Actualizá el padrón de instituciones para ver el resultado antes de
        volver a intentarlo.
      </FeedbackAlert>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={onRefreshIssuers}>
          Actualizar instituciones
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapeo de errores
// ---------------------------------------------------------------------------

/** Igual que en Flow A: el 404 de S4 es uniforme y no se desagrega. */
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
 * A donde va el flujo cuando el alta falla.
 *
 * Un 4xx es una respuesta DEL SERVIDOR: llego, se proceso y se rechazo, asi
 * que no hay ambiguedad y se puede volver al formulario. Cualquier otra cosa
 * -- red caida, 5xx, payload ilegible -- deja sin saber si el POST se aplico,
 * y por eso cae en `ambiguous`, donde no hay CTA de creacion.
 */
function createFailureStep(
  error: unknown,
  resolved: ResolvedAdminUserVM
): CreateIssuerStep {
  if (error instanceof ApiError && error.status !== null) {
    if (error.status === 404 || error.status === 403) {
      return { status: 'form' };
    }
    if (error.status >= 400 && error.status < 500) {
      return { status: 'confirm', resolved };
    }
  }

  return { status: 'ambiguous' };
}

function createFeedback(error: unknown): FlowFeedback {
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
        message: 'Revisá los datos de la institución y volvé a intentar.'
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
    message: 'No pudimos completar la operación. Revisá los datos y volvé a intentar.'
  };
}
