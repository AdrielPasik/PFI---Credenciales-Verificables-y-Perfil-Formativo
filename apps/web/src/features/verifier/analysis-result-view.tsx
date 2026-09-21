'use client';

/**
 * Resultado publico del analisis contextual.
 *
 * JERARQUIA, de arriba hacia abajo:
 *
 *   1. el objetivo que se preguntó
 *   2. el resumen de lo que la evidencia respalda
 *   3. requisito por requisito
 *   4. las credenciales que respaldan las conclusiones positivas
 *   5. el aviso temporal
 *
 * NO hay puntaje, porcentaje, ranking ni "match", y no hay semaforo: el estado
 * de cada requisito se lee con PALABRAS, no con color. El color acompana, nunca
 * significa solo.
 *
 * Todo lo que se muestra viene del contrato publico ya adaptado. Esta capa no
 * calcula estados, no cruza credenciales del perfil y no reconstruye nada.
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  PUBLIC_FINAL_STATE_EXPLANATIONS,
  type PublicAnalysisResultVM,
  type PublicFinalStateToken,
  type PublicRequirementResultVM,
  type PublicSupportingCredentialVM
} from '@/models/public-analysis';

/**
 * Tono por estado. NUNCA es la unica senal: cada tarjeta escribe el estado.
 * Sin verde/rojo de "aprobado/rechazado".
 */
const STATE_TONE: Record<PublicFinalStateToken, string> = {
  SUPPORTED: 'border-teal-700 bg-teal-50 text-teal-900',
  PARTIALLY_SUPPORTED: 'border-amber-700 bg-amber-50 text-amber-900',
  INSUFFICIENT_EVIDENCE: 'border-border-strong bg-surface-muted text-text-default',
  NOT_ASSESSABLE: 'border-border-strong bg-surface-muted text-text-default',
  ABSTAIN: 'border-border-strong bg-surface-muted text-text-default'
};

