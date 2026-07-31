import type {
  CredentialDraftPatchFields,
  CredentialType,
  IssuerCredentialDetailVM,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

export type CredentialDraftSpecificField =
  | 'completionDate'
  | 'academicPeriod'
  | 'programName'
  | 'grade'
  | 'providerName'
  | 'platformName'
  | 'modality'
  | 'level'
  | 'certificationCode'
  | 'expirationDate'
  | 'externalUrl'
  | 'skills'
  | 'competencies'
  | 'learningOutcomes';

type CredentialDraftArrayField =
  | 'skills'
  | 'competencies'
  | 'learningOutcomes';

type CredentialDraftSpecificStringField = Exclude<
  CredentialDraftSpecificField,
  CredentialDraftArrayField
>;

export interface CredentialDraftEditorState {
  type: CredentialType;
  achievementName: string;
  description: string;
  hours: string;
  completionDate: string;
  academicPeriod: string;
  programName: string;
  grade: string;
  providerName: string;
  platformName: string;
  modality: string;
  level: string;
  certificationCode: string;
  expirationDate: string;
  externalUrl: string;
  skills: string;
  competencies: string;
  learningOutcomes: string;
}

export type CredentialDraftEditorErrors = Partial<
  Record<'achievementName' | 'hours' | 'externalUrl', string>
>;

export const credentialDraftFieldsByType: Record<
  CredentialType,
  readonly CredentialDraftSpecificField[]
> = {
  academic_subject: [
    'completionDate',
    'academicPeriod',
    'programName',
    'grade',
    'skills',
    'competencies'
  ],
  course: [
    'completionDate',
    'providerName',
    'platformName',
    'modality',
    'level',
    'skills',
    'competencies',
    'learningOutcomes'
  ],
  certification: [
    'completionDate',
    'certificationCode',
    'expirationDate',
    'externalUrl',
    'providerName',
    'level',
    'skills',
    'competencies'
  ],
  degree: [
    'completionDate',
    'programName',
    'level',
    'grade',
    'competencies',
    'learningOutcomes'
  ]
};

export const credentialDraftFieldLabels: Record<
  CredentialDraftSpecificField,
  string
> = {
  completionDate: 'Fecha de finalización',
  academicPeriod: 'Período académico',
  programName: 'Programa o carrera',
  grade: 'Calificación',
  providerName: 'Entidad o proveedor',
  platformName: 'Plataforma',
  modality: 'Modalidad',
  level: 'Nivel',
  certificationCode: 'Código de certificación',
  expirationDate: 'Fecha de vencimiento',
  externalUrl: 'URL de validación',
  skills: 'Skills',
  competencies: 'Competencias',
  learningOutcomes: 'Resultados de aprendizaje'
};

export const completionDateLabels: Record<CredentialType, string> = {
  academic_subject: 'Fecha de aprobación',
  course: 'Fecha de finalización',
  certification: 'Fecha de obtención',
  degree: 'Fecha de graduación'
};

const arrayFields = new Set<CredentialDraftSpecificField>([
  'skills',
  'competencies',
  'learningOutcomes'
]);

export function detailToDraftEditorState(
  detail: IssuerCredentialDetailVM
): CredentialDraftEditorState {
  const subject = detail.credentialSubject;

  return {
    type: detail.type,
    achievementName: subject.achievementName ?? detail.title,
    description: detail.description ?? '',
    hours: detail.hours ?? '',
    completionDate: subject.completionDate ?? '',
    academicPeriod: subject.academicPeriod ?? '',
    programName: subject.programName ?? '',
    grade: subject.grade ?? '',
    providerName: subject.providerName ?? '',
    platformName: subject.platformName ?? '',
    modality: subject.modality ?? '',
    level: subject.level ?? '',
    certificationCode: subject.certificationCode ?? '',
    expirationDate: subject.expirationDate ?? '',
    externalUrl: subject.externalUrl ?? '',
    skills: subject.skills.join('\n'),
    competencies: subject.competencies.join('\n'),
    learningOutcomes: subject.learningOutcomes.join('\n')
  };
}

export function linesToStringArray(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getIncompatiblePopulatedFields(
  state: CredentialDraftEditorState,
  targetType: CredentialType
): CredentialDraftSpecificField[] {
  const targetFields = new Set(credentialDraftFieldsByType[targetType]);

  return credentialDraftFieldsByType[state.type].filter(
    (field) => !targetFields.has(field) && isPopulated(state[field])
  );
}

export function applyCredentialTypeChange(
  state: CredentialDraftEditorState,
  targetType: CredentialType
): CredentialDraftEditorState {
  const targetFields = new Set(credentialDraftFieldsByType[targetType]);
  const next = {
    ...state,
    type: targetType
  };

  for (const field of credentialDraftFieldsByType[state.type]) {
    if (!targetFields.has(field)) {
      next[field] = '';
    }
  }

  return next;
}

export function validateDraftEditorState(
  state: CredentialDraftEditorState
): CredentialDraftEditorErrors {
  const errors: CredentialDraftEditorErrors = {};
  const achievementName = normalizeWhitespace(state.achievementName);
  const hours = state.hours.trim();
  const externalUrl = state.externalUrl.trim();

  if (!achievementName) {
    errors.achievementName = 'Ingresá el nombre del logro.';
  } else if (achievementName.length > 255) {
    errors.achievementName = 'Usá hasta 255 caracteres.';
  }

  if (
    hours &&
    (!/^\d+(?:\.\d{1,2})?$/.test(hours) || Number(hours) <= 0)
  ) {
    errors.hours = 'Ingresá un valor positivo con hasta dos decimales.';
  }

  if (externalUrl) {
    try {
      const url = new URL(externalUrl);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.externalUrl = 'Ingresá una URL HTTP o HTTPS válida.';
      }
    } catch {
      errors.externalUrl = 'Ingresá una URL HTTP o HTTPS válida.';
    }
  }

  return errors;
}

export function buildDraftUpdateCommand(input: {
  issuerReference: string;
  credentialReference: string;
  detail: IssuerCredentialDetailVM;
  state: CredentialDraftEditorState;
}): UpdateIssuerCredentialDraftCommand | null {
  const baseline = detailToDraftEditorState(input.detail);
  const changes: Partial<CredentialDraftPatchFields> = {};
  const mutableChanges = changes as Record<string, unknown>;

  const achievementName = normalizeWhitespace(input.state.achievementName);
  if (achievementName !== normalizeWhitespace(baseline.achievementName)) {
    changes.achievementName = achievementName;
  }

  const description = nullableText(input.state.description);
  if (description !== nullableText(baseline.description)) {
    changes.description = description;
  }

  const hours = nullableText(input.state.hours);
  if (hours !== nullableText(baseline.hours)) {
    changes.hours = hours;
  }

  if (input.state.type !== baseline.type) {
    changes.type = input.state.type;
  }

  for (const field of credentialDraftFieldsByType[input.state.type]) {
    if (arrayFields.has(field)) {
      const arrayField = field as CredentialDraftArrayField;
      const current = linesToStringArray(input.state[arrayField]);
      const previous = linesToStringArray(baseline[arrayField]);

      if (!arraysEqual(current, previous)) {
        mutableChanges[arrayField] = current;
      }

      continue;
    }

    const stringField = field as CredentialDraftSpecificStringField;
    const current = nullableText(input.state[stringField]);
    const previous = nullableText(baseline[stringField]);

    if (current !== previous) {
      mutableChanges[stringField] = current;
    }
  }

  if (Object.keys(changes).length === 0) {
    return null;
  }

  return {
    issuerReference: input.issuerReference,
    credentialReference: input.credentialReference,
    expectedUpdatedAt: input.detail.updatedAt,
    ...changes
  };
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function arraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function isPopulated(value: string) {
  return value.trim().length > 0;
}
