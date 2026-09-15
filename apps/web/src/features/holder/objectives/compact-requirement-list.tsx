'use client';

import { useState } from 'react';

import { evidencePresentationFor } from '@/features/holder/objectives/evidence-presentation';
import { ReasoningEvidenceList } from '@/features/holder/objectives/reasoning-evidence-list';
import {
  FINAL_STATE_DESCRIPTIONS,
  FINAL_STATE_LABELS,
  type ObjectiveSynthesisVM,
  type RequirementFinalState,
  type RequirementResultVM
} from '@/models/reasoning-runs';

export type RequirementFilter = 'ALL' | RequirementFinalState;

const FILTERS: Array<{
  value: Exclude<RequirementFilter, 'ALL'>;
  label: string;
  countKey: keyof ObjectiveSynthesisVM['stateSummary'];
}> = [
  { value: 'SUPPORTED', label: 'Respaldados', countKey: 'supportedCount' },
  {
    value: 'PARTIALLY_SUPPORTED',
    label: 'Respaldados parcialmente',
    countKey: 'partiallySupportedCount'
  },
  {
    value: 'INSUFFICIENT_EVIDENCE',
    label: 'Evidencia insuficiente',
    countKey: 'insufficientEvidenceCount'
  },
  { value: 'ABSTAIN', label: 'Sin conclusión confiable', countKey: 'abstainCount' },
  {
    value: 'NOT_ASSESSABLE',
    label: 'No evaluables',
    countKey: 'notAssessableCount'
  }
];

const COMPACT_EXPLANATIONS: Partial<Record<RequirementFinalState, string>> = {
  INSUFFICIENT_EVIDENCE: 'La evidencia disponible no alcanza para justificarlo.',
  ABSTAIN: 'No fue posible llegar a una conclusión confiable.',
  NOT_ASSESSABLE: 'No se evalúa con credenciales formativas.'
};

function evidenceDisclosureLabel(finalState: RequirementFinalState): string | null {
  switch (finalState) {
    case 'SUPPORTED':
      return 'Ver evidencia que respalda este requisito';
    case 'PARTIALLY_SUPPORTED':
      return 'Ver evidencia que respalda parcialmente este requisito';
    case 'INSUFFICIENT_EVIDENCE':
      return 'Ver evidencia disponible';
    case 'ABSTAIN':
      return 'Ver evidencia vinculada al análisis';
    case 'NOT_ASSESSABLE':
      return null;
  }
}

export function requirementMatchesFilter(
  result: RequirementResultVM,
  filter: RequirementFilter
): boolean {
  return filter === 'ALL' || result.finalState === filter;
}

function CompactRequirementCard({
  result,
  order,
  expanded,
  onToggle
}: {
  result: RequirementResultVM;
  order: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const cardId = `requirement-result-${result.requirementId}`;
  const detailId = `${cardId}-detail`;
  const evidenceId = `${cardId}-evidence`;
  const presentation = evidencePresentationFor(result.finalState, result.evidence.length);
  const evidenceLabel = evidenceDisclosureLabel(result.finalState);

  return (
    <article
      id={cardId}
      tabIndex={-1}
      aria-labelledby={`${cardId}-title`}
      className="scroll-mt-6 grid min-w-0 gap-3 rounded-card border border-border-default bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-5">
        <div className="grid min-w-0 gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Requisito {order}
          </p>
          <h4
            id={`${cardId}-title`}
            className="min-w-0 break-words text-base font-semibold leading-7 text-text-strong"
          >
            {result.requirementText}
          </h4>
          <p className="text-sm font-semibold text-text-default">
            {FINAL_STATE_LABELS[result.finalState]}
          </p>
          {COMPACT_EXPLANATIONS[result.finalState] !== undefined ? (
            <p className="text-sm leading-6 text-text-muted">
              {COMPACT_EXPLANATIONS[result.finalState]}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          className="w-fit text-sm font-semibold text-teal-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {expanded ? 'Ocultar detalle' : 'Ver detalle'}
        </button>
      </div>

      {expanded ? (
        <div id={detailId} className="grid min-w-0 gap-4 border-t border-border-default pt-4">
          <p className="min-w-0 text-sm leading-6 text-text-muted">
            {FINAL_STATE_DESCRIPTIONS[result.finalState]}
          </p>
          {result.supportedWeakerClaim !== null ? (
            <div className="grid min-w-0 gap-1 rounded-control bg-surface-muted p-4">
              <p className="text-sm font-semibold text-text-strong">Lo que sí puede justificarse</p>
              <p className="min-w-0 break-words text-sm leading-6 text-text-default">
                {result.supportedWeakerClaim}
              </p>
            </div>
          ) : null}
          {evidenceLabel !== null && presentation.visible ? (
            <div>
              <button
                type="button"
                aria-expanded={evidenceOpen}
                aria-controls={evidenceId}
                onClick={() => setEvidenceOpen((current) => !current)}
                className="text-sm font-semibold text-teal-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                {evidenceOpen ? 'Ocultar evidencia' : evidenceLabel}
              </button>
              {evidenceOpen ? (
                <div id={evidenceId} className="mt-4">
                  <ReasoningEvidenceList
                    evidence={result.evidence}
                    requirementId={result.requirementId}
                    presentation={presentation}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CompactRequirementList({
  results,
  synthesis,
  activeFilter,
  expandedIds,
  onFilterChange,
  onToggle
}: {
  results: readonly RequirementResultVM[];
  synthesis: ObjectiveSynthesisVM;
  activeFilter: RequirementFilter;
  expandedIds: ReadonlySet<string>;
  onFilterChange: (filter: RequirementFilter) => void;
  onToggle: (requirementId: string) => void;
}) {
  const filtersVisible = results.length > 3;
  const visibleResults = results
    .map((result, index) => ({ result, order: index + 1 }))
    .filter(({ result }) => requirementMatchesFilter(result, activeFilter));

  return (
    <div className="grid min-w-0 gap-4">
      {filtersVisible ? (
        <div aria-label="Filtrar requisitos" className="flex min-w-0 flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={activeFilter === 'ALL'}
            onClick={() => onFilterChange('ALL')}
            className="rounded-control border border-border-default px-3 py-2 text-sm font-semibold text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            Todos ({results.length})
          </button>
          {FILTERS.filter(({ countKey }) => synthesis.stateSummary[countKey] > 0).map(
            ({ value, label, countKey }) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeFilter === value}
                onClick={() => onFilterChange(value)}
                className="rounded-control border border-border-default px-3 py-2 text-sm font-semibold text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                {label} ({synthesis.stateSummary[countKey]})
              </button>
            )
          )}
        </div>
      ) : null}
      <ol className="grid min-w-0 list-none gap-3">
        {visibleResults.map(({ result, order }) => (
          <li key={result.requirementId} className="min-w-0">
            <CompactRequirementCard
              key={`${result.requirementId}-${expandedIds.has(result.requirementId) ? 'expanded' : 'collapsed'}`}
              result={result}
              order={order}
              expanded={expandedIds.has(result.requirementId)}
              onToggle={() => onToggle(result.requirementId)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
