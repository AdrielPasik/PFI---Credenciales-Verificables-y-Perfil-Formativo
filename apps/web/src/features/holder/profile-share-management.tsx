'use client';

/**
 * Administracion de enlaces compartidos y consentimiento de analisis contextual.
 *
 * DOS PERMISOS DISTINTOS, y la UI tiene que mostrarlos como tales.
 *
 *   que el enlace exista y este activo  -> un tercero puede VER el perfil publico
 *   el toggle de analisis contextual    -> ademas puede pedir que Scope razone
 *                                          sobre la evidencia que el holder eligio
 *
 * Por eso "Permitir ver mi perfil" NO es una casilla: la existencia de un enlace
 * activo YA es ese permiso, y duplicarlo en un control aparte haria pensar que
 * se puede tener un enlace activo que no muestre nada.
 */

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import {
  listMyProfileSharesRequest,
  replaceShareVerificationPolicyRequest,
  revokeProfileShareRequest
} from '@/lib/api/profile-sharing-api';
import { getMyCredentialsRequest } from '@/lib/api/holder-api';
import { useSession } from '@/lib/session/session-provider';
import type { HolderCredentialListItemVM } from '@/models/holder';
import type { HolderProfileShareVM } from '@/models/profile-sharing';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; shares: HolderProfileShareVM[]; credentials: HolderCredentialListItemVM[] }
  | { status: 'error' };

