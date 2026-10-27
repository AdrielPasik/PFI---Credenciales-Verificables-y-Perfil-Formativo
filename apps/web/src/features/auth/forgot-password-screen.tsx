'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';
import {
  RecoveryCard,
  useFocusTitleOnChange
} from '@/features/auth/recovery-card';
import { requestPasswordReset } from '@/lib/api/auth-api';
import { mapPasswordResetError } from '@/lib/errors/password-reset-error-mapper';
import type { PasswordResetFeedback } from '@/models/password-reset';

type View = 'form' | 'sent';

/**
 * `/forgot-password`. Publica: no exige sesion y no la toca (una sesion abierta en
 * este navegador ni se lee ni se redirige).
 *
 * La confirmacion es NEUTRAL a proposito: el 202 del backend es el mismo exista o
 * no la cuenta, y tampoco significa que el correo haya salido. Por eso el texto
 * dice "si existe una cuenta ... vas a recibir", nunca "te enviamos un correo", y no
 * hay nada que dependa de la latencia ni de la respuesta mas alla del 202.
 */
export function ForgotPasswordScreen() {
  const [view, setView] = useState<View>('form');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<PasswordResetFeedback | null>(null);
  const inFlight = useRef(false);
  const titleRef = useFocusTitleOnChange(view);

  async function handleSubmit(email: string) {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      await requestPasswordReset({ email });
      // El correo escrito se descarta al pasar a la confirmacion (privacidad).
      setView('sent');
    } catch (error) {
      setFeedback(mapPasswordResetError(error, 'request'));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (view === 'sent') {
    return (
      <RecoveryCard
        kicker="Recuperar acceso"
        title="Revisá tu correo"
        titleRef={titleRef}
        description="Si existe una cuenta de Scope asociada a ese correo, vas a recibir un enlace para restablecer tu contraseña. Revisá también la carpeta de correo no deseado."
      >
        <p className="mb-6 text-sm leading-6 text-text-muted">
          Los enlaces vencen a los 30 minutos y solo funciona el último que te
          enviemos.
        </p>
        <div className="grid gap-3">
          <Button asChild size="lg">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => {
              setFeedback(null);
              setView('form');
            }}
          >
            Usar otro correo
          </Button>
        </div>
      </RecoveryCard>
    );
  }

  return (
    <RecoveryCard
      kicker="Recuperar acceso"
      title="Recuperá el acceso a tu cuenta"
      titleRef={titleRef}
      description="Ingresá el correo con el que te registraste. Si corresponde a una cuenta de Scope, te vamos a enviar un enlace para elegir una contraseña nueva."
    >
      <ForgotPasswordForm
        isSubmitting={submitting}
        feedback={feedback}
        onSubmit={handleSubmit}
      />
      <div className="mt-7 border-t border-border-default pt-5 text-center text-sm text-text-muted">
        <Link
          href="/login"
          className="font-semibold text-brand-700 underline underline-offset-4"
        >
          Volver a iniciar sesión
        </Link>
      </div>
    </RecoveryCard>
  );
}
