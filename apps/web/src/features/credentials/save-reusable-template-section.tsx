'use client';

import { BookmarkPlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import type {
  CourseTemplateSummaryVM,
  CredentialFeedback,
  ReusableCredentialType
} from '@/models/credentials';

interface SaveReusableTemplateSectionProps {
  credentialType: ReusableCredentialType;
  onSave(): Promise<CourseTemplateSummaryVM>;
}

interface ReusableTemplateCopy {
  buttonLabel: string;
  successMessage: string;
  duplicateMessage: string;
}

// C3b: copy resuelto segun credential.type -- nunca "asignatura/curso/
// certificación/etc." generico. course y certification son los unicos
// tipos que pueden guardarse como reutilizables (ver domain-rules-v0.md,
// seccion C3a.2); academic_subject/degree nunca llegan a este componente.
const copyByType: Record<ReusableCredentialType, ReusableTemplateCopy> = {
  course: {
    buttonLabel: 'Guardar como curso reutilizable',
    successMessage: 'Curso guardado como reutilizable.',
    duplicateMessage: 'Este curso ya fue guardado como reutilizable.'
  },
  certification: {
    buttonLabel: 'Guardar como certificación reutilizable',
    successMessage: 'Certificación guardada como reutilizable.',
    duplicateMessage: 'Esta certificación ya fue guardada como reutilizable.'
  }
};

type SaveTemplateState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'duplicate' }
  | { kind: 'error'; feedback: CredentialFeedback };

export function SaveReusableTemplateSection({
  credentialType,
  onSave
}: SaveReusableTemplateSectionProps) {
  const [state, setState] = useState<SaveTemplateState>({ kind: 'idle' });
  const requestInFlight = useRef(false);
  const copy = copyByType[credentialType];

  async function handleSave() {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setState({ kind: 'loading' });

    try {
      await onSave();
      setState({ kind: 'success' });
    } catch (error) {
      const feedback = mapCredentialError(error, 'save-reusable-template');

      setState(
        feedback.code === 'conflict'
          ? { kind: 'duplicate' }
          : { kind: 'error', feedback }
      );
    } finally {
      requestInFlight.current = false;
    }
  }

  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-card border border-border-default bg-surface-muted p-4"
      data-testid="save-reusable-template-section"
    >
      <BookmarkPlus aria-hidden="true" className="size-5 shrink-0 text-teal-700" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-strong">Reutilizable</p>
        <p className="mt-1 text-sm text-text-muted">
          Reutilizá estos datos en futuras credenciales.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="shrink-0"
        disabled={state.kind === 'loading' || state.kind === 'success'}
        onClick={() => void handleSave()}
      >
        {state.kind === 'loading' ? 'Guardando…' : copy.buttonLabel}
      </Button>
      <div className="basis-full" aria-live="polite">
        {state.kind === 'success' ? (
          <FeedbackAlert variant="success" title={copy.successMessage}>
            Disponible para reutilizar en futuras credenciales de este emisor.
          </FeedbackAlert>
        ) : null}

        {state.kind === 'duplicate' ? (
          <FeedbackAlert variant="warning" title={copy.duplicateMessage}>
            No se creó un registro nuevo para evitar duplicados.
          </FeedbackAlert>
        ) : null}

        {state.kind === 'error' ? (
          <FeedbackAlert
            variant="error"
            title="No pudimos guardar este contenido como reutilizable"
          >
            {state.feedback.message}
          </FeedbackAlert>
        ) : null}
      </div>
    </section>
  );
}
