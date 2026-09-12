'use client';

/**
 * Evidencia de un requisito — P2.4B.
 *
 * Es el diferencial de Scope: la persona no lee "tenes esto", lee la frase
 * exacta de su propia credencial, y puede abrir esa credencial.
 *
 * QUE SIGNIFICA esa evidencia NO se decide aca: llega ya resuelto en
 * `presentation`, derivado del estado final por `evidencePresentationFor`. Este
 * componente dibuja; no interpreta. Un titulo fijo seria una afirmacion sobre
 * el papel probatorio de la evidencia, y ese papel cambia con el estado.
 *
 * TODO LO QUE SE MUESTRA VIENE RESUELTO DEL SERVIDOR. Aca no se resuelve ningun
 * `src_NN`, no se cruza nada contra el perfil y no se empareja por texto. Si el
 * backend no mando credencial, no se le inventa una.
 */

import Link from 'next/link';

import type { EvidencePresentation } from '@/features/holder/objectives/evidence-presentation';
import {
  SOURCE_KIND_LABELS,
  groupEvidenceByCredential,
  type ReasoningEvidenceVM
} from '@/models/reasoning-runs';

export function ReasoningEvidenceList({
  evidence,
  requirementId,
  presentation
}: {
  evidence: readonly ReasoningEvidenceVM[];
  requirementId: string;
  presentation: EvidencePresentation;
}) {
  // `visible` ya contempla la lista vacia y el ocultamiento de NOT_ASSESSABLE.
  // Sin evidencia no se dibuja un contenedor vacio: un titulo sobre la nada
  // sugiere que falta algo por cargar.
  if (!presentation.visible || presentation.heading === null) return null;

  // Agrupado por `credentialReference`, que es identidad autoritativa. Nunca por
  // titulo, emisor ni parecido.
  const groups = groupEvidenceByCredential(evidence);

  return (
    <section className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1">
        <h4 className="text-sm font-semibold text-text-strong">
          {presentation.heading}
        </h4>
        {presentation.clarification !== null ? (
          <p className="min-w-0 text-sm leading-6 text-text-muted">
            {presentation.clarification}
          </p>
        ) : null}
      </div>
      <ul className="grid min-w-0 list-none gap-4">
        {groups.map((group, groupIndex) => (
          <li
            key={`${requirementId}-${group.credential?.credentialReference ?? 'sin-credencial'}-${groupIndex}`}
            className="grid min-w-0 gap-3 rounded-card border border-border-default bg-surface p-4"
          >
            {group.credential === null ? (
              <p className="text-sm text-text-muted">
                Fragmento de una fuente de tu trayectoria.
              </p>
            ) : (
              <div className="grid min-w-0 gap-1">
                <p className="min-w-0 break-words font-semibold text-text-strong">
                  {group.credential.title}
                </p>
                <p className="min-w-0 break-words text-sm text-text-muted">
                  {group.credential.issuerName}
                </p>
                {group.credential.currentStatus !== 'issued' ? (
                  // SIEMPRE en presente. El backend no tiene instantanea del
                  // estado al momento del run, asi que decir "se revoco despues
                  // del analisis" seria inventar historia. El resultado sigue
                  // siendo una observacion fechada y valida.
                  <p className="text-sm text-amber-700">
                    Estado actual de la credencial:{' '}
                    {group.credential.currentStatusLabel}
                  </p>
                ) : null}
              </div>
            )}

            <ul className="grid min-w-0 list-none gap-3">
              {group.items.map((item, itemIndex) => (
                <li key={`${requirementId}-${groupIndex}-${itemIndex}`}>
                  <EvidenceExcerpt evidence={item} />
                </li>
              ))}
            </ul>

            {group.credential !== null ? (
              <p>
                <Link
                  href={`/wallet/credentials/${encodeURIComponent(group.credential.credentialReference)}`}
                  className="text-sm font-semibold text-teal-700 underline underline-offset-2"
                >
                  Ver credencial: {group.credential.title}
                </Link>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceExcerpt({ evidence }: { evidence: ReasoningEvidenceVM }) {
  const hasContext =
    evidence.contextBefore !== null || evidence.contextAfter !== null;

  return (
    <div className="grid min-w-0 gap-2">
      {/*
        VERBATIM. `whitespace-pre-wrap` para no alterar visualmente una cita que
        el backend preserva exacta, y `break-words` para que un fragmento largo
        no desborde la tarjeta en pantallas angostas.
      */}
      <blockquote className="min-w-0 border-l-2 border-teal-700 pl-3 text-sm leading-6 text-text-default">
        <p className="min-w-0 whitespace-pre-wrap break-words">
          &ldquo;{evidence.excerpt}&rdquo;
        </p>
      </blockquote>

      <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
        {evidence.sectionLabel !== null ? (
          <span className="min-w-0 break-words">{evidence.sectionLabel}</span>
        ) : null}
        {/* Solo cuando el artefacto congelado la identifica. Nunca "Pagina 1". */}
        {evidence.pageNumber !== null ? (
          <span>Pagina {evidence.pageNumber}</span>
        ) : null}
        <span>{SOURCE_KIND_LABELS[evidence.sourceKind]}</span>
      </p>

      {/*
        Cobertura describe la EXTRACCION de la fuente, no el respaldo del
        requisito ni a la persona. Por eso el texto habla de la fuente y se
        muestra en tono de aviso, no de fallo.
      */}
      {evidence.coverage === 'PARTIAL' ? (
        <p className="text-xs text-text-muted">
          La extraccion de esta fuente fue parcial: puede haber contenido que
          Scope no llego a leer.
        </p>
      ) : null}
      {evidence.coverage === 'FAILED' ? (
        <p className="text-xs text-text-muted">
          Scope no pudo leer esta fuente completa. Este fragmento es lo que si
          quedo disponible.
        </p>
      ) : null}

      {hasContext ? (
        <details className="min-w-0">
          <summary className="cursor-pointer text-xs font-semibold text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
            Ver el fragmento en contexto
          </summary>
          <p className="mt-2 min-w-0 whitespace-pre-wrap break-words text-xs leading-6 text-text-muted">
            {evidence.contextBefore}
            <mark className="bg-teal-50 font-semibold text-text-strong">
              {evidence.excerpt}
            </mark>
            {evidence.contextAfter}
          </p>
        </details>
      ) : null}
    </div>
  );
}
