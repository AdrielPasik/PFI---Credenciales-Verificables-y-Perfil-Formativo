'use client';

import { Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_LENGTH_MESSAGE
} from '@/lib/auth/credential-rules';
import type { PasswordResetFeedback } from '@/models/password-reset';

interface ResetPasswordFormProps {
  isSubmitting: boolean;
  /** Rechazo del ultimo envio que permite corregir y reintentar en esta pantalla. */
  error: PasswordResetFeedback | null;
  onSubmit(password: string): Promise<void>;
}

interface FieldErrors {
  password?: string;
  confirmPassword?: string;
}

/**
 * Formulario de contrasena nueva.
 *
 * NO conoce el token: recibe `onSubmit(password)` y quien lo llama lo tiene. Asi el
 * secreto no pasa por props, ni por estado de este componente, ni por el DOM.
 *
 * La contrasena se manda TAL CUAL se escribio: sin `trim` ni normalizacion (espacios
 * al borde incluidos), igual que el registro. La confirmacion es solo local y nunca
 * viaja. La politica (8 a 128) es feedback temprano; el backend decide.
 */
export function ResetPasswordForm({
  isSubmitting,
  error,
  onSubmit
}: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Guarda SINCRONICA contra el doble envio (ver ForgotPasswordForm).
  const inFlight = useRef(false);

  const policyError = error?.problem === 'password_policy' ? error.message : undefined;
  const alert = error && error.problem !== 'password_policy' ? error : null;

  function validate(): boolean {
    const next: FieldErrors = {};

    if (!password) {
      next.password = 'Ingresá una contraseña nueva.';
    } else if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      next.password = PASSWORD_LENGTH_MESSAGE;
    } else if (password !== confirmPassword) {
      next.confirmPassword = 'Las contraseñas no coinciden.';
    }

    setFieldErrors(next);

    if (next.password) {
      passwordRef.current?.focus();
    } else if (next.confirmPassword) {
      confirmRef.current?.focus();
    }

    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (inFlight.current || isSubmitting || !validate()) {
      return;
    }

    inFlight.current = true;

    try {
      await onSubmit(password);
    } finally {
      inFlight.current = false;
    }

    // Tras un rechazo corregible, el foco va al aviso o al campo con el problema.
    window.setTimeout(() => {
      if (alertRef.current) alertRef.current.focus();
      else passwordRef.current?.focus();
    }, 0);
  }

  const passwordError = fieldErrors.password ?? policyError;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      className="grid gap-6"
    >
      {alert ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <FeedbackAlert
            variant={alert.problem === 'rate_limited' ? 'warning' : 'error'}
            title="No pudimos guardar la contraseña"
          >
            {alert.message}
          </FeedbackAlert>
        </div>
      ) : null}

      <div className="relative">
        <TextField
          ref={passwordRef}
          id="reset-password-new"
          label="Contraseña nueva"
          type={passwordVisible ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors({});
          }}
          error={passwordError}
          disabled={isSubmitting}
          className="pr-12"
          autoFocus
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={passwordVisible}
          onClick={() => setPasswordVisible((visible) => !visible)}
          disabled={isSubmitting}
          className="absolute top-7 right-0.5 min-h-10 size-10"
        >
          {passwordVisible ? (
            <EyeOff aria-hidden="true" />
          ) : (
            <Eye aria-hidden="true" />
          )}
        </Button>
      </div>

      <TextField
        ref={confirmRef}
        id="reset-password-confirm"
        label="Repetí la contraseña nueva"
        type={passwordVisible ? 'text' : 'password'}
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          setFieldErrors((current) => ({ ...current, confirmPassword: undefined }));
        }}
        description={`Entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`}
        error={fieldErrors.confirmPassword}
        disabled={isSubmitting}
      />

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <KeyRound aria-hidden="true" />
        )}
        {isSubmitting ? 'Guardando' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}
