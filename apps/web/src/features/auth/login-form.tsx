'use client';

import { Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react';
import {
  useRef,
  useState,
  type FormEvent
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import type { LoginCommand } from '@/lib/api/auth-api';
import type { AuthFeedback } from '@/models/auth-session';

interface LoginFormProps {
  initialFeedback?: AuthFeedback | null;
  isSubmitting: boolean;
  onSubmit(command: LoginCommand): Promise<AuthFeedback | null>;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({
  initialFeedback = null,
  isSubmitting,
  onSubmit
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<AuthFeedback | null>(
    initialFeedback
  );
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  function validate() {
    const nextErrors: FieldErrors = {};
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      nextErrors.email = 'Ingresá tu correo electrónico.';
    } else if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = 'Ingresá un correo electrónico válido.';
    }

    if (!password) {
      nextErrors.password = 'Ingresá tu contraseña.';
    }

    setFieldErrors(nextErrors);

    if (nextErrors.email) {
      emailRef.current?.focus();
    } else if (nextErrors.password) {
      passwordRef.current?.focus();
    }

    return {
      valid: Object.keys(nextErrors).length === 0,
      normalizedEmail
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const validation = validate();

    if (!validation.valid) {
      return;
    }

    const nextFeedback = await onSubmit({
      email: validation.normalizedEmail,
      password
    });

    setPassword('');

    if (nextFeedback) {
      setFeedback(nextFeedback);
      window.setTimeout(() => feedbackRef.current?.focus(), 0);
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      className="grid gap-6"
    >
      {feedback ? (
        <div ref={feedbackRef} tabIndex={-1}>
          <FeedbackAlert variant="error" title="No pudimos iniciar sesión">
            {feedback.message}
          </FeedbackAlert>
        </div>
      ) : null}

      <TextField
        ref={emailRef}
        id="login-email"
        label="Correo electrónico"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setFieldErrors((current) => ({ ...current, email: undefined }));
        }}
        error={fieldErrors.email}
        disabled={isSubmitting}
        autoFocus
      />

      <div className="relative">
        <TextField
          ref={passwordRef}
          id="login-password"
          label="Contraseña"
          type={passwordVisible ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((current) => ({
              ...current,
              password: undefined
            }));
          }}
          error={fieldErrors.password}
          disabled={isSubmitting}
          className="pr-12"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'
          }
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

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <LogIn aria-hidden="true" />
        )}
        {isSubmitting ? 'Ingresando' : 'Ingresar'}
      </Button>
    </form>
  );
}
