import type { CredentialType, IssuerCredentialSubjectVM } from '@/models/credentials';

// C4x: para course/certification, la interpretacion asistida puede usar
// datos declarados por el emisor (descripcion, competencias, contenido
// adicional/learningOutcomes, skills) como respaldo textual institucional
// -- ver docs/architecture/domain-rules-v0.md. Este helper es la unica
// fuente de verdad para decidir si esa informacion declarada alcanza como
// respaldo, tanto para el warning de emision
// (credential-issuance-section.tsx) como para decidir si se oculta la
// carga manual de "Contenido textual de respaldo" (credential-detail-route.tsx).
//
// Nunca aplica a academic_subject/degree -- esos tipos siguen dependiendo
// exclusivamente de DocumentEvidence/TextEvidence manual, sin cambios.
//
// Criterio conservador: solo el titulo nunca alcanza; un campo vacio o de
// pocos caracteres tampoco. Una descripcion con contenido real, o al menos
// una competencia/habilidad/entrada de contenido adicional no vacia
// (ya validada y normalizada por el backend al guardarse), si alcanza.
const MIN_DESCRIPTION_LENGTH = 20;

export interface InstitutionalTextualBackingInput {
  type: CredentialType;
  description: string | null;
  credentialSubject: Pick<
    IssuerCredentialSubjectVM,
    'competencies' | 'learningOutcomes' | 'skills'
  >;
}

export function hasInstitutionalTextualBacking(
  credential: InstitutionalTextualBackingInput
): boolean {
  if (credential.type !== 'course' && credential.type !== 'certification') {
    return false;
  }

  if (isSubstantiveDescription(credential.description)) {
    return true;
  }

  const { competencies, learningOutcomes, skills } = credential.credentialSubject;

  return (
    hasNonEmptyEntry(competencies) ||
    hasNonEmptyEntry(learningOutcomes) ||
    hasNonEmptyEntry(skills)
  );
}

function isSubstantiveDescription(value: string | null): boolean {
  return value !== null && value.trim().length >= MIN_DESCRIPTION_LENGTH;
}

function hasNonEmptyEntry(entries: string[]): boolean {
  return entries.some((entry) => entry.trim().length > 0);
}
