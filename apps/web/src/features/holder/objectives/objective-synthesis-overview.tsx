'use client';

import { useState } from 'react';

import {
  CREDENTIAL_CURRENT_STATUS_LABELS,
  FINAL_STATE_LABELS,
  type ObjectiveSynthesisVM,
  type RequirementFinalState
} from '@/models/reasoning-runs';

const STATE_DESCRIPTORS: Array<{
  key: keyof ObjectiveSynthesisVM['stateSummary'];
  label: (count: number) => string;
}> = [
  {
    key: 'supportedCount',
    label: (count) => `${count} ${count === 1 ? 'respaldado' : 'respaldados'}`
  },
  {
    key: 'partiallySupportedCount',
    label: (count) =>
      `${count} ${count === 1 ? 'respaldado parcialmente' : 'respaldados parcialmente'}`
  },
  {
    key: 'insufficientEvidenceCount',
    label: (count) => `${count} con evidencia insuficiente`
  },
  {
    key: 'abstainCount',
    label: (count) => `${count} sin conclusión confiable`
  },
  {
    key: 'notAssessableCount',
    label: (count) => `${count} no evaluables con evidencia formativa`
  }
];

function requirementNoun(count: number) {
  return count === 1 ? 'requisito' : 'requisitos';
}

function overviewCopy(synthesis: ObjectiveSynthesisVM): string[] {
  const summary = synthesis.stateSummary;
  const total = Object.values(summary).reduce((value, count) => value + count, 0);

  if (total > 0 && summary.notAssessableCount === total) {
    return [
      'Los requisitos de este objetivo no pueden evaluarse con evidencia formativa disponible.'
    ];
  }

  const paragraphs: string[] = [];
  if (summary.supportedCount > 0) {
    paragraphs.push(
      `Este análisis encontró respaldo formativo para ${summary.supportedCount} ${requirementNoun(summary.supportedCount)}${
        summary.partiallySupportedCount > 0
          ? ` y respaldo parcial para ${summary.partiallySupportedCount} ${requirementNoun(summary.partiallySupportedCount)}`
          : ''
      }.`
    );
  } else if (summary.partiallySupportedCount > 0) {
    paragraphs.push(
      `Este análisis encontró respaldo formativo parcial para ${summary.partiallySupportedCount} ${requirementNoun(summary.partiallySupportedCount)}.`
    );
  } else {
    paragraphs.push(
      'Este análisis no identificó requisitos respaldados ni parcialmente respaldados con la evidencia formativa disponible.'
    );
    paragraphs.push(
      'Esto describe únicamente la evidencia disponible en tus credenciales para este objetivo.'
    );
  }

  return paragraphs;
}

function statusLabel(status: string): string {
  return CREDENTIAL_CURRENT_STATUS_LABELS[status] ?? status;
}

