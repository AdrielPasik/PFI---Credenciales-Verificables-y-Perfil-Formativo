'use client';

import { Building2, LoaderCircle, Users } from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  AdminIssuerVM,
  AdminMembershipVM
} from '@/models/platform-admin';

/**
 * Superficie visual de /admin -- slice S6a, READ-ONLY.
 *
 * COMPONENTE PURO: recibe estados ya resueltos y callbacks. No llama al API,
 * no toca la sesion y no tiene efectos. Eso es lo que permite testear cada
 * estado (loading / vacio / error / 403) sin montar `SessionProvider` ni
 * simular fetch.
 *
 * NO HAY NINGUNA ACCION MUTANTE. Ni formularios, ni "Crear institucion", ni
 * "Agregar admin", ni botones deshabilitados anunciando lo que vendra: los
 * unicos `<button>` de esta superficie son la seleccion de institucion y los
 * reintentos de lectura. La capacidad de mutar existe en el backend desde
 * S4/S5a/S5b, pero su UI es S6b.
 *
 * COPY. `authorizationStatus` se presenta como HABILITACION OPERATIVA
 * ("Estado operativo" / "Habilitada"). En ningun lugar se dice "verificada",
 * "validada", "acreditada" ni "institucion verificada": Scope no modela
 * verificacion institucional y la UI no puede insinuar que lo haga.
 */

export type AdminIssuersLoadState =
  | { status: 'loading' }
  | { status: 'ready'; issuers: AdminIssuerVM[] }
  | { status: 'error'; message: string }
  | { status: 'capability-lost' };

export type AdminMembershipsLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; memberships: AdminMembershipVM[] }
  | { status: 'error'; message: string }
  | { status: 'capability-lost' };

interface AdminIssuersViewProps {
  issuersState: AdminIssuersLoadState;
  membershipsState: AdminMembershipsLoadState;
  selectedIssuerReference: string | null;
  onSelectIssuer: (issuerReference: string) => void;
  onRetryIssuers: () => void;
  onRetryMemberships: () => void;
  onRevalidateSession: () => void;
}

