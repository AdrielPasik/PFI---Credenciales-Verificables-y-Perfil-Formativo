'use client';

/**
 * Objetivo confirmado — P2.3 + P2.4B.
 *
 * CAMBIO DE PROPOSITO DE LA PAGINA. En P2.3 esta pantalla era un volcado de lo
 * confirmado: titulo, lista de requisitos, texto original. Leia como una fila de
 * base de datos porque, literalmente, eso mostraba.
 *
 * Ahora la pregunta que la pagina responde es otra: "¿que puede justificar mi
 * trayectoria frente a esto?". La jerarquia cambia en consecuencia:
 *
 *     1. de que objetivo se trata
 *     2. que concluyo Scope para cada requisito, y con que evidencia
 *     3. los requisitos confirmados, como referencia
 *     4. el texto original, plegado
 *
 * El objetivo confirmado sigue siendo de SOLO LECTURA: el backend no expone
 * `PATCH` y una revision crea siempre una fila nueva.
 *
 * ANCHO CONTENIDO. `max-w-3xl` centrado: los fragmentos de evidencia son texto
 * para leer, y a 1440px una linea de borde a borde es ilegible.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { HolderBreadcrumbs } from '@/features/holder/holder-breadcrumbs';
import { ObjectiveReasoningPanel } from '@/features/holder/objectives/objective-reasoning-panel';
import { getMyObjectiveRequest } from '@/lib/api/objectives-api';
import { mapObjectiveReadError } from '@/lib/errors/objective-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type { ObjectiveDetailVM } from '@/models/objectives';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; objective: ObjectiveDetailVM }
  | { status: 'error'; message: string };

function ObjectiveContextDisclosure({ objective }: { objective: ObjectiveDetailVM }) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = 'objective-context-content';

  return (
    <section className="rounded-card border border-border-default bg-surface p-5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((current) => !current)}
        className="text-left text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
      >
        {isOpen ? 'Ocultar contexto del objetivo' : 'Ver contexto del objetivo'}
      </button>
      <div id={contentId} hidden={!isOpen} className="mt-5 grid min-w-0 gap-6">
          <div className="grid min-w-0 gap-3">
            <h2 className="text-lg font-bold tracking-tight text-text-strong">
              Requisitos confirmados
            </h2>
            <ol className="grid list-none gap-3">
              {objective.requirements.map((requirement, index) => (
                <li
                  key={requirement.requirementId}
                  className="grid min-w-0 gap-2 rounded-card border border-border-default bg-surface-muted p-4"
                >
                  <div className="flex min-w-0 gap-3">
                    <span className="text-sm font-semibold text-text-muted">{index + 1}</span>
                    <p className="min-w-0 break-words leading-7 text-text-default">
                      {requirement.requirementText}
                    </p>
                  </div>
                  <p className="pl-7 text-xs text-text-muted">{requirement.originLabel}</p>
                </li>
              ))}
            </ol>
          </div>

          {objective.sourceOriginalText !== null ? (
            <div className="grid min-w-0 gap-2 border-t border-border-default pt-5">
              <h2 className="text-lg font-bold tracking-tight text-text-strong">
                Texto original del objetivo
              </h2>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
                {objective.sourceOriginalText}
              </p>
            </div>
          ) : null}
      </div>
    </section>
  );
}

export function ObjectiveDetailRoute() {
  const params = useParams<{ objectiveId: string }>();
  const objectiveReference =
    typeof params.objectiveId === 'string' ? params.objectiveId : '';
  const { requestAuthenticated } = useSession();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [hasCompletedSynthesis, setHasCompletedSynthesis] = useState(false);
  const [reasoningPresentationResolved, setReasoningPresentationResolved] =
    useState(false);

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

  const handleCompletedSynthesisChange = useCallback((value: boolean) => {
    setHasCompletedSynthesis(value);
    setReasoningPresentationResolved(true);
  }, []);

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-10">
      <HolderBreadcrumbs
        items={[
          { label: 'Mi perfil formativo', href: '/wallet' },
          { label: 'Objetivos', href: '/wallet/objectives' },
          { label: state.status === 'ready' ? state.objective.title : 'Objetivo' }
        ]}
      />

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
          <header className="grid min-w-0 gap-3 border-b border-border-default pb-7">
            <p className="text-sm font-semibold text-teal-700">
              {state.objective.objectiveTypeLabel}
            </p>
            <h1 className="min-w-0 break-words text-3xl font-bold tracking-tight text-text-strong sm:text-4xl">
              {state.objective.title}
            </h1>
            <p className="text-sm text-text-muted">
              {hasCompletedSynthesis
                ? `${state.objective.requirements.length} ${
                    state.objective.requirements.length === 1 ? 'requisito confirmado' : 'requisitos confirmados'
                  }`
                : `Objetivo confirmado el ${state.objective.createdAtLabel} · ${
                    state.objective.requirements.length
                  } ${state.objective.requirements.length === 1 ? 'requisito' : 'requisitos'}`}
            </p>
          </header>

          {/*
            EL ANALISIS VA PRIMERO. Es la capacidad de esta pantalla; los
            requisitos confirmados pasan a ser la referencia que la sostiene.
            El panel se monta con la referencia del objetivo y resuelve solo el
            estado real del run — no recibe nada precalculado desde aca.
          */}
          <ObjectiveReasoningPanel
            objectiveReference={objectiveReference}
            onCompletedSynthesisChange={handleCompletedSynthesisChange}
            completedSynthesisContext={<ObjectiveContextDisclosure objective={state.objective} />}
          />

          {reasoningPresentationResolved && !hasCompletedSynthesis ? (
            <>
              <section
                aria-labelledby="objective-requirements-title"
                className="grid min-w-0 gap-4 border-t border-border-default pt-8"
              >
                <div className="grid gap-1">
                  <h2
                    id="objective-requirements-title"
                    className="text-xl font-bold tracking-tight text-text-strong"
                  >
                    Requisitos confirmados
                  </h2>
                  <p className="text-sm text-text-muted">
                    Los requisitos que confirmaste para este objetivo, en el orden en
                    que los dejaste.
                  </p>
                </div>
                <ol className="grid list-none gap-3">
                  {state.objective.requirements.map((requirement, index) => (
                    <li
                      key={requirement.requirementId}
                      className="grid min-w-0 gap-2 rounded-card border border-border-default bg-surface p-4"
                    >
                      <div className="flex min-w-0 gap-3">
                        <span className="text-sm font-semibold text-text-muted">
                          {index + 1}
                        </span>
                        <p className="min-w-0 break-words leading-7 text-text-default">
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
        </>
      ) : null}
    </div>
  );
}
