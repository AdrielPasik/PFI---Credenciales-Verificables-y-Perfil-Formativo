'use client';

/**
 * Objetivo confirmado — P2.3.
 *
 * Solo lectura. Una fila finalizada no se edita: el backend no expone `PATCH` y
 * una revision crea SIEMPRE una fila nueva.
 *
 * SIN accion de P2.4. No se dibuja "Analizar mi trayectoria" deshabilitado ni
 * "Proximamente": un boton muerto es una promesa que esta pantalla todavia no
 * puede cumplir. P2.4 pondra el suyo cuando exista.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { getMyObjectiveRequest } from '@/lib/api/objectives-api';
import { mapObjectiveReadError } from '@/lib/errors/objective-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type { ObjectiveDetailVM } from '@/models/objectives';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; objective: ObjectiveDetailVM }
  | { status: 'error'; message: string };

export function ObjectiveDetailRoute() {
  const params = useParams<{ objectiveId: string }>();
  const objectiveReference =
    typeof params.objectiveId === 'string' ? params.objectiveId : '';
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  const [reloadToken, setReloadToken] = useState(0);

  // El efecto NO hace setState sincronico: arranca la peticion y solo escribe
  // al resolver. Es el mismo patron de wallet-credential-detail-route.tsx.
  useEffect(() => {
    let active = true;
    void getMyObjectiveRequest(requestAuthenticated, objectiveReference)
      .then((value) => active && setState({ status: 'ready', objective: value }))
      .catch(
        (requestError: unknown) =>
          active && setState({ status: 'error', message: mapObjectiveReadError(requestError) })
      );
    return () => {
      active = false;
    };
  }, [reloadToken, requestAuthenticated, objectiveReference]);

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
        <span aria-hidden="true"> / </span>
        <Link href="/wallet/objectives" className="underline underline-offset-2">
          Objetivos
        </Link>
      </nav>

      {state.status === 'loading' ? (
        <p className="text-sm text-text-muted">Cargando el objetivo...</p>
      ) : null}

      {state.status === 'error' ? (
        <div className="grid gap-4">
          <FeedbackAlert variant="warning" title="No pudimos mostrar el objetivo">
            {state.message}
          </FeedbackAlert>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={retry}>
              Reintentar
            </Button>
            <Button asChild variant="ghost">
              <Link href="/wallet/objectives">Ver mis objetivos</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <header className="grid gap-3 border-b border-border-default pb-6">
            <p className="text-sm font-semibold text-teal-700">
              {state.objective.objectiveTypeLabel}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">
              {state.objective.title}
            </h1>
            <p className="text-sm text-text-muted">
              Objetivo confirmado el {state.objective.createdAtLabel}
            </p>
          </header>

          <section aria-labelledby="objective-requirements-title" className="grid gap-4">
            <h2
              id="objective-requirements-title"
              className="text-2xl font-bold tracking-tight text-text-strong"
            >
              Requisitos del objetivo
            </h2>
            <ol className="grid list-none gap-0">
              {state.objective.requirements.map((requirement, index) => (
                <li
                  key={requirement.requirementId}
                  className="grid gap-2 border-b border-border-default py-4 last:border-b-0"
                >
                  <div className="flex gap-3">
                    <span className="text-sm font-semibold text-text-muted">
                      {index + 1}.
                    </span>
                    <p className="min-w-0 leading-7 text-text-default">
                      {requirement.requirementText}
                    </p>
                  </div>
                  <p className="pl-7 text-xs text-text-muted">
                    {requirement.originLabel}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {state.objective.sourceOriginalText !== null ? (
            <details className="rounded-card border border-border-default bg-surface p-5">
              <summary className="cursor-pointer text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                Texto original del objetivo
              </summary>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
                {state.objective.sourceOriginalText}
              </p>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
