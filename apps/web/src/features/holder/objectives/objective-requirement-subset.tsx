'use client';

/**
 * Objetivos guardados antes del tope de 15 requisitos — P0.
 *
 * Un objetivo con mas de 15 requisitos se sigue leyendo, y sus analisis ya
 * completados tambien. Lo que no se puede es iniciar un analisis nuevo sobre el:
 * cada requisito es una llamada al modelo en serie.
 *
 * La salida NO modifica el objetivo: crea uno NUEVO con los requisitos que la
 * persona elija (hasta 15), con su texto, su procedencia y su cita tal como
 * estaban. No se usa el endpoint de revisiones: su semantica frente a los
 * analisis existentes sigue diferida, y una revision marcaria al original como
 * reemplazado.
 *
 * No hay preseleccion: elegir "los primeros 15" seria decidir por orden de
 * aparicion, que es justo lo que este P0 evita.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import {
  buildSubsetObjectiveBody,
  MAX_OBJECTIVE_REQUIREMENTS
} from '@/features/holder/objectives/review-draft';
import { createObjectiveRequest } from '@/lib/api/objectives-api';
import { mapObjectiveCreateError } from '@/lib/errors/objective-error-mapper';
import { useSession } from '@/lib/session/session-provider';
import type { ObjectiveDetailVM } from '@/models/objectives';

export function ObjectiveRequirementSubset({ objective }: { objective: ObjectiveDetailVM }) {
  const router = useRouter();
  const { requestAuthenticated } = useSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = objective.requirements.length;
  const full = selected.length >= MAX_OBJECTIVE_REQUIREMENTS;

  function toggle(requirementId: string) {
    setSelected((current) =>
      current.includes(requirementId)
        ? current.filter((id) => id !== requirementId)
        : current.length >= MAX_OBJECTIVE_REQUIREMENTS
          ? current
          : [...current, requirementId]
    );
  }

  async function create() {
    if (creating || selected.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createObjectiveRequest(
        requestAuthenticated,
        buildSubsetObjectiveBody(objective, selected)
      );
      router.push(`/wallet/objectives/${created.objectiveReference}`);
    } catch (requestError) {
      setError(mapObjectiveCreateError(requestError).message);
      setCreating(false);
    }
  }

  return (
    <section aria-labelledby="objective-subset-title" className="grid gap-4">
      <FeedbackAlert variant="warning" title="Este objetivo tiene más requisitos de los que se analizan">
        Tiene {total} requisitos y un análisis admite hasta {MAX_OBJECTIVE_REQUIREMENTS}. Podés
        seguir viendo este objetivo y sus análisis anteriores. Para analizarlo de nuevo, elegí hasta{' '}
        {MAX_OBJECTIVE_REQUIREMENTS} requisitos: se crea un objetivo nuevo y este queda como está.
      </FeedbackAlert>

      {open ? (
        <div className="grid gap-3 rounded-card border border-border-default bg-surface p-4">
          <h2 id="objective-subset-title" className="text-base font-bold text-text-strong">
            Elegí los requisitos a analizar
          </h2>
          <p className="text-xs text-text-muted" aria-live="polite">
            {selected.length} de hasta {MAX_OBJECTIVE_REQUIREMENTS} elegidos
          </p>
          <ul className="grid list-none gap-2">
            {objective.requirements.map((requirement) => {
              const checked = selected.includes(requirement.requirementId);
              return (
                <li key={requirement.requirementId}>
                  <label className="flex items-start gap-3 text-sm text-text-default">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggle(requirement.requirementId)}
                      className="mt-1"
                    />
                    <span>{requirement.requirementText}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {error ? (
            <FeedbackAlert variant="warning" title="No pudimos crear el objetivo">
              {error}
            </FeedbackAlert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => void create()}
              disabled={creating || selected.length === 0}
            >
              {creating ? 'Creando...' : 'Crear objetivo con los elegidos'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Elegir hasta {MAX_OBJECTIVE_REQUIREMENTS} requisitos para analizar
          </Button>
        </div>
      )}
    </section>
  );
}
