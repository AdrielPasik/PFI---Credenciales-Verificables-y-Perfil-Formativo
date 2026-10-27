'use client';

import { LoaderCircle, Send } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import { EMAIL_PATTERN, normalizeEmail } from '@/lib/auth/credential-rules';
import type { PasswordResetFeedback } from '@/models/password-reset';

interface ForgotPasswordFormProps {
  isSubmitting: boolean;
  /** Fallo del ultimo envio. El correo escrito se CONSERVA para reintentar. */
  feedback: PasswordResetFeedback | null;
  onSubmit(email: string): Promise<void>;
}

/**
 * Pide el correo y lo entrega normalizado (trim + minusculas, igual que login y
 * registro). La validacion de formato es feedback temprano: el backend valida de
 * nuevo y puede rechazar con `INVALID_EMAIL`, caso que tambien se muestra en el campo.
 */
export function ForgotPasswordForm({
  isSubmitting,
  feedback,
  onSubmit
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | undefined>();
  const emailRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  // Guarda SINCRONICA contra el doble envio: `disabled` recien se aplica en el
  // siguiente render, y dos clics seguidos caben en el mismo.
  const inFlight = useRef(false);

  const serverEmailError =
    feedback?.problem === 'invalid_email' ? feedback.message : undefined;
  const alert = feedback && feedback.problem !== 'invalid_email' ? feedback : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (inFlight.current || isSubmitting) {
      return;
    }

    const normalized = normalizeEmail(email);

    if (!normalized) {
      setLocalError('Ingresá tu correo electrónico.');
      emailRef.current?.focus();
      return;
    }

    if (!EMAIL_PATTERN.test(normalized)) {
      setLocalError('Ingresá un correo electrónico válido.');
      emailRef.current?.focus();
      return;
    }

    setLocalError(undefined);
    inFlight.current = true;

    try {
      await onSubmit(normalized);
    } finally {
      inFlight.current = false;
    }

    // Si el envio fallo, el foco vuelve al aviso para que se anuncie.
    window.setTimeout(() => feedbackRef.current?.focus(), 0);
  }

  const emailError = localError ?? serverEmailError;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      className="grid gap-6"
    >
      {alert ? (
        <div ref={feedbackRef} tabIndex={-1} className="outline-none">
          <FeedbackAlert
            variant={alert.problem === 'rate_limited' ? 'warning' : 'error'}
            title="No pudimos enviar el enlace"
          >
            {alert.message}
          </FeedbackAlert>
        </div>
      ) : null}

      <TextField
        ref={emailRef}
        id="forgot-password-email"
        label="Correo electrónico"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setLocalError(undefined);
        }}
        error={emailError}
        disabled={isSubmitting}
        autoFocus
      />

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Send aria-hidden="true" />
        )}
        {isSubmitting ? 'Enviando' : 'Enviar enlace'}
      </Button>
    </form>
  );
}
