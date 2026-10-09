'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TechnicalConfigurationRouteBoundary } from '@/features/issuer-technical-identity/technical-configuration-route-boundary';
import {
  checkIssuerNetworkHealthRequest,
  getIssuerTechnicalIdentityRequest
} from '@/lib/api/issuer-technical-identity-api';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import { ApiError } from '@/lib/errors/api-error';
import { useSession } from '@/lib/session/session-provider';
import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';
import type {
  IssuerNetworkHealthVM,
  IssuerTechnicalIdentityVM
} from '@/models/issuer-technical-identity';

/**
 * Configuracion tecnica del emisor -- S8c9. SOLO LECTURA.
 *
 * - Al cargar se hace UNICAMENTE el GET: nunca se consulta la red solo.
 * - La salud de red se pide SOLO con el boton "Comprobar red".
 * - No hay controles de claves, de provisioning, de rotacion ni de capacidades.
 * - El issuer se pasa EXPLICITAMENTE al cliente: el que eligio el boundary
 *   tecnico (membership activa + admin), no el issuer operativo global.
 */
export function IssuerTechnicalIdentityRoute() {
  return (
    <TechnicalConfigurationRouteBoundary>
      {(membership) => <IssuerTechnicalIdentityController membership={membership} />}
    </TechnicalConfigurationRouteBoundary>
  );
}

function IssuerTechnicalIdentityController({
  membership
}: {
  membership: IssuerMembershipSummaryVM;
}) {
  const { requestAuthenticated } = useSession();
  return (
    <IssuerTechnicalIdentityView
      issuerReference={membership.issuerReference}
      request={requestAuthenticated}
    />
  );
}

const credentialTypeLabels: Record<string, string> = {
  course: 'Curso',
  academic_subject: 'Materia académica',
  degree: 'Título académico',
  certification: 'Certificación'
};

const healthLabels: Record<IssuerNetworkHealthVM['status'], string> = {
  HEALTHY: 'Red operativa',
  DEGRADED: 'Red con advertencias',
  UNAVAILABLE: 'Red no disponible',
  NOT_APPLICABLE_MOCK: 'No aplica: entorno de simulación'
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'ready'; data: IssuerTechnicalIdentityVM };

type HealthState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'error' }
  | { kind: 'done'; data: IssuerNetworkHealthVM };

export function IssuerTechnicalIdentityView(props: {
  issuerReference: string;
  request: AuthenticatedApiRequest;
}) {
  // Un issuer distinto es una pantalla distinta: se remonta, asi ni la carga
  // ni el resultado de salud de un issuer se arrastran al siguiente.
  return <IssuerTechnicalIdentityPanel key={props.issuerReference} {...props} />;
}

