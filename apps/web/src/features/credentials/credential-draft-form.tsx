'use client';

import {
  Building2,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  LockKeyhole,
  Search,
  UserRoundCheck
} from 'lucide-react';
import Link from 'next/link';
import {
  useRef,
  useState,
  type FormEvent
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import {
  credentialTypeLabels,
  credentialTypeOptions
} from '@/models/credentials';
import type {
  CredentialFeedback,
  CredentialType,
  HolderSummaryVM
} from '@/models/credentials';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CredentialDraftFormProps {
  issuerName: string;
  onResolveHolder(email: string): Promise<HolderSummaryVM>;
  onCreateDraft(input: {
    achievementName: string;
    credentialType: CredentialType;
    holder: HolderSummaryVM;
  }): Promise<void>;
}

export function CredentialDraftForm({
  issuerName,
  onCreateDraft,
  onResolveHolder
}: CredentialDraftFormProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [holder, setHolder] = useState<HolderSummaryVM | null>(null);
  const [resolutionFeedback, setResolutionFeedback] =
    useState<CredentialFeedback | null>(null);
  const [achievementName, setAchievementName] = useState('');
  const [achievementError, setAchievementError] = useState<string>();
  const [credentialType, setCredentialType] = useState<
    CredentialType | ''
  >('');
  const [credentialTypeError, setCredentialTypeError] =
    useState<string>();
  const [draftFeedback, setDraftFeedback] =
    useState<CredentialFeedback | null>(null);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const credentialTypeRef = useRef<HTMLSelectElement>(null);
  const achievementRef = useRef<HTMLInputElement>(null);

  async function handleResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (resolving || holder) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setEmailError('Ingresá el correo electrónico del titular.');
      emailRef.current?.focus();
      return;
    }

    if (!emailPattern.test(normalizedEmail)) {
      setEmailError('Ingresá un correo electrónico válido.');
      emailRef.current?.focus();
      return;
    }

    setEmail(normalizedEmail);
    setEmailError(undefined);
    setResolutionFeedback(null);
    setResolving(true);

    try {
      const resolvedHolder = await onResolveHolder(normalizedEmail);
      setHolder(resolvedHolder);
      window.setTimeout(() => credentialTypeRef.current?.focus(), 0);
    } catch (error) {
      setResolutionFeedback(
        mapCredentialError(error, 'holder-resolution')
      );
    } finally {
      setResolving(false);
    }
  }

  function handleChangeHolder() {
    setHolder(null);
    setResolutionFeedback(null);
    setDraftFeedback(null);
    window.setTimeout(() => emailRef.current?.focus(), 0);
  }

  async function handleCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current || !holder) {
      return;
    }

    const normalizedAchievementName = achievementName
      .trim()
      .replace(/\s+/g, ' ');

    if (!credentialType) {
      setCredentialTypeError('Seleccioná un tipo de credencial.');
      credentialTypeRef.current?.focus();
      return;
    }

    if (!normalizedAchievementName) {
      setAchievementError('Ingresá el nombre del logro.');
      achievementRef.current?.focus();
      return;
    }

    setAchievementName(normalizedAchievementName);
    setAchievementError(undefined);
    setDraftFeedback(null);
    setSubmitting(true);
    submittingRef.current = true;

    try {
      await onCreateDraft({
        achievementName: normalizedAchievementName,
        credentialType,
        holder
      });
    } catch (error) {
      setDraftFeedback(mapCredentialError(error, 'draft-create'));
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <div className="grid gap-8">
      <header className="max-w-3xl">
        <Link
          href="/issuer"
          className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
        >
          Volver al portal
        </Link>
        <p className="mt-6 text-sm font-semibold text-teal-700">
          Nueva credencial
        </p>
        <h1 className="mt-2 text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-4xl">
          Creá un borrador institucional
        </h1>
        <p className="mt-4 max-w-2xl leading-7 text-text-muted">
          Primero confirmá al titular y después registrá el nombre del logro.
          La emisión no forma parte de este paso.
        </p>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="grid gap-6">
          <Card className="overflow-hidden border-border-strong">
            <div aria-hidden="true" className="h-1 bg-teal-700" />
            <CardHeader className="gap-4 sm:p-8 sm:pb-6">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-pill bg-teal-100 text-sm font-bold text-teal-700">
                  1
                </span>
                <div>
                  <p className="text-sm font-semibold text-teal-700">
                    Resolver titular
                  </p>
                  <h2 className="text-xl font-semibold text-text-strong">
                    Identidad receptora
                  </h2>
                </div>
              </div>
            </CardHeader>
            <CardContent className="sm:px-8 sm:pb-8">
              {resolutionFeedback ? (
                <div className="mb-5">
                  <FeedbackAlert
                    variant="error"
                    title="No pudimos resolver al titular"
                  >
                    {resolutionFeedback.message}
                  </FeedbackAlert>
                </div>
              ) : null}

              {holder ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-card border border-teal-700/20 bg-teal-100 p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-teal-700">
                        <UserRoundCheck aria-hidden="true" className="size-5" />
                        Titular confirmado
                      </p>
                      <p className="mt-3 text-lg font-semibold text-text-strong">
                        {holder.displayLabel}
                      </p>
                      <p className="mt-1 break-words text-sm text-text-muted">
                        {holder.email}
                      </p>
                      <p className="mt-2 break-words font-mono text-xs text-text-muted">
                        {holder.did ?? 'DID no disponible'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleChangeHolder}
                      disabled={submitting}
                    >
                      Cambiar titular
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleResolve} noValidate className="grid gap-4">
                  <TextField
                    ref={emailRef}
                    id="holder-email"
                    label="Email del titular"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setEmailError(undefined);
                      setResolutionFeedback(null);
                    }}
                    description="La búsqueda es exacta y solo consulta titulares existentes."
                    error={emailError}
                    disabled={resolving}
                  />
                  <div aria-live="polite" className="flex items-center gap-3">
                    <Button type="submit" disabled={resolving}>
                      {resolving ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : (
                        <Search aria-hidden="true" />
                      )}
                      {resolving ? 'Buscando titular' : 'Buscar titular'}
                    </Button>
                    {resolving ? (
                      <span className="text-sm text-text-muted">
                        Validando con la institución
                      </span>
                    ) : null}
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <Card
            className={
              holder
                ? 'overflow-hidden border-border-strong'
                : 'overflow-hidden bg-surface-muted opacity-70'
            }
          >
            <CardHeader className="gap-4 sm:p-8 sm:pb-6">
              <div className="flex items-center gap-3">
                <span
                  className={
                    holder
                      ? 'flex size-9 items-center justify-center rounded-pill bg-brand-100 text-sm font-bold text-brand-700'
                      : 'flex size-9 items-center justify-center rounded-pill bg-surface text-sm font-bold text-text-muted'
                  }
                >
                  2
                </span>
                <div>
                  <p className="text-sm font-semibold text-brand-700">
                    Crear borrador
                  </p>
                  <h2 className="text-xl font-semibold text-text-strong">
                    Datos del logro
                  </h2>
                </div>
              </div>
            </CardHeader>
            <CardContent className="sm:px-8 sm:pb-8">
              {draftFeedback ? (
                <div className="mb-5">
                  <FeedbackAlert
                    variant="error"
                    title="No pudimos guardar el borrador"
                  >
                    {draftFeedback.message}
                  </FeedbackAlert>
                </div>
              ) : null}

              <form onSubmit={handleCreateDraft} noValidate className="grid gap-5">
                <fieldset disabled={!holder || submitting} className="grid gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="credential-type">
                      Tipo de credencial
                    </Label>
                    <div className="relative">
                      <select
                        ref={credentialTypeRef}
                        id="credential-type"
                        value={credentialType}
                        onChange={(event) => {
                          const selectedValue = event.target.value;

                          setCredentialType(
                            credentialTypeOptions.includes(
                              selectedValue as CredentialType
                            )
                              ? (selectedValue as CredentialType)
                              : ''
                          );
                          setCredentialTypeError(undefined);
                          setDraftFeedback(null);
                        }}
                        aria-describedby={[
                          'credential-type-description',
                          credentialTypeError
                            ? 'credential-type-error'
                            : undefined
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-invalid={
                          credentialTypeError ? true : undefined
                        }
                        className="min-h-11 w-full appearance-none rounded-control border border-border-strong bg-surface px-3 py-2 pr-10 text-base text-text-strong shadow-xs outline-none transition-colors hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70 aria-invalid:border-status-error aria-invalid:ring-status-error/20 sm:text-sm"
                      >
                        <option value="">Seleccioná un tipo</option>
                        {credentialTypeOptions.map((type) => (
                          <option key={type} value={type}>
                            {credentialTypeLabels[type]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
                      />
                    </div>
                    <p
                      id="credential-type-description"
                      className="text-sm leading-5 text-text-muted"
                    >
                      Elegí la categoría institucional que describe el logro.
                    </p>
                    {credentialTypeError ? (
                      <p
                        id="credential-type-error"
                        role="alert"
                        className="text-sm leading-5 font-medium text-status-error"
                      >
                        {credentialTypeError}
                      </p>
                    ) : null}
                  </div>

                  <TextField
                    ref={achievementRef}
                    id="achievement-name"
                    label="Nombre del logro"
                    value={achievementName}
                    onChange={(event) => {
                      setAchievementName(event.target.value);
                      setAchievementError(undefined);
                      setDraftFeedback(null);
                    }}
                    description="Usá el nombre institucional del curso, materia o logro."
                    error={achievementError}
                  />

                  <Button type="submit" size="lg" disabled={!holder || submitting}>
                    {submitting ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <CheckCircle2 aria-hidden="true" />
                    )}
                    {submitting ? 'Guardando borrador' : 'Guardar borrador'}
                  </Button>
                </fieldset>
                <p aria-live="polite" className="text-sm text-text-muted">
                  {!holder
                    ? 'Confirmá primero al titular para habilitar esta etapa.'
                    : submitting
                      ? 'Guardando el borrador institucional.'
                      : 'El borrador todavía no será emitido.'}
                </p>
              </form>
            </CardContent>
          </Card>
        </div>

        <aside aria-labelledby="issuer-context-title" className="lg:sticky lg:top-8">
          <Card className="overflow-hidden border-brand-700 bg-brand-900 text-white shadow-sm">
            <CardHeader className="gap-4">
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"
              >
                <Building2 className="size-5" />
              </span>
              <div>
                <Badge variant="secondary">Definida por tu sesión</Badge>
                <h2
                  id="issuer-context-title"
                  className="mt-3 text-xl font-semibold"
                >
                  Institución emisora
                </h2>
              </div>
            </CardHeader>
            <Separator className="bg-white/10" />
            <CardContent className="pt-5">
              <p className="flex items-start gap-2 font-semibold">
                <LockKeyhole
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-teal-100"
                />
                <span>{issuerName}</span>
              </p>
              <p className="mt-4 text-sm leading-6 text-brand-100/80">
                La institución proviene de tu sesión y no puede editarse desde
                este formulario.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
