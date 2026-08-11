'use client';

import { BookmarkPlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  helpText: string;
}

// C3b: copy resuelto segun credential.type -- nunca "asignatura/curso/
// certificación/etc." generico. course y certification son los unicos
// tipos que pueden guardarse como reutilizables (ver domain-rules-v0.md,
// seccion C3a.2); academic_subject/degree nunca llegan a este componente.
const copyByType: Record<ReusableCredentialType, ReusableTemplateCopy> = {
  course: {
    buttonLabel: 'Guardar como curso reutilizable',
    successMessage: 'Curso guardado como reutilizable.',
    duplicateMessage: 'Este curso ya fue guardado como reutilizable.',
    helpText:
      'Este curso quedará disponible en el catálogo de este emisor para futuras credenciales.'
  },
  certification: {
    buttonLabel: 'Guardar como certificación reutilizable',
    successMessage: 'Certificación guardada como reutilizable.',
    duplicateMessage: 'Esta certificación ya fue guardada como reutilizable.',
    helpText:
      'Esta certificación quedará disponible en el catálogo de este emisor para futuras credenciales.'
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
    <Card
      className="border-border-strong shadow-none"
      data-testid="save-reusable-template-section"
    >
      <CardHeader className="flex-row items-center gap-3 border-b border-border-default">
        <BookmarkPlus aria-hidden="true" className="size-5 text-teal-700" />
        <div>
          <h2 className="text-lg font-semibold text-text-strong">
            Catálogo reutilizable del emisor
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Guardá los datos de esta credencial en el catálogo reutilizable
            de este emisor.
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5">
        <ul className="grid gap-1 text-sm leading-6 text-text-muted">
          <li>{copy.helpText}</li>
          <li>No modifica la credencial original.</li>
          <li>No crea una nueva credencial.</li>
          <li>No implica integración oficial con plataformas externas.</li>
        </ul>

        <div aria-live="polite">
          {state.kind === 'success' ? (
            <FeedbackAlert variant="success" title={copy.successMessage}>
              Ya podés encontrarlo en el catálogo reutilizable de este emisor.
            </FeedbackAlert>
          ) : null}

          {state.kind === 'duplicate' ? (
            <FeedbackAlert variant="warning" title={copy.duplicateMessage}>
              No se creó un registro nuevo para evitar duplicados en el
              catálogo.
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

        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          disabled={state.kind === 'loading' || state.kind === 'success'}
          onClick={() => void handleSave()}
        >
          {state.kind === 'loading' ? 'Guardando…' : copy.buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