function IssuerTechnicalIdentityPanel({
  issuerReference,
  request
}: {
  issuerReference: string;
  request: AuthenticatedApiRequest;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [health, setHealth] = useState<HealthState>({ kind: 'idle' });

  useEffect(() => {
    const controller = new AbortController();

    getIssuerTechnicalIdentityRequest(request, issuerReference, {
      signal: controller.signal
    })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 403
            ? { kind: 'forbidden' }
            : { kind: 'error' }
        );
      });

    return () => controller.abort();
    // `requestAuthenticated` cambia de identidad en cada render del provider;
    // la carga depende SOLO del issuer (el panel se remonta al cambiarlo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuerReference]);

  async function checkNetwork() {
    setHealth({ kind: 'checking' });
    try {
      setHealth({
        kind: 'done',
        data: await checkIssuerNetworkHealthRequest(request, issuerReference)
      });
    } catch {
      setHealth({ kind: 'error' });
    }
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-text-muted">Cargando configuración técnica…</p>;
  }
  if (state.kind === 'forbidden') {
    return (
      <p role="alert" className="text-sm text-text-muted">
        Solo un administrador del emisor puede ver la configuración técnica.
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-sm text-text-muted">
        No se pudo cargar la configuración técnica.
      </p>
    );
  }

  const data = state.data;
  const target = data.blockchainTarget;
  const isMock = target.mode === 'mock';

  return (
    <div className="grid gap-5">
      <section aria-labelledby="technical-title">
        <h1 id="technical-title" className="text-2xl font-semibold text-text-strong">
          Configuración técnica
        </h1>
        <p className="mt-2 text-sm text-text-muted">{data.issuerName}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={data.readyToIssue ? 'secondary' : 'outline'}>
            {data.readyToIssue ? 'Lista para emitir' : 'No lista para emitir'}
          </Badge>
          <Badge variant="outline">
            {data.administrativelyAuthorized ? 'Habilitada' : 'No habilitada'}
          </Badge>
          <Badge variant="outline">
            {data.configurationReady ? 'Configuración completa' : 'Configuración incompleta'}
          </Badge>
        </div>
        {data.readinessReasons.length > 0 && (
          <ul aria-label="Motivos" className="mt-3 list-disc pl-5 font-mono text-xs">
            {data.readinessReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Red</h2>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            Modo:{' '}
            <strong>
              {target.mode === null
                ? 'Sin configurar'
                : isMock
                  ? 'Simulación (mock)'
                  : 'Registro on-chain'}
            </strong>
          </p>
          {isMock && (
            <p role="note" className="text-text-muted">
              Entorno de simulación: no hay registro en una red pública. No equivale a la
              aceptación final en Base Sepolia.
            </p>
          )}
          {target.network && <p>Red: {target.network}</p>}
          {target.chainId !== null && <p>Chain ID: {target.chainId}</p>}
          {target.contractAddress && (
            <p className="break-all font-mono text-xs">Contrato: {target.contractAddress}</p>
          )}
          <div>
            <Button
              type="button"
              onClick={() => void checkNetwork()}
              disabled={health.kind === 'checking'}
            >
              Comprobar red
            </Button>
          </div>
          {health.kind === 'checking' && <p>Comprobando…</p>}
          {health.kind === 'error' && <p role="alert">No se pudo comprobar la red.</p>}
          {health.kind === 'done' && (
            <div aria-label="Resultado de red">
              <p>
                <strong>{healthLabels[health.data.status]}</strong>
              </p>
              {health.data.latestBlockNumber !== null && (
                <p>Último bloque: {health.data.latestBlockNumber}</p>
              )}
              {health.data.reasons.length > 0 && (
                <ul className="list-disc pl-5 font-mono text-xs">
                  {health.data.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Identidad</h2>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {data.technicalIdentity ? (
            <>
              <p className="break-all font-mono text-xs">{data.technicalIdentity.did}</p>
              {data.technicalIdentity.didDocumentUrl && (
                <a
                  className="underline"
                  href={data.technicalIdentity.didDocumentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver documento DID
                </a>
              )}
            </>
          ) : (
            <p>Sin identidad técnica configurada.</p>
          )}
          {data.assertionSigner && (
            <p className="break-all">
              Clave de firma v{data.assertionSigner.keyVersion}:{' '}
              <span className="font-mono text-xs">{data.assertionSigner.address}</span>
            </p>
          )}
          {data.anchorSigner && (
            <p className="break-all">
              Cuenta de anclaje v{data.anchorSigner.keyVersion}:{' '}
              <span className="font-mono text-xs">{data.anchorSigner.address}</span>
            </p>
          )}
          {data.anchorSigner?.shared && (
            <p role="note" className="text-text-muted">
              Cuenta de anclaje compartida con otros emisores. Su revocación o rotación afecta a
              todos ellos.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Tipos de credencial habilitados</h2>
        </CardHeader>
        <CardContent className="text-sm">
          {data.allowedCredentialTypes.length === 0 ? (
            <p>Ningún tipo habilitado.</p>
          ) : (
            <ul className="list-disc pl-5">
              {data.allowedCredentialTypes.map((type) => (
                <li key={type}>{credentialTypeLabels[type] ?? type}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-text-muted">Los define la plataforma.</p>
        </CardContent>
      </Card>
    </div>
  );
}