function PositiveConclusion({
  conclusion,
  synthesis,
  onRequirementDetail
}: {
  conclusion: ObjectiveSynthesisVM['positiveConclusions'][number];
  synthesis: ObjectiveSynthesisVM;
  onRequirementDetail?: (requirementId: string) => void;
}) {
  const supportingCredentials = conclusion.supportingCredentialReferences.flatMap(
    (reference) => {
      const credential = synthesis.credentialsSupportingPositiveConclusions.find(
        (candidate) => candidate.credentialReference === reference
      );
      return credential === undefined ? [] : [credential];
    }
  );

  return (
    <article className="grid min-w-0 gap-4 rounded-card border border-border-default bg-surface p-5">
      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-semibold text-teal-800">
          {FINAL_STATE_LABELS[conclusion.finalState as RequirementFinalState]}
        </p>
        <h4 className="min-w-0 break-words text-base font-semibold leading-7 text-text-strong">
          {conclusion.requirementText}
        </h4>
      </div>

      {conclusion.supportedWeakerClaim !== null ? (
        <div className="grid min-w-0 gap-1 rounded-control bg-surface-muted p-4">
          <p className="text-sm font-semibold text-text-strong">Lo que sí puede justificarse</p>
          <p className="min-w-0 break-words text-sm leading-6 text-text-default">
            {conclusion.supportedWeakerClaim}
          </p>
        </div>
      ) : null}

      {supportingCredentials.length > 0 ? (
        <ul className="grid min-w-0 list-none gap-2">
          {supportingCredentials.map((credential, index) => (
            <li
              key={`${credential.credentialReference}-${index}`}
              className="min-w-0 rounded-control border border-border-default bg-surface-muted px-3 py-2"
            >
              <p className="min-w-0 break-words text-sm font-semibold text-text-strong">
                {credential.credentialDisplay.title}
              </p>
              <p className="min-w-0 break-words text-xs text-text-muted">
                {credential.credentialDisplay.issuerName} · Estado actual:{' '}
                {statusLabel(credential.credentialDisplay.currentStatus)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <p>
        <button
          type="button"
          onClick={() => onRequirementDetail?.(conclusion.requirementId)}
          className="text-sm font-semibold text-teal-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          aria-label={`Ver el detalle del requisito: ${conclusion.requirementText}`}
        >
          Ver detalle del requisito
        </button>
      </p>
    </article>
  );
}

export function ObjectiveSynthesisOverview({
  synthesis,
  completedAtLabel,
  onRequirementDetail,
  showMetadata = true
}: {
  synthesis: ObjectiveSynthesisVM;
  completedAtLabel: string | null;
  onRequirementDetail?: (requirementId: string) => void;
  showMetadata?: boolean;
}) {
  const [showRemaining, setShowRemaining] = useState(false);
  const visibleConclusions = showRemaining
    ? synthesis.positiveConclusions
    : synthesis.positiveConclusions.slice(0, 3);
  const hasRemainingConclusions = synthesis.positiveConclusions.length > 3;

  return (
    <section aria-labelledby="objective-reasoning-title" className="grid min-w-0 gap-6">
      <div className="grid min-w-0 gap-2">
        <h2
          id="objective-reasoning-title"
          className="text-2xl font-bold tracking-tight text-text-strong"
        >
          Tu trayectoria frente a este objetivo
        </h2>
        {overviewCopy(synthesis).map((paragraph) => (
          <p key={paragraph} className="max-w-2xl text-sm leading-6 text-text-muted">
            {paragraph}
          </p>
        ))}
      </div>

      {showMetadata ? (
        <ObjectiveSynthesisMetadata
          synthesis={synthesis}
          completedAtLabel={completedAtLabel}
        />
      ) : null}

      {synthesis.positiveConclusions.length > 0 ? (
        <section aria-labelledby="positive-conclusions-title" className="grid min-w-0 gap-4">
          <div className="grid gap-1">
            <h3
              id="positive-conclusions-title"
              className="text-xl font-bold tracking-tight text-text-strong"
            >
              Conclusiones respaldadas por tu formación
            </h3>
            <p className="text-sm text-text-muted">
              Estas conclusiones se basan en la evidencia disponible para este análisis.
            </p>
          </div>
          <ol id="remaining-positive-conclusions" className="grid min-w-0 list-none gap-4">
            {visibleConclusions.map((conclusion) => (
              <li key={conclusion.requirementId} className="min-w-0">
                <PositiveConclusion
                  conclusion={conclusion}
                  synthesis={synthesis}
                  onRequirementDetail={onRequirementDetail}
                />
              </li>
            ))}
          </ol>
          {hasRemainingConclusions ? (
            <button
              type="button"
              aria-expanded={showRemaining}
              aria-controls="remaining-positive-conclusions"
              onClick={() => setShowRemaining((current) => !current)}
              className="justify-self-start text-sm font-semibold text-teal-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              {showRemaining ? 'Ocultar conclusiones restantes' : 'Ver conclusiones restantes'}
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

export function ObjectiveSynthesisMetadata({
  synthesis,
  completedAtLabel
}: {
  synthesis: ObjectiveSynthesisVM;
  completedAtLabel: string | null;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      {completedAtLabel ? (
        <p className="text-sm text-text-muted">Analizado el {completedAtLabel}.</p>
      ) : null}
      <ul aria-label="Resumen descriptivo del análisis" className="flex min-w-0 flex-wrap gap-2">
        {STATE_DESCRIPTORS.map(({ key, label }) => {
          const count = synthesis.stateSummary[key];
          if (count === 0) return null;
          return (
            <li
              key={key}
              className="rounded-control border border-border-default bg-surface-muted px-3 py-2 text-sm text-text-default"
            >
              {label(count)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
