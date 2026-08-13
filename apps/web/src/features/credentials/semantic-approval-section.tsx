'use client';

import { ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/forms/text-field';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CredentialFeedback,
  ReviewedSemanticInterpretationCommand,
  TemplateSemanticApprovalCandidateVM
} from '@/models/credentials';

interface SemanticApprovalSectionProps {
  semanticAnalysisReference: string | null;
  onLoadCandidate(
    semanticAnalysisReference: string
  ): Promise<TemplateSemanticApprovalCandidateVM>;
  onApprove(
    semanticAnalysisReference: string,
    review: ReviewedSemanticInterpretationCommand
  ): Promise<void>;
  approved?: boolean;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; candidate: TemplateSemanticApprovalCandidateVM }
  | { kind: 'error'; feedback: CredentialFeedback };

type ApproveState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; feedback: CredentialFeedback };

const limits = { areas: 10, skills: 30, concepts: 50 } as const;

// C5 keeps the raw SemanticAnalysis outside this component. It edits only a
// local label list which becomes a reviewed, allowlisted template snapshot on
// explicit approval.
export function SemanticApprovalSection({
  semanticAnalysisReference,
  onLoadCandidate,
  onApprove,
  approved = false
}: SemanticApprovalSectionProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' });
  const [approveState, setApproveState] = useState<ApproveState>({ kind: 'idle' });
  const [areas, setAreas] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [concepts, setConcepts] = useState<string[]>([]);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!semanticAnalysisReference || approved) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active) setLoadState({ kind: 'loading' });
        return onLoadCandidate(semanticAnalysisReference);
      })
      .then((candidate) => {
        if (!active) return;
        setAreas(candidate.areas.map(({ label }) => label));
        setSkills(candidate.skills.map(({ label }) => label));
        setConcepts(candidate.concepts.map(({ label }) => label));
        setLoadState({ kind: 'loaded', candidate });
      })
      .catch((error) => {
        if (active) setLoadState({ kind: 'error', feedback: mapCredentialError(error, 'semantic-approval-candidate') });
      });
    return () => { active = false; };
  }, [approved, onLoadCandidate, semanticAnalysisReference]);

  async function handleApprove() {
    if (!semanticAnalysisReference || inFlight.current) return;
    const review = {
      reviewedAreas: areas.map((label) => ({ label })),
      reviewedSkills: skills.map((label) => ({ label })),
      reviewedConcepts: concepts.map((label) => ({ label }))
    };
    inFlight.current = true;
    setApproveState({ kind: 'loading' });
    try {
      await onApprove(semanticAnalysisReference, review);
      setApproveState({ kind: 'success' });
    } catch (error) {
      setApproveState({ kind: 'error', feedback: mapCredentialError(error, 'approve-reusable-template-analysis') });
    } finally {
      inFlight.current = false;
    }
  }

  if (approved || approveState.kind === 'success') {
    return (
      <FeedbackAlert variant="success" title="Interpretación aprobada para reutilización.">
        El contenido reutilizable aprobado no modifica la credencial original ni crea una nueva credencial.
      </FeedbackAlert>
    );
  }
  if (!semanticAnalysisReference) {
    return (
      <FeedbackAlert variant="information" title="Interpretación asistida pendiente">
        Para guardar este contenido como reutilizable, primero debe existir una interpretación asistida disponible.
      </FeedbackAlert>
    );
  }

  return (
    <Card className="border-border-strong shadow-none" data-testid="semantic-approval-section">
      <CardHeader className="flex-row items-center gap-3 border-b border-border-default">
        <ShieldCheck aria-hidden="true" className="size-5 text-teal-700" />
        <div>
          <h2 className="text-lg font-semibold text-text-strong">Interpretación propuesta</h2>
          <p className="mt-1 text-sm text-text-muted">Revisá y ajustá este resumen antes de aprobarlo para reutilización.</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 pt-5">
        {loadState.kind === 'loading' ? <p aria-live="polite" className="text-sm text-text-muted">Cargando interpretación asistida...</p> : null}
        {loadState.kind === 'error' ? <FeedbackAlert variant="warning" title="No pudimos cargar la interpretación asistida">{loadState.feedback.message}</FeedbackAlert> : null}
        {loadState.kind === 'loaded' ? <>
          {loadState.candidate.status === 'partial' ? <FeedbackAlert variant="warning" title="Análisis parcial">El análisis es parcial. Revisá la interpretación antes de aprobarla.</FeedbackAlert> : null}
          <EditableLabels title="Áreas" labels={areas} onChange={setAreas} limit={limits.areas} />
          <EditableLabels title="Habilidades" labels={skills} onChange={setSkills} limit={limits.skills} />
          <EditableLabels title="Conceptos" labels={concepts} onChange={setConcepts} limit={limits.concepts} />
          {[...loadState.candidate.warnings, ...loadState.candidate.qualityNotes].length > 0 ? <section aria-label="Observaciones" className="grid gap-2"><h3 className="text-sm font-semibold text-text-strong">Observaciones</h3><ul className="grid gap-1 text-sm leading-6 text-text-muted">{[...loadState.candidate.warnings, ...loadState.candidate.qualityNotes].map((note) => <li key={note}>{note}</li>)}</ul></section> : null}
          {approveState.kind === 'error' ? <FeedbackAlert variant="error" title="No pudimos aprobar la interpretación">{approveState.feedback.message}</FeedbackAlert> : null}
          <Button type="button" className="w-fit" disabled={approveState.kind === 'loading'} onClick={() => void handleApprove()}>{approveState.kind === 'loading' ? 'Aprobando...' : 'Aprobar interpretación revisada'}</Button>
        </> : null}
      </CardContent>
    </Card>
  );
}

function EditableLabels({ title, labels, onChange, limit }: { title: string; labels: string[]; onChange(labels: string[]): void; limit: number }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  function add() {
    const label = value.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!label) { setError('Ingresá una etiqueta para agregarla.'); return; }
    if (label.length > 120 || /[<>]/.test(label) || /^(\{|\[)/.test(label)) { setError('La etiqueta no tiene un formato válido.'); return; }
    if (labels.some((item) => item.toLocaleLowerCase('es-AR') === label.toLocaleLowerCase('es-AR'))) { setError('Esta etiqueta ya está incluida.'); return; }
    if (labels.length >= limit) { setError(`Podés incluir hasta ${limit} etiquetas.`); return; }
    onChange([...labels, label]); setValue(''); setError(null);
  }
  return <section className="grid gap-3"><div><h3 className="text-sm font-semibold text-text-strong">{title}</h3><p className="mt-1 text-sm text-text-muted">Podés quitar o agregar etiquetas antes de aprobar.</p></div><div className="flex flex-wrap gap-2">{labels.map((label) => <Badge key={label} variant="outline" className="gap-1 border-teal-700/30 bg-teal-50 text-teal-900">{label}<button type="button" aria-label={`Quitar ${label}`} onClick={() => onChange(labels.filter((item) => item !== label))}><X aria-hidden="true" className="size-3" /></button></Badge>)}</div><div className="flex flex-wrap items-end gap-2"><TextField label={`Agregar ${title.toLocaleLowerCase('es-AR')}`} value={value} onChange={(event) => setValue(event.target.value)} error={error ?? undefined} className="min-w-56 flex-1" /><Button type="button" variant="secondary" onClick={add}>Agregar</Button></div></section>;
}