export function AdminIssuersView({
  issuersState,
  membershipsState,
  selectedIssuerReference,
  onSelectIssuer,
  onRetryIssuers,
  onRetryMemberships,
  onRevalidateSession
}: AdminIssuersViewProps) {
  const issuers = issuersState.status === 'ready' ? issuersState.issuers : [];
  const selectedIssuer =
    issuers.find(
      (issuer) => issuer.issuerReference === selectedIssuerReference
    ) ?? null;

  return (
    <div className="grid min-w-0 gap-8">
      <header className="grid min-w-0 gap-2 border-b border-border-default pb-6">
        <p className="text-sm font-semibold text-teal-700">
          Plano de plataforma
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">
          Instituciones en Scope
        </h1>
        <p className="max-w-3xl leading-7 text-text-muted">
          El padrón completo de instituciones registradas y de las personas con
          acceso a cada una. La habilitación operativa que se muestra acá
          significa que la institución puede operar dentro de Scope; no
          constituye una verificación legal ni institucional.
        </p>
      </header>

      {issuersState.status === 'capability-lost' ? (
        <CapabilityLostPanel onRevalidateSession={onRevalidateSession} />
      ) : null}

      {issuersState.status === 'loading' ? (
        <LoadingPanel label="Cargando instituciones" />
      ) : null}

      {issuersState.status === 'error' ? (
        <div className="grid min-w-0 gap-4">
          <FeedbackAlert
            variant="error"
            title="No pudimos cargar las instituciones"
          >
            {issuersState.message}
          </FeedbackAlert>
          <div>
            <Button type="button" variant="secondary" onClick={onRetryIssuers}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {issuersState.status === 'ready' && issuers.length === 0 ? (
        <EmptyIssuersPanel />
      ) : null}

      {issuersState.status === 'ready' && issuers.length > 0 ? (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-8">
          <IssuerList
            issuers={issuers}
            selectedIssuerReference={selectedIssuerReference}
            onSelectIssuer={onSelectIssuer}
          />
          {selectedIssuer ? (
            <IssuerDetailPanel
              issuer={selectedIssuer}
              membershipsState={membershipsState}
              onRetryMemberships={onRetryMemberships}
              onRevalidateSession={onRevalidateSession}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

function IssuerList({
  issuers,
  selectedIssuerReference,
  onSelectIssuer
}: {
  issuers: AdminIssuerVM[];
  selectedIssuerReference: string | null;
  onSelectIssuer: (issuerReference: string) => void;
}) {
  return (
    <section aria-labelledby="admin-issuer-list-title" className="min-w-0">
      <h2
        id="admin-issuer-list-title"
        className="text-sm font-semibold tracking-wider text-text-muted uppercase"
      >
        Instituciones ({issuers.length})
      </h2>
      {/* `<ul>` + `<button>` reales: la seleccion es operable por teclado y
          anunciada con `aria-current`. Nunca un `div` clickable. */}
      <ul className="mt-3 grid min-w-0 gap-2">
        {issuers.map((issuer) => {
          const selected = issuer.issuerReference === selectedIssuerReference;

          return (
            <li key={issuer.issuerReference} className="min-w-0">
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelectIssuer(issuer.issuerReference)}
                className={
                  selected
                    ? 'w-full min-w-0 rounded-card border border-brand-900 bg-surface p-4 text-left shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700'
                    : 'w-full min-w-0 rounded-card border border-border-default bg-surface p-4 text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700'
                }
              >
                <span className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-muted text-teal-700">
                    <Building2 aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold break-words text-text-strong">
                      {issuer.name}
                    </span>
                    {issuer.legalName && issuer.legalName !== issuer.name ? (
                      <span className="mt-0.5 block text-sm break-words text-text-muted">
                        {issuer.legalName}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          issuer.authorizationStatus === 'authorized'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {issuer.authorizationLabel}
                      </Badge>
                      <Badge variant="outline">
                        Emisión: {issuer.technicalIdentity.readinessLabel}
                      </Badge>
                    </span>
                    <span className="mt-2 block text-xs text-text-muted">
                      {issuer.membershipCounts.summaryLabel}
                      {' · '}
                      {issuer.catalogCounts.academicCourses} cursos
                      {' · '}
                      {issuer.catalogCounts.programs} programas
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

function IssuerDetailPanel({
  issuer,
  membershipsState,
  onRetryMemberships,
  onRevalidateSession
}: {
  issuer: AdminIssuerVM;
  membershipsState: AdminMembershipsLoadState;
  onRetryMemberships: () => void;
  onRevalidateSession: () => void;
}) {
  return (
    <section
      aria-labelledby="admin-issuer-detail-title"
      className="grid min-w-0 gap-6"
    >
      <div className="min-w-0">
        <h2
          id="admin-issuer-detail-title"
          className="text-2xl font-bold tracking-tight break-words text-text-strong"
        >
          {issuer.name}
        </h2>
        <p className="mt-1 text-sm break-words text-text-muted">
          {issuer.legalName ?? 'Sin razón social registrada'}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Registrada el {issuer.createdAtLabel}
        </p>
      </div>

      <Card>
        <CardContent className="grid min-w-0 gap-6 pt-5 sm:pt-6">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-wider text-text-muted uppercase">
              Estado operativo
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Badge
                variant={
                  issuer.authorizationStatus === 'authorized'
                    ? 'secondary'
                    : 'outline'
                }
              >
                {issuer.authorizationLabel}
              </Badge>
              <span className="text-sm text-text-muted">
                Habilitación para operar dentro de Scope.
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-wider text-text-muted uppercase">
              Identidad técnica
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              Una institución habilitada todavía puede no estar lista para
              emitir: hace falta además su identidad técnica.
            </p>
            {/* Solo booleanos derivados. El backend NO devuelve el DID ni la
                walletAddress en esta superficie, y /admin no los necesita. */}
            <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">
              <ReadinessItem
                label="DID configurado"
                value={issuer.technicalIdentity.didConfigured}
              />
              <ReadinessItem
                label="Wallet configurada"
                value={issuer.technicalIdentity.walletConfigured}
              />
              <ReadinessItem
                label="Lista para emitir"
                value={issuer.technicalIdentity.readyToIssue}
              />
            </dl>
          </div>

          <div className="grid min-w-0 gap-6 sm:grid-cols-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-wider text-text-muted uppercase">
                Miembros
              </h3>
              <p className="mt-2 text-2xl font-bold text-text-strong">
                {issuer.membershipCounts.active}
                <span className="text-base font-normal text-text-muted">
                  {' '}
                  de {issuer.membershipCounts.total}
                </span>
              </p>
              <p className="mt-1 text-sm text-text-muted">
                Con acceso activo sobre el total registrado.
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-wider text-text-muted uppercase">
                Catálogo
              </h3>
              <dl className="mt-2 grid min-w-0 gap-1.5 text-sm">
                <CatalogItem
                  label="Cursos"
                  value={issuer.catalogCounts.academicCourses}
                />
                <CatalogItem
                  label="Programas"
                  value={issuer.catalogCounts.programs}
                />
                <CatalogItem
                  label="Versiones curriculares"
                  value={issuer.catalogCounts.curriculumVersions}
                />
                <CatalogItem
                  label="Relaciones programa-curso"
                  value={issuer.catalogCounts.programCourses}
                />
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>

      <MembershipsPanel
        membershipsState={membershipsState}
        onRetryMemberships={onRetryMemberships}
        onRevalidateSession={onRevalidateSession}
      />
    </section>
  );
}

function ReadinessItem({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="min-w-0 rounded-control border border-border-default bg-surface-muted/50 p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-text-strong">
        {value ? 'Sí' : 'No'}
      </dd>
    </div>
  );
}

function CatalogItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="min-w-0 text-text-muted">{label}</dt>
      <dd className="font-semibold text-text-strong">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

function MembershipsPanel({
  membershipsState,
  onRetryMemberships,
  onRevalidateSession
}: {
  membershipsState: AdminMembershipsLoadState;
  onRetryMemberships: () => void;
  onRevalidateSession: () => void;
}) {
  return (
    <section
      aria-labelledby="admin-memberships-title"
      className="grid min-w-0 gap-3"
    >
      <h3
        id="admin-memberships-title"
        className="flex items-center gap-2 text-sm font-semibold tracking-wider text-text-muted uppercase"
      >
        <Users aria-hidden="true" className="size-4" />
        Personas con acceso
      </h3>

      {/* El loading de memberships es LOCAL: el listado y la seleccion siguen
          en pantalla mientras se cargan las de otra institucion. */}
      {membershipsState.status === 'loading' ||
      membershipsState.status === 'idle' ? (
        <LoadingPanel label="Cargando personas con acceso" />
      ) : null}

      {membershipsState.status === 'capability-lost' ? (
        <CapabilityLostPanel onRevalidateSession={onRevalidateSession} />
      ) : null}

      {membershipsState.status === 'error' ? (
        <div className="grid min-w-0 gap-3">
          <FeedbackAlert
            variant="warning"
            title="No pudimos cargar las personas con acceso"
          >
            {membershipsState.message}
          </FeedbackAlert>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={onRetryMemberships}
            >
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {membershipsState.status === 'ready' &&
      membershipsState.memberships.length === 0 ? (
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-sm leading-6 text-text-muted">
              No hay miembros asociados a esta institución.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {membershipsState.status === 'ready' &&
      membershipsState.memberships.length > 0 ? (
        <Card className="min-w-0 overflow-hidden">
          {/* `overflow-x-auto` acota el scroll a este panel: la pagina nunca
              scrollea horizontalmente en mobile. */}
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-0 border-collapse text-left text-sm">
              <caption className="sr-only">
                Personas con acceso a la institución seleccionada, con su rol y
                el estado de su acceso.
              </caption>
              <thead>
                <tr className="border-b border-border-default">
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold tracking-wider text-text-muted uppercase"
                  >
                    Persona
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold tracking-wider text-text-muted uppercase"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold tracking-wider text-text-muted uppercase"
                  >
                    Rol
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold tracking-wider text-text-muted uppercase"
                  >
                    Acceso
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Las memberships NO activas tambien se muestran: el objetivo
                    de /admin es diagnostico, y esconder una revocada haria
                    imposible entender por que alguien no puede operar. */}
                {membershipsState.memberships.map((membership) => (
                  <tr
                    key={membership.userReference}
                    className="border-b border-border-default/70 last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-4 py-3 font-semibold break-words text-text-strong"
                    >
                      {membership.displayLabel}
                    </th>
                    <td className="px-4 py-3 break-all text-text-muted">
                      {/* `null` se representa como ausencia, NUNCA como "". */}
                      {membership.email ?? (
                        <span className="text-text-muted italic">
                          Sin email
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-default">
                      {membership.roleLabel}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          membership.status === 'active'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {membership.statusLabel}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estados compartidos
// ---------------------------------------------------------------------------

function EmptyIssuersPanel() {
  return (
    <Card>
      <CardContent className="grid gap-3 pt-5 sm:pt-6">
        <span className="flex size-11 items-center justify-center rounded-control bg-surface-muted text-teal-700">
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <h2 className="text-xl font-semibold text-text-strong">
          No hay instituciones configuradas todavía.
        </h2>
        <p className="text-sm leading-6 text-text-muted">
          Cuando se dé de alta una institución en Scope, aparecerá en este
          padrón junto con las personas que tengan acceso.
        </p>
      </CardContent>
    </Card>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-32 items-center justify-center rounded-card border border-border-default bg-surface p-6 text-sm text-text-muted"
    >
      <LoaderCircle
        aria-hidden="true"
        className="mr-2 size-5 animate-spin text-teal-700"
      />
      {label}
    </div>
  );
}

/**
 * 403 sobre una superficie que ya habia renderizado.
 *
 * NO SE OFRECE REINTENTAR LOS DATOS. Un 403 no es un fallo transitorio: el
 * backend ya nego la capacidad, y repetir el GET devolveria 403 otra vez. Lo
 * que corresponde es revalidar la SESION por el mecanismo que ya existe
 * (`useSession().retry()` -> `GET /auth/me`): si la capacidad efectivamente se
 * revoco, `isPlatformAdmin` pasa a `false` y el boundary saca a la persona de
 * /admin. No hay ningun auth recovery paralelo aca.
 *
 * El 401 no llega a este panel: `SessionProvider.requestAuthenticated` ya lo
 * intercepta, limpia el store y pone la sesion en `expired`, con lo que el
 * boundary redirige a /login.
 */
function CapabilityLostPanel({
  onRevalidateSession
}: {
  onRevalidateSession: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <FeedbackAlert
        variant="warning"
        title="La administración de plataforma no está disponible para esta sesión"
      >
        El servicio rechazó la consulta administrativa. Si tu acceso cambió
        recientemente, revalidá la sesión para continuar.
      </FeedbackAlert>
      <div>
        <Button type="button" variant="secondary" onClick={onRevalidateSession}>
          Revalidar sesión
        </Button>
      </div>
    </div>
  );
}
