import type {
  ApprovalDriftStatus,
  ComparableCredentialField,
  DestinationCompatibilityStatus,
  TemplateContentDriftStatus
} from '@/models/credentials';

// C4b.2: unico lugar que traduce los enums tecnicos del backend a copy de
// producto en espanol. Los identifiers (`different_approval_available`,
// `matches_approved_source`, etc.) nunca deben aparecer sueltos en JSX --
// siempre pasan por estas funciones.

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function formatReusableInterpretationDate(value: string) {
  return dateFormatter.format(new Date(value));
}

const approvalDriftCopy: Record<ApprovalDriftStatus, string> = {
  none_applied: 'No hay una interpretación de este contenido aplicada todavía.',
  up_to_date:
    'La interpretación aplicada coincide con la aprobación disponible para este contenido.',
  different_approval_available:
    'La interpretación aprobada para este contenido cambió desde la aplicación actual. Revisá la versión disponible antes de volver a aplicar.'
};

export function formatApprovalDriftStatus(status: ApprovalDriftStatus) {
  return approvalDriftCopy[status];
}

const templateContentStatusCopy: Record<TemplateContentDriftStatus, string> = {
  matches_approved_source:
    'El contenido reutilizable coincide con el contenido sobre el que se revisó esta interpretación.',
  differs_from_approved_source:
    'El contenido reutilizable fue modificado desde la revisión de esta interpretación.',
  unknown:
    'No pudimos comparar el contenido reutilizable con el contenido de origen.'
};

export function formatTemplateContentStatus(status: TemplateContentDriftStatus) {
  return templateContentStatusCopy[status];
}

const destinationCompatibilityCopy: Record<DestinationCompatibilityStatus, string> = {
  compatible:
    'Esta credencial es compatible con el contenido sobre el que se revisó la interpretación.',
  modified:
    'La credencial tiene diferencias respecto del contenido sobre el que se revisó esta interpretación.',
  unknown:
    'No podemos verificar si esta interpretación corresponde al contenido de esta credencial.'
};

export function formatDestinationCompatibility(
  status: DestinationCompatibilityStatus
) {
  return destinationCompatibilityCopy[status];
}

const changedFieldLabels: Record<ComparableCredentialField, string> = {
  title: 'Título',
  description: 'Descripción',
  competencies: 'Competencias',
  learningOutcomes: 'Contenido e información adicional',
  skills: 'Habilidades',
  hours: 'Horas'
};

export function formatChangedField(field: ComparableCredentialField) {
  return changedFieldLabels[field];
}
