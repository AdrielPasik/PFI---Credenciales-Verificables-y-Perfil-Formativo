import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  normalizeTitleForComparison,
  readSubjectStringArray,
  readSubjectText,
  toJsonObject
} from '../issuer-course-templates/issuer-course-templates.helpers';

// C4b.1b: comparacion de contenido declarativo -- ver
// docs/architecture/approved-semantic-interpretation-application-v0.md
// (v0.2, seccion 11) para el diseno completo de los tres conceptos de
// drift. Esta comparacion es puramente textual/de conjuntos, en memoria --
// nunca fuzzy matching, nunca embeddings, nunca IA, nunca un hash nuevo.
// Reutiliza toJsonObject/readSubjectText/readSubjectStringArray/
// normalizeTitleForComparison ya existentes -- nunca reinventa el
// parseo de credentialSubject.

export type ApprovalDriftStatus =
  | 'none_applied'
  | 'up_to_date'
  | 'different_approval_available';

export type ContentDriftStatus =
  | 'matches_approved_source'
  | 'differs_from_approved_source'
  | 'unknown';

export type DestinationCompatibility = 'compatible' | 'modified' | 'unknown';

// v0.2 seccion 11: campos declarativos materialmente semanticos. hours es
// una señal blanda -- puede aparecer en changedFields sin que, por si
// sola, transforme una comparacion compatible/matches en modified/differs.
// modality/certificationCode/providerName/level/platformName/externalUrl
// quedan fuera por decision explicita del diseno.
export type ComparableField =
  | 'title'
  | 'description'
  | 'competencies'
  | 'learningOutcomes'
  | 'skills'
  | 'hours';

export interface ComparableContent {
  title: string;
  description: string | null;
  competencies: string[];
  learningOutcomes: string[];
  skills: string[];
  hours: number | null;
}

const TEMPLATE_APPROVAL_INCOMPLETE_MESSAGE =
  'La aprobación semántica del contenido reutilizable está incompleta y no puede usarse todavía.';

export interface TemplateApprovalFields {
  approvedSemanticSnapshot: Prisma.JsonValue | null;
  approvedSemanticAnalysisId: string | null;
  approvedSemanticSourceCredentialId: string | null;
  approvedSemanticApprovedByUserId: string | null;
  approvedSemanticApprovedAt: Date | null;
  approvedSemanticPipelineVersion: string | null;
  approvedSemanticTaxonomyVersion: string | null;
}

export interface CompleteTemplateApprovalFields {
  approvedSemanticSnapshot: Prisma.JsonValue;
  approvedSemanticAnalysisId: string;
  approvedSemanticSourceCredentialId: string;
  approvedSemanticApprovedByUserId: string;
  approvedSemanticApprovedAt: Date;
  approvedSemanticPipelineVersion: string;
  approvedSemanticTaxonomyVersion: string;
}

// Seccion 16: un template puede (en teoria, por datos legacy o
// inconsistencias futuras) tener approvedSemanticSnapshot no nulo pero
// alguno de los otros 6 campos de provenance en null. Nunca se fabrica un
// valor por defecto -- candidate/apply rechazan explicitamente en vez de
// persistir una fila con provenance incompleta.
export function assertTemplateApprovalIsComplete(
  template: TemplateApprovalFields
): asserts template is CompleteTemplateApprovalFields {
  if (
    template.approvedSemanticSnapshot === null ||
    template.approvedSemanticAnalysisId === null ||
    template.approvedSemanticSourceCredentialId === null ||
    template.approvedSemanticApprovedByUserId === null ||
    template.approvedSemanticApprovedAt === null ||
    template.approvedSemanticPipelineVersion === null ||
    template.approvedSemanticTaxonomyVersion === null
  ) {
    throw new UnprocessableEntityException(TEMPLATE_APPROVAL_INCOMPLETE_MESSAGE);
  }
}

function normalizeNullableText(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString: unknown }).toString === 'function'
  ) {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Credential.title es siempre no vacio (columna NOT NULL), pero
// credentialSubject.achievement_name -- cuando existe -- es la fuente de
// verdad preferida para "titulo/logro" (mismo criterio ya usado por
// resolveTemplateTitleFromCredential, sin su excepcion: para comparar
// contenido nunca hace falta lanzar un 400 por falta de titulo).
export function toComparableCredentialContent(credential: {
  title: string;
  description: string | null;
  hours: unknown;
  credentialSubject: Prisma.JsonValue;
}): ComparableContent {
  const subject = toJsonObject(credential.credentialSubject);
  const achievementName = readSubjectText(subject, 'achievement_name');

  return {
    title: achievementName ?? credential.title.trim(),
    description: normalizeNullableText(credential.description),
    competencies: readSubjectStringArray(subject, 'competencies'),
    learningOutcomes: readSubjectStringArray(subject, 'learning_outcomes'),
    skills: readSubjectStringArray(subject, 'skills'),
    hours: toNullableNumber(credential.hours)
  };
}

// IssuerCourseTemplate ya guarda competencies/learningOutcomes/skills como
// columnas String[] propias (no dentro de un credentialSubject) -- se leen
// directamente, sin pasar por readSubjectStringArray.
export function toComparableTemplateContent(template: {
  title: string;
  description: string | null;
  hours: unknown;
  competencies: string[];
  learningOutcomes: string[];
  skills: string[];
}): ComparableContent {
  return {
    title: template.title.trim(),
    description: normalizeNullableText(template.description),
    competencies: template.competencies,
    learningOutcomes: template.learningOutcomes,
    skills: template.skills,
    hours: toNullableNumber(template.hours)
  };
}

function setsEqual(a: string[], b: string[]): boolean {
  const normalize = (values: string[]) =>
    new Set(values.map((value) => normalizeTitleForComparison(value)));
  const setA = normalize(a);
  const setB = normalize(b);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const value of setA) {
    if (!setB.has(value)) {
      return false;
    }
  }
  return true;
}

function hoursEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  // Credential.hours/IssuerCourseTemplate.hours son Decimal(10,2).
  return Math.abs(a - b) < 0.005;
}

interface ContentComparisonResult {
  matches: boolean;
  changedFields: ComparableField[];
}

function compareContent(
  a: ComparableContent,
  b: ComparableContent,
  credentialType: 'course' | 'certification'
): ContentComparisonResult {
  const changedFields: ComparableField[] = [];

  if (normalizeTitleForComparison(a.title) !== normalizeTitleForComparison(b.title)) {
    changedFields.push('title');
  }
  if (
    normalizeTitleForComparison(a.description ?? '') !==
    normalizeTitleForComparison(b.description ?? '')
  ) {
    changedFields.push('description');
  }
  if (!setsEqual(a.competencies, b.competencies)) {
    changedFields.push('competencies');
  }
  // learningOutcomes solo existe conceptualmente para course;
  // certification nunca lo declara (ver domain-rules-v0.md) -- comparar
  // igual es inofensivo (ambos lados siempre [] para certification), pero
  // se acota explicitamente para que quede claro que es intencional.
  if (
    credentialType === 'course' &&
    !setsEqual(a.learningOutcomes, b.learningOutcomes)
  ) {
    changedFields.push('learningOutcomes');
  }
  if (credentialType === 'certification' && !setsEqual(a.skills, b.skills)) {
    changedFields.push('skills');
  }
  if (!hoursEqual(a.hours, b.hours)) {
    changedFields.push('hours');
  }

  // hours es una señal blanda: una diferencia solo en hours nunca alcanza
  // por si sola para marcar el contenido como distinto.
  const hasHardDifference = changedFields.some((field) => field !== 'hours');

  return { matches: !hasHardDifference, changedFields };
}

// B: "¿el template actual sigue describiendo lo mismo que la credencial
// que origino la interpretacion aprobada?" -- advertencia editorial pura,
// nunca bloquea apply.
export function computeTemplateContentStatus(
  template: ComparableContent,
  sourceCredential: ComparableContent | null,
  credentialType: 'course' | 'certification'
): ContentDriftStatus {
  if (!sourceCredential) {
    return 'unknown';
  }
  const result = compareContent(template, sourceCredential, credentialType);
  return result.matches ? 'matches_approved_source' : 'differs_from_approved_source';
}

// C: "¿la credencial destino es compatible con la credencial que
// realmente origino la interpretacion?" -- el control que gatea apply.
// Nunca compara contra el template actual.
export function computeDestinationCompatibility(
  destinationCredential: ComparableContent,
  sourceCredential: ComparableContent | null,
  credentialType: 'course' | 'certification'
): { status: DestinationCompatibility; changedFields: ComparableField[] } {
  if (!sourceCredential) {
    return { status: 'unknown', changedFields: [] };
  }
  const result = compareContent(destinationCredential, sourceCredential, credentialType);
  return {
    status: result.matches ? 'compatible' : 'modified',
    changedFields: result.changedFields
  };
}

// A: "¿la aprobacion actual del template es la misma que ya esta
// aplicada?" -- identidad practica de la aprobacion fuente
// (sourceSemanticAnalysisId, sourceApprovedAt), nunca templateId solo
// (seccion 9 del diseno v0.2). Comparacion por igualdad exacta, nunca
// `>` -- nunca se afirma posterioridad temporal, solo que difiere.
export function computeApprovalDriftStatus(
  active: { sourceSemanticAnalysisId: string; sourceApprovedAt: Date } | null,
  template: { approvedSemanticAnalysisId: string; approvedSemanticApprovedAt: Date }
): ApprovalDriftStatus {
  if (!active) {
    return 'none_applied';
  }
  const sameIdentity =
    active.sourceSemanticAnalysisId === template.approvedSemanticAnalysisId &&
    active.sourceApprovedAt.getTime() === template.approvedSemanticApprovedAt.getTime();
  return sameIdentity ? 'up_to_date' : 'different_approval_available';
}

// Precondicion publica y segura para el flujo candidate -> apply (TOCTOU,
// seccion 7/X del pedido): identifica la aprobacion exacta que el emisor
// revisio, sin exponer sourceSemanticAnalysisId (que debe permanecer
// server-side). approvedSemanticApprovedAt alcanza como token practico:
// las 6 columnas approvedSemantic* del template siempre se escriben juntas
// y atomicamente en un unico update (ver issuer-course-templates.service.ts
// approveTemplateSemanticAnalysisForIssuer/
// approveCredentialSemanticAnalysisForIssuer) -- nunca cambia una sin que
// cambien las demas.
export function toApprovalRevision(approvedSemanticApprovedAt: Date): string {
  return approvedSemanticApprovedAt.toISOString();
}

export function approvalRevisionMatches(
  approvedSemanticApprovedAt: Date,
  expectedApprovalRevision: string
): boolean {
  return toApprovalRevision(approvedSemanticApprovedAt) === expectedApprovalRevision;
}
