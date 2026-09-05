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
import { Label } from '@/components/ui/label';
import { AcademicSubjectCreationCatalogSection } from '@/features/credentials/academic-subject-creation-catalog-section';
import type { AcademicSubjectCatalogSearchHandlers } from '@/features/credentials/academic-subject-catalog-section';
import { ReusableTemplateSearchSection } from '@/features/credentials/reusable-template-search-section';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import {
  credentialTypeLabels,
  credentialTypesForIssuer
} from '@/models/credentials';
import type {
  AcademicProgramSearchItemVM,
  CourseTemplateSummaryVM,
  CredentialFeedback,
  CredentialDraftFormSubmission,
  CredentialType,
  CurriculumAcademicSubjectSearchItemVM,
  HolderSummaryVM,
  ReusableCredentialType
} from '@/models/credentials';

function isReusableCredentialType(
  value: CredentialType | ''
): value is ReusableCredentialType {
  return value === 'course' || value === 'certification';
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CredentialDraftFormProps
  extends AcademicSubjectCatalogSearchHandlers {
  issuerDid: string | null;
  issuerName: string;
  onResolveHolder(email: string): Promise<HolderSummaryVM>;
  onCreateDraft(input: CredentialDraftFormSubmission): Promise<void>;
  searchReusableTemplates?(
    credentialType: ReusableCredentialType,
    query: string,
    signal: AbortSignal
  ): Promise<CourseTemplateSummaryVM[]>;
}

export function CredentialDraftForm({
  issuerDid,
  issuerName,
  onCreateDraft,
  onResolveHolder,
  searchPrograms,
  searchReusableTemplates,
  searchSubjects
}: CredentialDraftFormProps) {
  const availableCredentialTypes = credentialTypesForIssuer(
    issuerDid,
    issuerName
  );
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
  const [selectedProgram, setSelectedProgram] =
    useState<AcademicProgramSearchItemVM | null>(null);
  const [selectedSubject, setSelectedSubject] =
    useState<CurriculumAcademicSubjectSearchItemVM | null>(null);
  const [appliedTemplate, setAppliedTemplate] =
    useState<CourseTemplateSummaryVM | null>(null);
  const [draftFeedback, setDraftFeedback] =
    useState<CredentialFeedback | null>(null);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const credentialTypeRef = useRef<HTMLSelectElement>(null);
  const achievementRef = useRef<HTMLInputElement>(null);

  const curricularSelectionReady =
    credentialType === 'academic_subject' &&
    selectedProgram !== null &&
    selectedSubject !== null;

  function changeCredentialType(value: string) {
    // C4x: reutilizacion atomica -- mientras haya un template aplicado, el
    // tipo queda bloqueado para evitar mezclas incompatibles (ej. aplicar
    // un template de course y despues cambiar a certification). Se
    // refuerza aca ademas del atributo disabled del <select> porque un
    // evento sintetico (test o extension) podria disparar onChange
    // aunque el control este deshabilitado.
    if (appliedTemplate) {
      return;
    }

    const nextType = availableCredentialTypes.includes(
      value as CredentialType
    )
      ? (value as CredentialType)
      : '';

    if (nextType !== credentialType) {
      setSelectedProgram(null);
      setSelectedSubject(null);
      // C3c: la seleccion de template reutilizable queda atada al tipo con
      // el que se busco -- cambiar de tipo la invalida para evitar que
      // queden campos incompatibles del tipo anterior.
      setAppliedTemplate(null);
    }

    setCredentialType(nextType);
    setCredentialTypeError(undefined);
    setDraftFeedback(null);
  }

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

    if (!credentialType) {
      setCredentialTypeError('Seleccioná un tipo de credencial.');
      credentialTypeRef.current?.focus();
      return;
    }

    let submission: CredentialDraftFormSubmission;

    if (credentialType === 'academic_subject') {
      if (!selectedProgram || !selectedSubject) {
        setDraftFeedback({
          code: 'invalid_input',
          message:
            'Seleccioná una carrera y una materia oficial antes de crear el borrador.'
        });
        return;
      }

      if (
        selectedSubject.curriculumReference !==
          selectedProgram.curriculumReference ||
        selectedSubject.programReference !== selectedProgram.programReference
      ) {
        setDraftFeedback({
          code: 'invalid_input',
          message:
            'La materia seleccionada no corresponde a la carrera actual. Volvé a seleccionarla.'
        });
        return;
      }

      submission = {
        credentialType,
        holder,
        program: selectedProgram,
        subject: selectedSubject
      };
    } else {
      const normalizedAchievementName = achievementName
        .trim()
        .replace(/\s+/g, ' ');

      if (!normalizedAchievementName) {
        setAchievementError('Ingresá el nombre del logro.');
        achievementRef.current?.focus();
        return;
      }

      setAchievementName(normalizedAchievementName);
      submission = {
        achievementName: normalizedAchievementName,
        credentialType,
        holder,
        ...(appliedTemplate ? { appliedTemplate } : {})
      };
    }

    setAchievementError(undefined);
    setDraftFeedback(null);
    setSubmitting(true);
    submittingRef.current = true;

    try {
      await onCreateDraft(submission);
    } catch (error) {
      setDraftFeedback(mapCredentialError(error, 'draft-create'));
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  return (
    <div className="grid gap-8 lg:gap-10">
      <header className="max-w-4xl border-b border-border-default pb-7 sm:pb-8">
        <Link
          href="/issuer"
          className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
        >
          Volver al portal
        </Link>
        <p className="mt-7 text-sm font-semibold text-teal-700">
          Nueva credencial
        </p>
        <h1 className="mt-3 text-3xl leading-tight font-bold tracking-tight text-text-strong sm:text-5xl">
          Creá un borrador institucional
        </h1>
        <p className="mt-4 max-w-4xl leading-7 text-text-muted">
          Confirmá al titular y elegí el tipo de credencial. Las asignaturas
          académicas se crean directamente desde la currícula institucional.
        </p>
      </header>

      <section
        aria-labelledby="issuer-context-title"
        className="grid gap-4 rounded-card border border-brand-700 bg-brand-900 p-5 text-white sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)] lg:items-center lg:gap-8"
      >
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-control border border-white/15 bg-white/5 text-teal-100"
          >
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wider text-teal-100 uppercase">
              Institución emisora
            </p>
            <h2
              id="issuer-context-title"
              className="mt-1 break-words text-xl font-semibold"
            >
              {issuerName}
            </h2>
          </div>
        </div>
        <div className="grid gap-2 border-t border-white/10 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <Badge variant="secondary" className="w-fit">
            <LockKeyhole aria-hidden="true" />
            Definida por tu sesión
          </Badge>
          <p className="text-sm leading-6 text-brand-100/80">
            La institución proviene de tu sesión y no puede editarse desde
            este formulario.
          </p>
        </div>
      </section>

      <div
        aria-label="Flujo de creación de credencial"
        className="grid gap-8 lg:gap-10"
      >
          <section
            aria-labelledby="holder-resolution-title"
            className="border-b border-border-default pb-8 sm:pb-10"
          >
            <div className="border-b border-border-default pb-5 sm:pb-6">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-pill bg-teal-100 text-sm font-bold text-teal-700">
                  1
                </span>
                <div>
                  <p className="text-sm font-semibold text-teal-700">
                    Resolver titular
                  </p>
                  <h2
                    id="holder-resolution-title"
                    className="text-xl font-semibold text-text-strong"
                  >
                    Identidad receptora
                  </h2>
                </div>
              </div>
            </div>
            <div className="pt-6">
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
                  className="rounded-card border border-teal-700/20 bg-teal-100/75 p-5 sm:p-6"
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
                <form
                  onSubmit={handleResolve}
                  noValidate
                  className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
                >
                  <div className="max-w-3xl">
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
                  </div>
                  <div aria-live="polite" className="flex min-h-11 items-center gap-3">
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
            </div>
          </section>

          <section
            aria-labelledby="credential-data-title"
            className="grid gap-6 border-b border-border-default pb-8 sm:pb-10"
          >
            <div className="border-b border-border-default pb-5 sm:pb-6">
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
                    Siguiente paso
                  </p>
                  <h2
                    id="credential-data-title"
                    className="text-xl font-semibold text-text-strong"
                  >
                    Datos del logro
                  </h2>
                </div>
              </div>
            </div>
            <div>
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

              <form onSubmit={handleCreateDraft} noValidate className="grid gap-6">
                <fieldset disabled={!holder || submitting} className="grid gap-6">
                  <section
                    aria-labelledby="credential-kind-title"
                    className="grid gap-5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-teal-700">
                        Categoría institucional
                      </p>
                      <h3
                        id="credential-kind-title"
                        className="mt-1 text-lg font-semibold text-text-strong"
                      >
                        Categoría del logro
                      </h3>
                    </div>
                    <div className="grid max-w-xl gap-2">
                    <Label htmlFor="credential-type">
                      Tipo de credencial
                    </Label>
                    <div className="relative">
                      <select
                        ref={credentialTypeRef}
                        id="credential-type"
                        value={credentialType}
                        disabled={appliedTemplate !== null}
                        onChange={(event) =>
                          changeCredentialType(event.target.value)
                        }
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
                        {availableCredentialTypes.map((type) => (
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
                      {appliedTemplate
                        ? 'Bloqueado mientras haya contenido reutilizable aplicado.'
                        : 'Elegí la categoría institucional que describe el logro.'}
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
                  </section>

                  {isReusableCredentialType(credentialType) &&
                  searchReusableTemplates ? (
                    <ReusableTemplateSearchSection
                      credentialType={credentialType}
                      disabled={submitting}
                      appliedTemplate={appliedTemplate}
                      onApply={(template) => {
                        const precargado = template.title;
                        setAchievementName(precargado);
                        setAchievementError(undefined);
                        setAppliedTemplate(template);
                        setDraftFeedback(null);
                      }}
                      onClearApplied={() => setAppliedTemplate(null)}
                      searchTemplates={(query, signal) =>
                        searchReusableTemplates(credentialType, query, signal)
                      }
                    />
                  ) : null}

                  {credentialType === 'academic_subject' ? (
                    <AcademicSubjectCreationCatalogSection
                      disabled={submitting}
                      searchPrograms={searchPrograms}
                      searchSubjects={searchSubjects}
                      selectedProgram={selectedProgram}
                      selectedSubject={selectedSubject}
                      onProgramChange={(program) => {
                        setSelectedProgram(program);
                        setSelectedSubject(null);
                        setDraftFeedback(null);
                      }}
                      onSubjectChange={(subject) => {
                        setSelectedSubject(subject);
                        setDraftFeedback(null);
                      }}
                    />
                  ) : credentialType ? (
                    <section
                      aria-labelledby="achievement-main-data-title"
                      className="grid gap-5 border-t border-border-default pt-6"
                    >
                      <div>
                        <p className="text-sm font-semibold text-teal-700">
                          Información principal
                        </p>
                        <h3
                          id="achievement-main-data-title"
                          className="mt-1 text-lg font-semibold text-text-strong"
                        >
                          Identidad del logro
                        </h3>
                      </div>
                      <div className="max-w-3xl">
                        <TextField
                          ref={achievementRef}
                          id="achievement-name"
                          label="Nombre del logro"
                          value={achievementName}
                          disabled={appliedTemplate !== null}
                          onChange={(event) => {
                            // C4x: mientras haya un template aplicado, el
                            // nombre queda bloqueado (precargado desde el
                            // template) -- se refuerza aca ademas del
                            // atributo disabled del input.
                            if (appliedTemplate) {
                              return;
                            }
                            setAchievementName(event.target.value);
                            setAchievementError(undefined);
                            setDraftFeedback(null);
                          }}
                          description={
                            appliedTemplate
                              ? 'Precargado desde el contenido reutilizable aplicado. Quitalo para editarlo.'
                              : 'Usá el nombre institucional del curso o logro.'
                          }
                          error={achievementError}
                        />
                      </div>
                    </section>
                  ) : null}

                  {credentialType === 'academic_subject' &&
                  holder &&
                  selectedProgram &&
                  selectedSubject ? (
                    <section
                      aria-labelledby="creation-summary-title"
                      className="grid gap-4 border-y border-border-default bg-surface-muted/55 py-5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-5 sm:py-6"
                    >
                      <div className="sm:col-span-2">
                        <p className="text-sm font-semibold text-teal-700">
                          Paso 4
                        </p>
                        <h3
                          id="creation-summary-title"
                          className="mt-1 text-lg font-semibold text-text-strong"
                        >
                          Resumen antes de crear
                        </h3>
                      </div>
                      <dl className="grid gap-4 text-sm sm:col-span-2 sm:grid-cols-2">
                        <div>
                          <dt className="font-semibold text-text-muted">
                            Titular
                          </dt>
                          <dd className="mt-1 text-text-strong">
                            {holder.displayLabel}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-text-muted">
                            Carrera / plan
                          </dt>
                          <dd className="mt-1 text-text-strong">
                            {selectedProgram.programName}
                            <span className="mt-1 block text-xs font-semibold text-text-muted">
                              Código {selectedProgram.programCode}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-text-muted">
                            Materia oficial
                          </dt>
                          <dd className="mt-1 text-text-strong">
                            {selectedSubject.name}
                            <span className="mt-1 block text-xs font-semibold text-text-muted">
                              Código {selectedSubject.code}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-text-muted">
                            Horas oficiales
                          </dt>
                          <dd className="mt-1 text-text-strong">
                            {selectedSubject.hours ??
                              'No disponible en el catálogo'}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="font-semibold text-text-muted">
                            Descripción oficial
                          </dt>
                          <dd className="mt-1 leading-6 text-text-strong">
                            {selectedSubject.description ??
                              'No disponible en el catálogo'}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  ) : null}

                  <div className="flex flex-col-reverse gap-3 border-t border-border-default pt-6 sm:flex-row sm:items-center sm:justify-between">
                    <p aria-live="polite" className="text-sm text-text-muted">
                      {!holder
                        ? 'Confirmá primero al titular para habilitar esta etapa.'
                        : submitting
                          ? 'Guardando el borrador institucional.'
                          : 'El borrador todavía no será emitido.'}
                    </p>
                    <Button
                      type="submit"
                      size="lg"
                      disabled={
                        !holder ||
                        submitting ||
                        (credentialType === 'academic_subject' &&
                          !curricularSelectionReady)
                      }
                    >
                      {submitting ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                        />
                      ) : (
                        <CheckCircle2 aria-hidden="true" />
                      )}
                      {submitting ? 'Creando borrador' : 'Crear borrador'}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </div>
          </section>
      </div>
    </div>
  );
}
