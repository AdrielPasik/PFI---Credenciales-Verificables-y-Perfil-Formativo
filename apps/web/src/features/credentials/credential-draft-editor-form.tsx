'use client';

import {
  Check,
  RefreshCw,
  Save
} from 'lucide-react';
import {
  useRef,
  useState,
  type FormEvent,
  type RefObject
} from 'react';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AcademicSubjectCatalogSection,
  type AcademicSubjectCatalogSearchHandlers
} from '@/features/credentials/academic-subject-catalog-section';
import {
  applyCredentialTypeChange,
  buildAcademicPeriodInput,
  buildDraftUpdateCommand,
  completionDateLabels,
  credentialDraftFieldLabels,
  credentialDraftFieldsByType,
  detailToDraftEditorState,
  getIncompatiblePopulatedFields,
  parseAcademicPeriodInput,
  sanitizeAcademicGradeInput,
  sanitizeAcademicYearInput,
  validateDraftEditorState,
  type CredentialDraftEditorErrors,
  type CredentialDraftEditorState,
  type CredentialDraftSpecificField
} from '@/features/credentials/credential-draft-editor';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';
import {
  credentialTypeLabels,
  credentialTypeOptions,
  type CredentialFeedback,
  type CredentialType,
  type CurriculumAcademicSubjectSearchItemVM,
  type IssuerCredentialDetailVM,
  type UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

interface CredentialDraftEditorFormProps
  extends AcademicSubjectCatalogSearchHandlers {
  detail: IssuerCredentialDetailVM;
  issuerReference: string;
  onSave(
    command: UpdateIssuerCredentialDraftCommand
  ): Promise<IssuerCredentialDetailVM>;
  onReloadLatest(): Promise<IssuerCredentialDetailVM>;
  onTerminalError(feedback: CredentialFeedback): void;
}

type EditorFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; feedback: CredentialFeedback }
  | null;

