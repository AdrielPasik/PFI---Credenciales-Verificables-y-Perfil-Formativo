import { BadRequestException } from '@nestjs/common';
import { CredentialType, Prisma } from '@prisma/client';

import type { ReusableCredentialType } from './issuer-course-templates.validator';

// C3a/C3a.2: mismas claves de credentialSubject que
// issuer-credential-read.mapper.ts (achievement_name, platform_name,
// modality, external_url, certification_code, expiration_date,
// provider_name, level, competencies, learning_outcomes, skills). Se
// duplica localmente porque esos helpers no estan exportados y no queremos
// acoplar este catalogo al mapper de lectura de credenciales.

export function toJsonObject(
  value: Prisma.JsonValue
): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}

export function readSubjectText(
  source: Record<string, Prisma.JsonValue>,
  key:
    | 'achievement_name'
    | 'platform_name'
    | 'modality'
    | 'external_url'
    | 'certification_code'
    | 'expiration_date'
    | 'provider_name'
    | 'level'
): string | null {
  const value = source[key];

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function readSubjectStringArray(
  source: Record<string, Prisma.JsonValue>,
  key: 'competencies' | 'learning_outcomes' | 'skills'
): string[] {
  const value = source[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalized = entry.trim().replace(/\s+/g, ' ');
    const comparisonKey = normalized.toLocaleLowerCase('en-US');

    if (normalized && !seen.has(comparisonKey)) {
      seen.add(comparisonKey);
      result.push(normalized);
    }
  }

  return result;
}

// Prioridad: credentialSubject.achievement_name, despues Credential.title.
// Nunca copia providerName/level/skills como titulo, y nunca usa un titulo
// vacio.
export function resolveTemplateTitleFromCredential(
  subject: Record<string, Prisma.JsonValue>,
  credentialTitle: string
): string {
  const achievementName = readSubjectText(subject, 'achievement_name');

  if (achievementName) {
    return achievementName;
  }

  const normalizedCredentialTitle =
    typeof credentialTitle === 'string' ? credentialTitle.trim() : '';

  if (normalizedCredentialTitle) {
    return normalizedCredentialTitle;
  }

  throw new BadRequestException(
    'La credencial no tiene un titulo suficiente para crear un template reutilizable.'
  );
}

// Normalizacion para comparar duplicados: trim, colapsar espacios,
// case-insensitive. No se persiste (ver decision documentada en el bundle).
export function normalizeTitleForComparison(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

// C3a.2: solo course y certification pueden guardarse como reutilizables.
// academic_subject y degree pertenecen al catalogo academico formal
// (AcademicCourse/Program) -- nunca a un catalogo libre por issuer.
export function resolveReusableCredentialType(
  credentialType: CredentialType
): ReusableCredentialType {
  if (
    credentialType !== CredentialType.course &&
    credentialType !== CredentialType.certification
  ) {
    throw new BadRequestException(
      'Solo se pueden guardar como reutilizables credenciales de tipo course o certification.'
    );
  }

  return credentialType;
}
