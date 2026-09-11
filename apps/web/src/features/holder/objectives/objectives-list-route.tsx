'use client';

/**
 * Historia de objetivos — P2.3.
 *
 * Muestra SOLO lo que trae el DTO de resumen: titulo, tipo y fecha. El resumen
 * no carga `definition`, asi que no hay cantidad de requisitos que mostrar, y
 * pedir el detalle de cada fila para contarlos seria un N+1 por un dato
 * decorativo.
 *
 * Existe porque el Objective es persistido e inmutable: sin lista, cada
 * confirmacion crearia una fila alcanzable solo por una URL que nadie guardo.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listMyObjectivesRequest } from '@/lib/api/objectives-api';
import { mapObjectiveReadError } from '@/lib/errors/objective-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type { ObjectiveSummaryVM } from '@/models/objectives';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; objectives: ObjectiveSummaryVM[] }
  | { status: 'error'; message: string };

export function ObjectivesListRoute() {
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<ListState>({ status: 'loading' });

  const [reloadToken, setReloadToken] = useState(0);

  // El efecto NO hace setState sincronico: arranca la peticion y solo escribe
  // al resolver. Es el mismo patron de wallet-credential-detail-route.tsx.
  useEffect(() => {
    let active = true;
    void listMyObjectivesRequest(requestAuthenticated)
      .then((value) => active && setState({ status: 'ready', objectives: value }))
      .catch(
        (requestError: unknown) =>
          active && setState({ status: 'error', message: mapObjectiveReadError(requestError) })
      );
    return () => {
      active = false;
    };
  }, [reloadToken, requestAuthenticated]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <div className="grid min-w-0 gap-8">
      <nav aria-label="Ubicacion" className="text-sm text-text-muted">
        <Link href="/wallet" className="underline underline-offset-2">
          Mi perfil formativo
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border-default pb-6">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-semibold text-teal-700">Objetivos</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">
            Mis objetivos
          </h1>
          <p className="mt-3 leading-7 text-text-muted">
            Los objetivos que confirmaste quedan disponibles para consultarlos cuando
            los necesites.
          </p>
        </div>
        <Button asChild>
          <Link href="/wallet/objectives/new">Analizar un objetivo</Link>
        </Button>
      </header>

      {state.status === 'loading' ? (
        <p className="text-sm text-text-muted">Cargando tus objetivos...</p>
      ) : null}

      {state.status === 'error' ? (
        <div className="grid gap-4">
          <FeedbackAlert variant="warning" title="No pudimos cargar tus objetivos">
            {state.message}
          </FeedbackAlert>
          <div>
            <Button type="button" variant="secondary" onClick={retry}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === 'ready' && state.objectives.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm leading-6 text-text-muted">
              Todavia no analizaste ningun objetivo.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {state.status === 'ready' && state.objectives.length > 0 ? (
        <ul className="grid list-none gap-3">
          {state.objectives.map((objective) => (
            <li key={objective.objectiveReference}>
              <Link
                href={`/wallet/objectives/${objective.objectiveReference}`}
                className="flex items-center justify-between gap-4 rounded-card border border-border-default bg-surface p-5 transition hover:border-brand-600 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-strong">
                    {objective.title}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    {objective.objectiveTypeLabel} · {objective.createdAtLabel}
                  </p>
                </div>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