export function AnalysisResultView({ result }: { result: PublicAnalysisResultVM }) {
  const body = result.result;
  const objective = result.objective;
  if (body === null || objective === null) return null;

  return (
    <div className="grid gap-6">
      <Card className="min-w-0">
        <CardHeader className="gap-2">
          <p className="text-sm font-semibold text-teal-800">Objetivo analizado</p>
          <h2 className="break-words text-2xl font-bold tracking-tight text-text-strong">
            {objective.title ?? 'Análisis de trayectoria'}
          </h2>
          <p className="text-sm text-text-muted">{objective.objectiveTypeLabel}</p>
        </CardHeader>
        {objective.objectiveContext.trim().length > 0 ? (
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-default">
              {objective.objectiveContext}
            </p>
          </CardContent>
        ) : null}
      </Card>

      <Card className="min-w-0">
        <CardHeader className="gap-1">
          <h3 className="text-lg font-semibold text-text-strong">Qué respalda la evidencia compartida</h3>
          <p className="text-sm text-text-muted">
            {body.synthesis.totalRequirements === 1
              ? '1 requisito analizado'
              : `${body.synthesis.totalRequirements} requisitos analizados`}
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            {body.synthesis.stateSummary
              .filter((entry) => entry.count > 0)
              .map((entry) => (
                <div
                  key={entry.state}
                  className="flex items-baseline justify-between gap-3 rounded-control border border-border-default px-3 py-2"
                >
                  <dt className="text-sm text-text-default">{entry.label}</dt>
                  <dd className="text-sm font-semibold text-text-strong">{entry.count}</dd>
                </div>
              ))}
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="analysis-requirements-title" className="grid gap-4">
        <h3 id="analysis-requirements-title" className="text-lg font-semibold text-text-strong">
          Requisito por requisito
        </h3>
        {body.requirements.map((requirement) => (
          <RequirementResultCard key={requirement.order} requirement={requirement} />
        ))}
      </section>

      {body.synthesis.supportingCredentials.length > 0 ? (
        <Card className="min-w-0">
          <CardHeader className="gap-1">
            <h3 className="text-lg font-semibold text-text-strong">
              Credenciales que respaldan las conclusiones
            </h3>
            <p className="text-sm text-text-muted">
              Solo credenciales que esta persona autorizó para este análisis.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {body.synthesis.supportingCredentials.map((credential) => (
              <div
                key={credential.credentialReference}
                className="grid min-w-0 gap-2 rounded-control border border-border-default p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold text-text-strong">{credential.title}</p>
                  {credential.currentStatus === 'revoked' ? (
                    <Badge variant="outline" className="border-amber-700 text-amber-900">
                      Hoy: {credential.currentStatusLabel}
                    </Badge>
                  ) : null}
                </div>
                <p className="break-words text-sm text-text-muted">
                  {credential.credentialTypeLabel} · {credential.issuerName}
                </p>
                <p className="text-sm text-text-default">
                  {describeRequirementOrders(
                    credential.supportedRequirementOrders,
                    credential.partiallySupportedRequirementOrders
                  )}
                </p>
                <Button asChild size="sm" variant="secondary" className="w-fit">
                  <Link href={`/verify?credential=${encodeURIComponent(credential.credentialReference)}`}>
                    Verificar credencial
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <p className="rounded-card border border-border-default bg-surface-muted px-4 py-3 text-sm leading-6 text-text-muted">
        {body.temporalNotice}
        {result.completedAtLabel ? ` Análisis realizado el ${result.completedAtLabel}.` : ''}
      </p>
    </div>
  );
}

function RequirementResultCard({ requirement }: { requirement: PublicRequirementResultVM }) {
  // Cada estado no positivo dice LO SUYO. Una frase unica para los tres seria
  // mas corta y afirmaria, en dos de los tres casos, algo que no paso.
  const explanation = PUBLIC_FINAL_STATE_EXPLANATIONS[requirement.finalState];

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
          Requisito {requirement.order}
        </p>
        <p className="break-words text-base leading-7 font-medium text-text-strong">
          {requirement.requirementText}
        </p>
        <p
          className={`w-fit rounded-control border px-3 py-1 text-sm font-semibold ${STATE_TONE[requirement.finalState]}`}
        >
          {requirement.finalStateLabel}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {requirement.supportedWeakerClaim ? (
          <div className="rounded-control border-l-2 border-amber-700 bg-surface-muted px-3 py-2">
            <p className="text-xs font-semibold text-text-muted">Lo que sí queda respaldado</p>
            <p className="mt-1 break-words text-sm leading-6 text-text-default">
              {requirement.supportedWeakerClaim}
            </p>
          </div>
        ) : null}

        {requirement.supportingCredentials.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              Evidencia que lo respalda
            </p>
            <ul className="grid gap-2">
              {requirement.supportingCredentials.map((credential) => (
                <SupportingCredentialItem
                  key={credential.credentialReference}
                  credential={credential}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {explanation === null ? null : <p className="text-sm text-text-muted">{explanation}</p>}
      </CardContent>
    </Card>
  );
}

function SupportingCredentialItem({ credential }: { credential: PublicSupportingCredentialVM }) {
  return (
    <li className="grid min-w-0 gap-1 rounded-control border border-border-default px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/verify?credential=${encodeURIComponent(credential.credentialReference)}`}
          className="break-words text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none"
        >
          {credential.title}
        </Link>
        {credential.currentStatus === 'revoked' ? (
          <Badge variant="outline" className="border-amber-700 text-amber-900">
            Hoy: {credential.currentStatusLabel}
          </Badge>
        ) : null}
      </div>
      <p className="break-words text-xs text-text-muted">
        {credential.credentialTypeLabel} · {credential.issuerName}
        {credential.sourceKindLabels.length > 0 ? ` · ${credential.sourceKindLabels.join(', ')}` : ''}
      </p>
    </li>
  );
}

/** Frase corta y sin jerga: a qué requisitos aportó esta credencial. */
function describeRequirementOrders(supported: number[], partiallySupported: number[]): string {
  const parts: string[] = [];
  if (supported.length > 0) {
    parts.push(`Respalda ${listOrders(supported)}`);
  }
  if (partiallySupported.length > 0) {
    parts.push(`Respalda parcialmente ${listOrders(partiallySupported)}`);
  }
  return parts.join(' · ');
}

function listOrders(orders: number[]): string {
  const labels = orders.map((order) => `#${order}`);
  return labels.length === 1
    ? `el requisito ${labels[0]}`
    : `los requisitos ${labels.join(', ')}`;
}