export function CredentialDraftEditorForm({
  detail,
  issuerReference,
  onReloadLatest,
  onSave,
  onTerminalError,
  searchPrograms,
  searchSubjects
}: CredentialDraftEditorFormProps) {
  const [state, setState] = useState(() =>
    detailToDraftEditorState(detail)
  );
  const [baselineDetail, setBaselineDetail] = useState(detail);
  const [errors, setErrors] = useState<CredentialDraftEditorErrors>({});
  const [feedback, setFeedback] = useState<EditorFeedback>(null);
  const [pendingType, setPendingType] = useState<CredentialType | null>(
    null
  );
  const [incompatibleFields, setIncompatibleFields] = useState<
    CredentialDraftSpecificField[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [pendingAcademicSelection, setPendingAcademicSelection] =
    useState<CurriculumAcademicSubjectSearchItemVM | null>(null);
  const [catalogSelectionInvalidated, setCatalogSelectionInvalidated] =
    useState(false);
  const [catalogResetKey, setCatalogResetKey] = useState(0);
  const [catalogLinkWillBeRemoved, setCatalogLinkWillBeRemoved] =
    useState(false);
  const achievementNameRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const externalUrlRef = useRef<HTMLInputElement>(null);
  const academicYearRef = useRef<HTMLInputElement>(null);
  const gradeRef = useRef<HTMLInputElement>(null);

  const command = buildDraftUpdateCommand({
    issuerReference,
    credentialReference: baselineDetail.credentialReference,
    detail: baselineDetail,
    state,
    pendingAcademicSelection
  });
  const visibleFields = credentialDraftFieldsByType[state.type];
  const persistedAcademicSelection = catalogSelectionInvalidated
    ? null
    : baselineDetail.academicCourse;
  const academicSelectionRequired =
    state.type === 'academic_subject' &&
    persistedAcademicSelection === null &&
    pendingAcademicSelection === null;

  function updateField<Key extends keyof CredentialDraftEditorState>(
    field: Key,
    value: CredentialDraftEditorState[Key]
  ) {
    setState((current) => ({
      ...current,
      [field]: value
    }));
    setFeedback(null);
    setErrors((current) => ({
      ...current,
      [field]: undefined
    }));
  }

  function requestTypeChange(targetType: CredentialType) {
    if (targetType === state.type) {
      return;
    }

    const incompatible = getIncompatiblePopulatedFields(state, targetType);
    const removesCatalogLink =
      state.type === 'academic_subject' &&
      targetType !== 'academic_subject' &&
      (persistedAcademicSelection !== null ||
        pendingAcademicSelection !== null);

    if (incompatible.length === 0 && !removesCatalogLink) {
      setState((current) =>
        applyCredentialTypeChange(current, targetType)
      );
      setFeedback(null);
      return;
    }

    setPendingType(targetType);
    setIncompatibleFields(incompatible);
    setCatalogLinkWillBeRemoved(removesCatalogLink);
  }

  function confirmTypeChange() {
    if (!pendingType) {
      return;
    }

    setState((current) =>
      applyCredentialTypeChange(current, pendingType)
    );
    if (catalogLinkWillBeRemoved) {
      setPendingAcademicSelection(null);
      setCatalogSelectionInvalidated(true);
      setCatalogResetKey((current) => current + 1);
    }
    setPendingType(null);
    setIncompatibleFields([]);
    setCatalogLinkWillBeRemoved(false);
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving || pendingType || academicSelectionRequired) {
      return;
    }

    const nextErrors = validateDraftEditorState(state);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(nextErrors, {
        achievementName: achievementNameRef.current,
        hours: hoursRef.current,
        externalUrl: externalUrlRef.current,
        academicPeriod: academicYearRef.current,
        grade: gradeRef.current
      });
      return;
    }

    const nextCommand = buildDraftUpdateCommand({
      issuerReference,
      credentialReference: baselineDetail.credentialReference,
      detail: baselineDetail,
      state,
      pendingAcademicSelection
    });

    if (!nextCommand) {
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const saved = await onSave(nextCommand);
      setBaselineDetail(saved);
      setState(detailToDraftEditorState(saved));
      setPendingAcademicSelection(null);
      setCatalogSelectionInvalidated(false);
      setCatalogResetKey((current) => current + 1);
      setErrors({});
      setFeedback({
        kind: 'success',
        message: 'Los cambios del borrador se guardaron correctamente.'
      });
    } catch (caught) {
      const mapped = mapCredentialError(caught, 'draft-update');

      if (
        mapped.code === 'forbidden' ||
        mapped.code === 'not_found' ||
        mapped.code === 'session_expired'
      ) {
        onTerminalError(mapped);
        return;
      }

      setFeedback({ kind: 'error', feedback: mapped });
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatestVersion() {
    if (reloading) {
      return;
    }

    setReloading(true);

    try {
      const latest = await onReloadLatest();
      setBaselineDetail(latest);
      setState(detailToDraftEditorState(latest));
      setPendingAcademicSelection(null);
      setCatalogSelectionInvalidated(false);
      setCatalogResetKey((current) => current + 1);
      setFeedback(null);
    } catch (caught) {
      const mapped = mapCredentialError(caught, 'detail');

      if (
        mapped.code === 'forbidden' ||
        mapped.code === 'not_found' ||
        mapped.code === 'session_expired'
      ) {
        onTerminalError(mapped);
        return;
      }

      setFeedback({ kind: 'error', feedback: mapped });
    } finally {
      setReloading(false);
    }
  }

  return (
    <section aria-labelledby="draft-editor-title" className="grid gap-6">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-teal-700">
          Completar borrador
        </p>
        <h2
          id="draft-editor-title"
          className="mt-2 text-2xl font-bold tracking-tight text-text-strong"
        >
          Datos de la credencial
        </h2>
        <p className="mt-2 leading-7 text-text-muted">
          Actualizá únicamente la información respaldada por la institución.
          Los cambios se guardan de forma explícita.
        </p>
      </div>

      <form noValidate onSubmit={submit} className="grid gap-6">
        <Card className="border-border-strong shadow-none">
          <CardHeader className="border-b border-border-default">
            <p className="text-sm font-semibold text-brand-700">
              Información común
            </p>
            <h3 className="text-lg font-semibold text-text-strong">
              Identidad del logro
            </h3>
          </CardHeader>
          <CardContent className="grid gap-5 pt-5 sm:grid-cols-2 sm:pt-6">
            <SelectField
              id="credential-type"
              label="Tipo de credencial"
              value={state.type}
              disabled={saving}
              onChange={(value) => requestTypeChange(value)}
            />
            {state.type !== 'academic_subject' ? (
              <>
                <TextField
                  ref={achievementNameRef}
                  id="achievement-name"
                  label="Nombre del logro"
                  value={state.achievementName}
                  required
                  maxLength={255}
                  disabled={saving}
                  error={errors.achievementName}
                  onChange={(event) =>
                    updateField('achievementName', event.target.value)
                  }
                />
                <TextareaField
                  id="credential-description"
                  label="Descripción"
                  value={state.description}
                  disabled={saving}
                  className="sm:col-span-2"
                  onChange={(value) => updateField('description', value)}
                />
                <TextField
                  ref={hoursRef}
                  id="credential-hours"
                  label="Horas"
                  value={state.hours}
                  inputMode="decimal"
                  placeholder="Ejemplo: 24.5"
                  disabled={saving}
                  error={errors.hours}
                  description="Usá un valor positivo con hasta dos decimales."
                  onChange={(event) =>
                    updateField('hours', event.target.value)
                  }
                />
              </>
            ) : (
              <p className="self-end text-sm leading-6 text-text-muted">
                El nombre, la descripción y las horas se toman de la
                asignatura oficial seleccionada.
              </p>
            )}
          </CardContent>
        </Card>

        {pendingType ? (
          <FeedbackAlert variant="warning" title="Revisá el cambio de tipo">
            <p>
              {catalogLinkWillBeRemoved
                ? 'Cambiar el tipo quitará la vinculación con la asignatura oficial y su carrera cuando guardes los cambios.'
                : 'Cambiar el tipo eliminará los datos que no correspondan a la nueva credencial cuando guardes los cambios.'}
            </p>
            {incompatibleFields.length > 0 ? (
              <p className="mt-2 text-sm">
                Se limpiarán:{' '}
                {incompatibleFields
                  .map((field) => credentialDraftFieldLabels[field])
                  .join(', ')}.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPendingType(null);
                  setIncompatibleFields([]);
                  setCatalogLinkWillBeRemoved(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={confirmTypeChange}>
                Cambiar tipo
              </Button>
            </div>
          </FeedbackAlert>
        ) : null}

        {state.type === 'academic_subject' ? (
          <AcademicSubjectCatalogSection
            key={catalogResetKey}
            disabled={saving}
            persistedSelection={persistedAcademicSelection}
            pendingSelection={pendingAcademicSelection}
            searchPrograms={searchPrograms}
            searchSubjects={searchSubjects}
            onPendingSelectionChange={(selection) => {
              setPendingAcademicSelection(selection);
              setFeedback(null);
            }}
          />
        ) : null}

        <Card className="overflow-hidden border-border-strong shadow-none">
          <div aria-hidden="true" className="h-1 bg-teal-700" />
          <CardHeader className="border-b border-border-default">
            <p className="text-sm font-semibold text-teal-700">
              {credentialTypeLabels[state.type]}
            </p>
            <h3 className="text-lg font-semibold text-text-strong">
              {state.type === 'academic_subject'
                ? 'Datos de aprobación y enriquecimiento'
                : 'Información específica'}
            </h3>
            <p className="text-sm leading-6 text-text-muted">
              {state.type === 'academic_subject'
                ? 'Estos campos son opcionales y pueden completarse manualmente.'
                : 'Los campos visibles corresponden al tipo seleccionado.'}
            </p>
          </CardHeader>
          <CardContent className="grid gap-5 pt-5 sm:grid-cols-2 sm:pt-6">
            {visibleFields.map((field) => (
              <SpecificField
                key={field}
                field={field}
                state={state}
                disabled={saving}
                academicPeriodError={errors.academicPeriod}
                academicYearRef={academicYearRef}
                externalUrlError={errors.externalUrl}
                externalUrlRef={externalUrlRef}
                gradeError={errors.grade}
                gradeRef={gradeRef}
                onChange={updateField}
              />
            ))}
          </CardContent>
        </Card>

        {feedback?.kind === 'success' ? (
          <FeedbackAlert variant="success" title="Cambios guardados">
            {feedback.message}
          </FeedbackAlert>
        ) : null}

        {feedback?.kind === 'error' ? (
          <FeedbackAlert
            variant="error"
            title={
              feedback.feedback.code === 'conflict'
                ? 'Hay una versión más reciente'
                : 'No pudimos guardar los cambios'
            }
          >
            <p>{feedback.feedback.message}</p>
            {feedback.feedback.code === 'conflict' ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                disabled={reloading}
                onClick={() => void reloadLatestVersion()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={reloading ? 'animate-spin' : undefined}
                />
                {reloading ? 'Recargando…' : 'Recargar última versión'}
              </Button>
            ) : null}
          </FeedbackAlert>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border-default pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="text-sm text-text-muted">
            {saving
              ? 'Guardando cambios…'
              : academicSelectionRequired
                ? 'Seleccioná una carrera y una materia oficial para guardar.'
              : command
                ? 'Tenés cambios sin guardar.'
                : 'No hay cambios pendientes.'}
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={
              !command ||
              saving ||
              pendingType !== null ||
              academicSelectionRequired
            }
          >
            {saving ? (
              <RefreshCw aria-hidden="true" className="animate-spin" />
            ) : command ? (
              <Save aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SpecificField({
  academicPeriodError,
  academicYearRef,
  disabled,
  externalUrlError,
  externalUrlRef,
  field,
  gradeError,
  gradeRef,
  onChange,
  state
}: {
  academicPeriodError?: string;
  academicYearRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  externalUrlError?: string;
  externalUrlRef: RefObject<HTMLInputElement | null>;
  field: CredentialDraftSpecificField;
  gradeError?: string;
  gradeRef: RefObject<HTMLInputElement | null>;
  onChange<Key extends keyof CredentialDraftEditorState>(
    field: Key,
    value: CredentialDraftEditorState[Key]
  ): void;
  state: CredentialDraftEditorState;
}) {
  const label = fieldLabel(field, state.type);

  if (field === 'academicPeriod' && state.type === 'academic_subject') {
    const period = parseAcademicPeriodInput(state.academicPeriod);

    return (
      <AcademicPeriodField
        yearRef={academicYearRef}
        disabled={disabled}
        error={academicPeriodError}
        year={period.year}
        term={period.term}
        onYearChange={(year) =>
          onChange(
            'academicPeriod',
            buildAcademicPeriodInput(year, period.term)
          )
        }
        onTermChange={(term) =>
          onChange(
            'academicPeriod',
            buildAcademicPeriodInput(period.year, term)
          )
        }
      />
    );
  }

  if (
    field === 'skills' ||
    field === 'competencies' ||
    field === 'learningOutcomes'
  ) {
    return (
      <TextareaField
        id={`credential-${field}`}
        label={label}
        value={state[field]}
        disabled={disabled}
        description={arrayFieldDescription(field, state.type)}
        className="sm:col-span-2"
        onChange={(value) => onChange(field, value)}
      />
    );
  }

  if (field === 'completionDate' || field === 'expirationDate') {
    return (
      <TextField
        id={`credential-${field}`}
        type="date"
        label={label}
        value={state[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
    );
  }

  if (field === 'externalUrl') {
    return (
      <TextField
        ref={externalUrlRef}
        id="credential-external-url"
        type="url"
        label={label}
        value={state.externalUrl}
        maxLength={2048}
        placeholder="https://..."
        disabled={disabled}
        error={externalUrlError}
        onChange={(event) => onChange('externalUrl', event.target.value)}
      />
    );
  }

  if (field === 'grade' && state.type === 'academic_subject') {
    return (
      <TextField
        ref={gradeRef}
        id="credential-grade"
        label="Calificación (opcional)"
        value={state.grade}
        inputMode="decimal"
        placeholder="Ejemplo: 8.5"
        disabled={disabled}
        error={gradeError}
        description="Ingresá un valor entre 0 y 10, con hasta dos decimales."
        onChange={(event) =>
          onChange('grade', sanitizeAcademicGradeInput(event.target.value))
        }
      />
    );
  }

  return (
    <TextField
      id={`credential-${field}`}
      label={label}
      value={state[field]}
      maxLength={255}
      disabled={disabled}
      onChange={(event) => onChange(field, event.target.value)}
    />
  );
}

function fieldLabel(
  field: CredentialDraftSpecificField,
  type: CredentialType
) {
  if (field === 'completionDate') {
    return type === 'academic_subject'
      ? `${completionDateLabels[type]} (opcional)`
      : completionDateLabels[type];
  }

  if (field === 'providerName') {
    return type === 'course' ? 'Proveedor' : 'Entidad o proveedor';
  }

  if (field === 'level' && type === 'degree') {
    return 'Nivel académico';
  }

  if (field === 'skills' && type === 'academic_subject') {
    return 'Habilidades técnicas (opcional)';
  }

  if (field === 'competencies' && type === 'academic_subject') {
    return 'Competencias formativas (opcional)';
  }

  return credentialDraftFieldLabels[field];
}

function arrayFieldDescription(
  field: 'skills' | 'competencies' | 'learningOutcomes',
  type: CredentialType
) {
  if (type === 'academic_subject' && field === 'skills') {
    return 'Una entrada por línea. Ejemplos: SQL, Python, modelado de datos.';
  }

  if (type === 'academic_subject' && field === 'competencies') {
    return 'Una entrada por línea. Ejemplos: diseñar soluciones, resolver problemas, comunicar decisiones.';
  }

  return 'Una entrada por línea.';
}

function AcademicPeriodField({
  disabled,
  error,
  onTermChange,
  onYearChange,
  term,
  year,
  yearRef
}: {
  disabled: boolean;
  error?: string;
  onTermChange(term: '' | '1' | '2'): void;
  onYearChange(year: string): void;
  term: '' | '1' | '2';
  year: string;
  yearRef: RefObject<HTMLInputElement | null>;
}) {
  const errorId = error ? 'credential-academic-period-error' : undefined;

  return (
    <fieldset
      className="grid gap-4 sm:col-span-2 sm:grid-cols-2"
      aria-describedby={errorId}
    >
      <legend className="sr-only">Período académico</legend>
      <TextField
        ref={yearRef}
        id="credential-academic-year"
        label="Año académico (opcional)"
        value={year}
        inputMode="numeric"
        maxLength={4}
        placeholder="Ejemplo: 2026"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) =>
          onYearChange(sanitizeAcademicYearInput(event.target.value))
        }
      />
      <div className="grid gap-2">
        <Label htmlFor="credential-academic-term">
          Período (opcional)
        </Label>
        <select
          id="credential-academic-term"
          value={term}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted sm:text-sm"
          onChange={(event) =>
            onTermChange(event.target.value as '' | '1' | '2')
          }
        >
          <option value="">Seleccionar período</option>
          <option value="1">Primer cuatrimestre</option>
          <option value="2">Segundo cuatrimestre</option>
        </select>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm leading-5 font-medium text-status-error sm:col-span-2"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function SelectField({
  disabled,
  id,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange(value: CredentialType): void;
  value: CredentialType;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors hover:border-brand-600 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted sm:text-sm"
        onChange={(event) =>
          onChange(event.target.value as CredentialType)
        }
      >
        {credentialTypeOptions.map((type) => (
          <option key={type} value={type}>
            {credentialTypeLabels[type]}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextareaField({
  className,
  description,
  disabled,
  id,
  label,
  onChange,
  value
}: {
  className?: string;
  description?: string;
  disabled: boolean;
  id: string;
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={`grid gap-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? (
        <p id={descriptionId} className="text-sm leading-5 text-text-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function focusFirstInvalidField(
  errors: CredentialDraftEditorErrors,
  fields: Record<keyof CredentialDraftEditorErrors, HTMLInputElement | null>
) {
  for (const field of [
    'achievementName',
    'hours',
    'externalUrl',
    'academicPeriod',
    'grade'
  ] as const) {
    if (errors[field]) {
      fields[field]?.focus();
      return;
    }
  }
}
