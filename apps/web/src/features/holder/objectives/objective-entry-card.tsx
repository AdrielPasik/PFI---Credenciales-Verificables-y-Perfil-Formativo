/**
 * Entrada a Objetivos desde /wallet — P2.3.
 *
 * La accion principal ("Analizar un objetivo") vive en la banda de bienvenida.
 * Esta tarjeta da continuidad: muestra el objetivo mas reciente y lleva a la
 * lista. "Ver mis objetivos" esta SIEMPRE visible; la ruta de lista ya tiene su
 * estado vacio.
 *
 * El objetivo reciente llega de la misma lista que usa /wallet/objectives
 * (`GET /me/objectives`, ordenada por fecha descendente). Mientras carga se
 * reserva el mismo alto, para no mover la pantalla. Si falla, la tarjeta sigue
 * siendo util sin ese dato: la lista muestra su propio error.
 */

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type { ObjectiveSummaryVM } from '@/models/objectives';

export type LatestObjectiveState =
  | { status: 'loading' }
  | { status: 'ready'; objective: ObjectiveSummaryVM | null }
  | { status: 'unavailable' };

export function ObjectiveEntryCard({ latest }: { latest?: LatestObjectiveState }) {
  return (
    <section
      aria-labelledby="wallet-objectives-title"
      className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-5 shadow-card sm:p-6"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">Objetivos</p>
        <h2
          id="wallet-objectives-title"
          className="mt-1 text-xl font-semibold tracking-tight text-text-strong"
        >
          Analizá tu trayectoria en contexto
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          Usá una búsqueda laboral, beca, admisión u otro objetivo para entender qué
          podés justificar con la evidencia de tus credenciales.
        </p>
      </div>

      {latest ? <LatestObjective state={latest} /> : null}

      <Button asChild variant="secondary" className="w-fit">
        <Link href="/wallet/objectives">Ver mis objetivos</Link>
      </Button>
    </section>
  );
}

function LatestObjective({ state }: { state: LatestObjectiveState }) {
  if (state.status === 'unavailable') return null;

  if (state.status === 'loading') {
    return (
      <p
        role="status"
        className="flex min-h-16 items-center rounded-control border border-border-default bg-surface-muted px-3.5 text-sm text-text-muted"
      >
        Cargando tu objetivo más reciente
      </p>
    );
  }

  if (state.objective === null) {
    return (
      <p className="flex min-h-16 items-center rounded-control border border-dashed border-border-strong px-3.5 text-sm text-text-muted">
        Todavía no analizaste un objetivo.
      </p>
    );
  }

  const { objective } = state;
  return (
    <Link
      href={`/wallet/objectives/${encodeURIComponent(objective.objectiveReference)}`}
      className="group flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-control border border-border-default bg-surface-muted px-3.5 py-2.5 transition-colors hover:border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <span className="min-w-0">
        <span className="block text-xs text-text-muted">Más reciente</span>
        <span className="block truncate font-semibold text-text-strong">{objective.title}</span>
        <span className="block text-xs text-text-muted">
          {objective.objectiveTypeLabel} · {objective.createdAtLabel}
        </span>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-accent" />
    </Link>
  );
}
