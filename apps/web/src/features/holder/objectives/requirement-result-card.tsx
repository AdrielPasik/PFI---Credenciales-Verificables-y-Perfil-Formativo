'use client';

/**
 * Resultado de UN requisito — P2.4B.
 *
 * SEMANTICA VISUAL CONTENIDA, y es una decision de producto, no estetica. Nada
 * de verde/rojo, tildes ni cruces: "Respaldado" no es aprobar y "Evidencia
 * insuficiente" no es reprobar. El estado se distingue por la ETIQUETA —texto,
 * nunca solo color— y por un tono de superficie discreto.
 *
 * El copy sale de `FINAL_STATE_DESCRIPTIONS`, que es texto fijo por estado. No
 * se genera, no se resume y no se parsea nada: el `explanation` de diagnostico
 * ni siquiera viaja al navegador.
 */

import {
  FINAL_STATE_DESCRIPTIONS,
  FINAL_STATE_LABELS,
  type RequirementFinalState,
  type RequirementResultVM
} from '@/models/reasoning-runs';
import { evidencePresentationFor } from '@/features/holder/objectives/evidence-presentation';
import { ReasoningEvidenceList } from '@/features/holder/objectives/reasoning-evidence-list';

/**
 * Acento por estado. Solo el borde izquierdo y el color del texto de la
 * etiqueta; nunca un fondo de alarma ni un semaforo.
 */
const STATE_ACCENT: Record<RequirementFinalState, string> = {
  SUPPORTED: 'border-l-teal-700',
  PARTIALLY_SUPPORTED: 'border-l-teal-600',
  INSUFFICIENT_EVIDENCE: 'border-l-border-strong',
  NOT_ASSESSABLE: 'border-l-border-strong',
  ABSTAIN: 'border-l-border-strong'
};

const STATE_TEXT: Record<RequirementFinalState, string> = {
  SUPPORTED: 'text-teal-800',
  PARTIALLY_SUPPORTED: 'text-teal-800',
  INSUFFICIENT_EVIDENCE: 'text-text-muted',
  NOT_ASSESSABLE: 'text-text-muted',
  ABSTAIN: 'text-text-muted'
};

export function RequirementResultCard({
  result,
  order
}: {
  result: RequirementResultVM;
  order: number;
}) {
  const headingId = `requirement-result-${result.requirementId}`;

  return (
    <article
      aria-labelledby={headingId}
      className={`grid min-w-0 gap-4 rounded-card border border-border-default border-l-4 bg-surface p-5 shadow-xs sm:p-6 ${STATE_ACCENT[result.finalState]}`}
    >
      <header className="grid min-w-0 gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Requisito {order}
        </p>
        <h3
          id={headingId}
          className="min-w-0 break-words text-lg font-semibold leading-7 text-text-strong"
        >
          {result.requirementText}
        </h3>
        {/*
          La etiqueta es TEXTO. Quien no distingue los tonos de acento lee
          exactamente la misma conclusion.
        */}
        <p className={`text-sm font-semibold ${STATE_TEXT[result.finalState]}`}>
          {FINAL_STATE_LABELS[result.finalState]}
        </p>
      </header>

      <p className="min-w-0 text-sm leading-6 text-text-muted">
        {FINAL_STATE_DESCRIPTIONS[result.finalState]}
      </p>

      {/*
        Lo que SI puede sostenerse. Es texto persistido del propio run —el claim
        mas debil que su busqueda encontro defendible—, no una descripcion
        generada de "lo que falta": eso el backend no lo expone y no se inventa.
      */}
      {result.supportedWeakerClaim !== null ? (
        <div className="grid min-w-0 gap-1 rounded-control bg-surface-muted p-4">
          <p className="text-sm font-semibold text-text-strong">
            Lo que si puede justificarse con la evidencia disponible
          </p>
          <p className="min-w-0 break-words text-sm leading-6 text-text-default">
            {result.supportedWeakerClaim}
          </p>
        </div>
      ) : null}

      {/*
        El papel de la evidencia lo decide el ESTADO FINAL, no la existencia de
        evidencia. Bajo NOT_ASSESSABLE no se dibuja ninguna tarjeta: la policy
        decidio ese estado sin mirar la evidencia, asi que mostrarla debajo
        sugeriria una participacion que no hubo. `evidence[]` no se toca.
      */}
      <ReasoningEvidenceList
        evidence={result.evidence}
        requirementId={result.requirementId}
        presentation={evidencePresentationFor(
          result.finalState,
          result.evidence.length
        )}
      />
    </article>
  );
}
