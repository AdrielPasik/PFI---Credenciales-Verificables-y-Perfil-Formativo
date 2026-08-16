'use client';

import { Eye, EyeOff, LoaderCircle, UserPlus } from 'lucide-react';
import {
  useRef,
  useState,
  type FormEvent
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import type { RegisterCommand } from '@/lib/api/auth-api';
import type { AuthFeedback } from '@/models/auth-session';

interface RegisterFormProps {
  initialFeedback?: AuthFeedback | null;
  isSubmitting: boolean;
  onSubmit(command: RegisterCommand): Promise<AuthFeedback | null>;
}

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A1: misma politica minima que el backend (services/api/src/auth/auth.service.ts)
// -- feedback temprano en frontend, backend sigue siendo la autoridad real.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
// A1.1: misma politica minima que el backend -- solo longitud maxima, sin
// restriccion de charset (nombres con acentos, apostrofes o guiones deben
// poder representarse tal cual).
const MAX_NAME_LENGTH = 100;

export function RegisterForm({
  initialFeedback = null,
  isSubmitting,
  onSubmit
}: RegisterFormProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<AuthFeedback | null>(
    initialFeedback
  );
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  function validate() {
    const nextErrors: FieldErrors = {};
    const normalizedFirstName = firstName.trim().replace(/\s+/g, ' ');
    const normalizedLastName = lastName.trim().replace(/\s+/g, ' ');
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedFirstName) {
      nextErrors.firstName = 'Ingresá tu nombre.';
    } else if (normalizedFirstName.length > MAX_NAME_LENGTH) {
      nextErrors.firstName = `El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.`;
    }

    if (!normalizedLastName) {
      nextErrors.lastName = 'Ingresá tu apellido.';
    } else if (normalizedLastName.length > MAX_NAME_LENGTH) {
      nextErrors.lastName = `El apellido no puede superar los ${MAX_NAME_LENGTH} caracteres.`;
    }

    if (!normalizedEmail) {
      nextErrors.email = 'Ingresá tu correo electrónico.';
    } else if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = 'Ingresá un correo electrónico válido.';
    }

    if (!password) {
      nextErrors.password = 'Ingresá una contraseña.';
    } else if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      nextErrors.password = `La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`;
    }

    // A1/seccion 22: si password!==confirmPassword nunca se llama al
    // backend -- la confirmacion es exclusivamente client-side.
    if (!nextErrors.password && password !== confirmPassword) {
      nextErrors.confirmPassword = 'Las contraseñas no coinciden.';
    }

    setFieldErrors(nextErrors);

    if (nextErrors.firstName) {
      firstNameRef.current?.focus();
    } else if (nextErrors.lastName) {
      lastNameRef.current?.focus();
    } else if (nextErrors.email) {
      emailRef.current?.focus();
    } else if (nextErrors.password) {
      passwordRef.current?.focus();
    } else if (nextErrors.confirmPassword) {
      confirmPasswordRef.current?.focus();
    }

    return {
      valid: Object.keys(nextErrors).length === 0,
      normalizedFirstName,
      normalizedLastName,
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

    // A1/A1.1: unicamente nombre/apellido/email/password llegan al backend
    // -- confirmPassword nunca se envia ni se persiste fuera del state
    // local de este form.
    const nextFeedback = await onSubmit({
      firstName: validation.normalizedFirstName,
      lastName: validation.normalizedLastName,
      email: validation.normalizedEmail,
      password
    });

    setPassword('');
    setConfirmPassword('');

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
          <FeedbackAlert variant="error" title="No pudimos crear tu cuenta">
            {feedback.message}
          </FeedbackAlert>
        </div>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          ref={firstNameRef}
          id="register-first-name"
          label="Nombre"
          type="text"
          autoComplete="given-name"
          value={firstName}
          onChange={(event) => {
            setFirstName(event.target.value);
            setFieldErrors((current) => ({ ...current, firstName: undefined }));
          }}
          error={fieldErrors.firstName}
          disabled={isSubmitting}
          autoFocus
        />
        <TextField
          ref={lastNameRef}
          id="register-last-name"
          label="Apellido"
          type="text"
          autoComplete="family-name"
          value={lastName}
          onChange={(event) => {
            setLastName(event.target.value);
            setFieldErrors((current) => ({ ...current, lastName: undefined }));
          }}
          error={fieldErrors.lastName}
          disabled={isSubmitting}
        />
      </div>

      <TextField
        ref={emailRef}
        id="register-email"
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
      />

      <div className="relative">
        <TextField
          ref={passwordRef}
          id="register-password"
          label="Contraseña"
          type={passwordVisible ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((current) => ({
              ...current,
              password: undefined,
              confirmPassword: undefined
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

      <TextField
        ref={confirmPasswordRef}
        id="register-confirm-password"
        label="Repetir contraseña"
        type={passwordVisible ? 'text' : 'password'}
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          setFieldErrors((current) => ({
            ...current,
            confirmPassword: undefined
          }));
        }}
        error={fieldErrors.confirmPassword}
        disabled={isSubmitting}
      />

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <UserPlus aria-hidden="true" />
        )}
        {isSubmitting ? 'Creando cuenta' : 'Crear cuenta'}
      </Button>
    </form>
  );
}