export function ProfileShareManagement() {
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Mismo patron que objectives-list-route: la promesa se encadena dentro del
  // efecto con un guard `active`, y un token dispara la recarga. Evita el
  // setState sincrono en el cuerpo del efecto.
  useEffect(() => {
    let active = true;
    void Promise.all([
      listMyProfileSharesRequest(requestAuthenticated),
      getMyCredentialsRequest(requestAuthenticated)
    ])
      .then(
        ([shares, credentials]) => active && setState({ status: 'ready', shares, credentials })
      )
      .catch(() => active && setState({ status: 'error' }));
    return () => {
      active = false;
    };
  }, [reloadToken, requestAuthenticated]);

  const reload = useCallback((message: string) => {
    setNotice(message);
    setReloadToken((token) => token + 1);
  }, []);

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Cargando tus enlaces compartidos
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <FeedbackAlert variant="warning" title="No pudimos cargar tus enlaces compartidos">
        Volvé a intentarlo en unos minutos.
      </FeedbackAlert>
    );
  }

  if (state.shares.length === 0) {
    return (
      <p className="text-sm leading-6 text-text-muted">
        Todavía no compartiste tu perfil. Cuando generes un enlace vas a poder revocarlo desde acá.
      </p>
    );
  }

  // Solo se ofrecen credenciales emitidas: son las unicas autorizables, y la
  // restriccion tambien se valida en el servidor.
  const eligible = state.credentials.filter((credential) => credential.status === 'issued');

  return (
    <div className="grid min-w-0 gap-4">
      {notice ? (
        <FeedbackAlert variant="information" title="Listo">
          {notice}
        </FeedbackAlert>
      ) : null}
      <ul className="grid list-none gap-4">
        {state.shares.map((share) => (
          <li key={share.shareId}>
            <ShareCard
              share={share}
              eligibleCredentials={eligible}
              onChanged={reload}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShareCard({
  share,
  eligibleCredentials,
  onChanged
}: {
  share: HolderProfileShareVM;
  eligibleCredentials: HolderCredentialListItemVM[];
  onChanged: (message: string) => void;
}) {
  const { requestAuthenticated } = useSession();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);

  const isActive = share.status === 'ACTIVE';

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeProfileShareRequest(requestAuthenticated, share.shareId);
      onChanged('El enlace dejó de funcionar. Podés generar uno nuevo cuando quieras.');
    } catch {
      setError('No pudimos revocar el enlace. Intentá nuevamente.');
    } finally {
      setBusy(false);
      setConfirmingRevoke(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-5 shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-text-strong">Enlace compartido</h3>
            <StatusBadge status={share.status} label={share.statusLabel} />
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Creado el {share.createdAtLabel}
            {share.expiresAtLabel ? ` · Vence el ${share.expiresAtLabel}` : ''}
            {share.revokedAtLabel ? ` · Revocado el ${share.revokedAtLabel}` : ''}
          </p>
          {share.lastUsedAtLabel ? (
            <p className="mt-1 text-xs text-text-subtle">
              Última vez abierto el {share.lastUsedAtLabel}
            </p>
          ) : null}
        </div>
        {isActive ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirmingRevoke(true)}
          >
            Revocar enlace
          </Button>
        ) : null}
      </header>

      {error ? (
        <FeedbackAlert variant="warning" title="No pudimos completar la acción">
          {error}
        </FeedbackAlert>
      ) : null}

      {confirmingRevoke ? (
        <div className="grid gap-3 rounded-control border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p className="font-semibold">¿Revocar este enlace?</p>
          <ul className="list-disc pl-5">
            <li>El enlace público va a dejar de funcionar para cualquiera que lo tenga.</li>
            <li>También se corta el análisis contextual a través de ese enlace.</li>
            <li>Es permanente: ese enlace no se puede reactivar.</li>
            <li>Podés generar un enlace nuevo cuando quieras.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void revoke()}>
              {busy ? 'Revocando…' : 'Sí, revocar'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmingRevoke(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {isActive ? (
        <div className="grid min-w-0 gap-3 border-t border-border-default pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-xl">
              <p className="text-sm font-semibold text-text-strong">Permitir análisis contextual</p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                Con esto habilitado, quien abra el enlace puede pedirle a Scope que analice tu
                trayectoria frente a su propio objetivo.
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {share.contextualVerificationEnabled
                  ? `Habilitado · ${share.effectiveAuthorizedCredentialCount} ${
                      share.effectiveAuthorizedCredentialCount === 1
                        ? 'credencial disponible'
                        : 'credenciales disponibles'
                    }`
                  : 'Deshabilitado'}
              </p>
              {share.authorizedCredentialCount > share.effectiveAuthorizedCredentialCount ? (
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {share.authorizedCredentialCount - share.effectiveAuthorizedCredentialCount} de
                  las credenciales que elegiste ya no está disponible. Tu selección se conserva.
                </p>
              ) : null}
            </div>
            <Button type="button" variant="secondary" onClick={() => setConfiguring((open) => !open)}>
              {configuring ? 'Cerrar' : 'Configurar'}
            </Button>
          </div>

          {configuring ? (
            <ContextualVerificationForm
              share={share}
              eligibleCredentials={eligibleCredentials}
              onSaved={(message) => {
                setConfiguring(false);
                onChanged(message);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ContextualVerificationForm({
  share,
  eligibleCredentials,
  onSaved
}: {
  share: HolderProfileShareVM;
  eligibleCredentials: HolderCredentialListItemVM[];
  onSaved: (message: string) => void;
}) {
  const { requestAuthenticated } = useSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(share.contextualVerificationEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Habilitar sin evidencia produciria un CTA publico que no puede razonar. El
  // servidor lo rechaza igual; acá el boton directamente no se ofrece.
  const blocked = enabled && selected.size === 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await replaceShareVerificationPolicyRequest(requestAuthenticated, share.shareId, {
        enabled,
        credentialIds: [...selected]
      });
      onSaved(
        enabled
          ? 'Habilitaste el análisis contextual para las credenciales que elegiste.'
          : 'El análisis contextual quedó deshabilitado para este enlace.'
      );
    } catch {
      setError('No pudimos guardar la configuración. Revisá tu selección e intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 rounded-control border border-border-default bg-surface-muted p-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-1 size-4"
        />
        <span className="min-w-0">
          <span className="font-semibold text-text-strong">
            Permitir que terceros analicen esta evidencia frente a sus propios objetivos
          </span>
        </span>
      </label>

      <div className="grid gap-2">
        <p className="text-sm font-semibold text-text-strong">
          Elegí qué credenciales puede utilizar Scope cuando un tercero analice tu trayectoria
          frente a su propio objetivo.
        </p>
        {/* La copia no puede prometer mas privacidad de la que el diseño da: la
            metadata segura de una credencial que respalde una conclusion SI
            puede aparecer en un resultado publico futuro. */}
        <p className="text-sm leading-6 text-text-muted">
          El tercero no verá el contenido completo de tus fuentes ni sus fragmentos. Si una
          credencial respalda una conclusión, sí puede verse su título, tipo, institución emisora y
          estado actual.
        </p>
      </div>

      {eligibleCredentials.length === 0 ? (
        <p className="text-sm text-text-muted">
          Todavía no tenés credenciales emitidas que puedas autorizar.
        </p>
      ) : (
        <ul className="grid list-none gap-2">
          {eligibleCredentials.map((credential) => (
            <li key={credential.credentialReference}>
              <label className="flex min-w-0 items-start gap-3 rounded-control border border-border-default bg-surface p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={selected.has(credential.credentialReference)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(credential.credentialReference);
                      else next.delete(credential.credentialReference);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block break-words font-semibold text-text-strong">
                    {credential.title}
                  </span>
                  <span className="mt-0.5 block break-words text-xs text-text-muted">
                    {credential.typeLabel} · {credential.issuerName} · {credential.statusLabel}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <FeedbackAlert variant="warning" title="No pudimos guardar">
          {error}
        </FeedbackAlert>
      ) : null}

      {blocked ? (
        <p className="text-sm text-text-muted">
          Para habilitarlo tenés que elegir al menos una credencial.
        </p>
      ) : null}

      <div>
        <Button type="button" disabled={saving || blocked} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: HolderProfileShareVM['status']; label: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'border-teal-700 bg-teal-50 text-teal-800'
      : 'border-border-strong bg-surface-muted text-text-muted';
  return (
    <span className={`rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}
