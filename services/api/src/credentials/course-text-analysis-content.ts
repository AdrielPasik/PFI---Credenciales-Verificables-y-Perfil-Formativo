/**
 * C2b.3 / C4x fix: construye el texto formativo analizable de un `course`
 * (`buildCourseTextAnalysisContent`) o `certification`
 * (`buildCertificationTextAnalysisContent`) sin PDF, desde datos
 * DECLARADOS por el emisor. Funciones puras, sin I/O.
 *
 * course usa: achievementName/title, description, competencies,
 * learningOutcomes. Nunca platformName, providerName, modality,
 * externalUrl.
 *
 * certification usa: achievementName/title, description,
 * certificationCode, expirationDate, providerName, level, skills,
 * competencies. Nunca modality, platformName, academicCourseReference,
 * curriculumReference. certification no tiene learningOutcomes en su
 * contrato -- nunca se inventa ese campo para este tipo.
 *
 * Ninguna de las dos funciones usa issuer, holder, credential id,
 * approvedSemanticSnapshot/approvedSemanticAnalysisId/
 * lastSemanticAnalysisId, SemanticAnalysis existente, datos de
 * blockchain/canonical/hash, ni rawData completo -- esos campos van
 * (algunos, como metadata separada) hacia el AI Service
 * (ver AiServiceClient.analyzeText) o no se analizan en absoluto
 * (externalUrl nunca se lee como texto).
 *
 * No traducen, no expanden skills, no inventan contenido: si no hay
 * suficiente senal formativa declarada, devuelven null y el caller debe
 * saltear el analisis automatico sin fallar la emision.
 */

export interface CourseTextAnalysisFields {
  achievementName?: string | null;
  description?: string | null;
  competencies?: unknown;
  learningOutcomes?: unknown;
}

// "El contenido final normalizado debe tener al menos 30 caracteres" --
// umbral conservador explicito, no calibrado contra un dataset (mismo
// espiritu que TEXT_SHORT_LENGTH_THRESHOLD en el AI Service C2b.1).
export const COURSE_TEXT_ANALYSIS_MIN_CONTENT_LENGTH = 30;

const NAME_SECTION_LABEL = 'Nombre del curso';
const DESCRIPTION_SECTION_LABEL = 'Descripcion';
const COMPETENCIES_SECTION_LABEL = 'Competencias declaradas';
const LEARNING_OUTCOMES_SECTION_LABEL = 'Resultados de aprendizaje declarados';

// Cualquier caracter de espacio (incluye NBSP, tabs) que no sea salto de
// linea -- cubre "espacios raros" pegados desde un editor de texto rico
// sin necesidad de listar cada codepoint a mano.
const HORIZONTAL_WHITESPACE_RUN = /[^\S\n]+/g;

export function buildCourseTextAnalysisContent(
  fields: CourseTextAnalysisFields
): string | null {
  const name = normalizeSingleLine(fields.achievementName);
  const description = normalizeParagraph(fields.description);
  const competencies = normalizeList(fields.competencies);
  const learningOutcomes = normalizeList(fields.learningOutcomes);

  // Precondicion base: sin nombre ni descripcion no hay nada formativo
  // de donde partir (competencies/learningOutcomes solos, sin contexto,
  // no forman un texto coherente).
  if (!name && !description) {
    return null;
  }

  const sections: string[] = [];
  if (name) {
    sections.push(NAME_SECTION_LABEL + ':\n' + name);
  }
  if (description) {
    sections.push(DESCRIPTION_SECTION_LABEL + ':\n' + description);
  }
  if (competencies.length > 0) {
    sections.push(COMPETENCIES_SECTION_LABEL + ':\n' + toBullets(competencies));
  }
  if (learningOutcomes.length > 0) {
    sections.push(
      LEARNING_OUTCOMES_SECTION_LABEL + ':\n' + toBullets(learningOutcomes)
    );
  }

  const content = sections.join('\n\n').trim();

  if (content.length < COURSE_TEXT_ANALYSIS_MIN_CONTENT_LENGTH) {
    return null;
  }

  // Suficiencia conservadora: un titulo generico solo ("Curso", "Python",
  // "Capacitacion online") no debe disparar analisis automatico, aunque
  // por casualidad supere el umbral de longitud. Se exige: descripcion
  // con senal propia suficiente, o al menos dos fuentes formativas
  // distintas presentes (nombre + competencia, descripcion + resultado,
  // etc.) -- nunca una sola fuente aislada y debil.
  const descriptionIsStrongSignal =
    description.length >= COURSE_TEXT_ANALYSIS_MIN_CONTENT_LENGTH;
  const nonEmptySourceCount = [
    name.length > 0,
    description.length > 0,
    competencies.length > 0,
    learningOutcomes.length > 0
  ].filter(Boolean).length;

  if (!descriptionIsStrongSignal && nonEmptySourceCount < 2) {
    return null;
  }

  return content;
}

// C4x fix: analogo a CourseTextAnalysisFields, pero para certification --
// certification no tiene learningOutcomes en su contrato (ver
// credential-draft-editor.ts credentialDraftFieldsByType.certification),
// asi que nunca se agrega ese campo aca.
export interface CertificationTextAnalysisFields {
  achievementName?: string | null;
  description?: string | null;
  certificationCode?: string | null;
  expirationDate?: string | null;
  providerName?: string | null;
  level?: string | null;
  skills?: unknown;
  competencies?: unknown;
}

// Mismo umbral conservador que course -- ver comentario de
// COURSE_TEXT_ANALYSIS_MIN_CONTENT_LENGTH.
export const CERTIFICATION_TEXT_ANALYSIS_MIN_CONTENT_LENGTH = 30;

const CERTIFICATION_NAME_SECTION_LABEL = 'Nombre de la certificacion';
const CERTIFICATION_DESCRIPTION_SECTION_LABEL = 'Descripcion';
const CERTIFICATION_CODE_SECTION_LABEL = 'Codigo de certificacion';
const CERTIFICATION_EXPIRATION_SECTION_LABEL = 'Fecha de vencimiento';
const CERTIFICATION_PROVIDER_SECTION_LABEL = 'Entidad o proveedor';
const CERTIFICATION_LEVEL_SECTION_LABEL = 'Nivel';
const CERTIFICATION_SKILLS_SECTION_LABEL = 'Habilidades declaradas';
const CERTIFICATION_COMPETENCIES_SECTION_LABEL = 'Competencias declaradas';

export function buildCertificationTextAnalysisContent(
  fields: CertificationTextAnalysisFields
): string | null {
  const name = normalizeSingleLine(fields.achievementName);
  const description = normalizeParagraph(fields.description);
  const certificationCode = normalizeSingleLine(fields.certificationCode);
  const expirationDate = normalizeSingleLine(fields.expirationDate);
  const providerName = normalizeSingleLine(fields.providerName);
  const level = normalizeSingleLine(fields.level);
  const skills = normalizeList(fields.skills);
  const competencies = normalizeList(fields.competencies);

  // Misma precondicion base que course: sin nombre ni descripcion no hay
  // nada formativo de donde partir. skills/competencies/certificationCode/
  // expirationDate/providerName/level solos, sin nombre ni descripcion,
  // no forman un texto coherente (y en la practica achievementName
  // siempre esta presente en una credencial real).
  if (!name && !description) {
    return null;
  }

  const sections: string[] = [];
  if (name) {
    sections.push(CERTIFICATION_NAME_SECTION_LABEL + ':\n' + name);
  }
  if (description) {
    sections.push(CERTIFICATION_DESCRIPTION_SECTION_LABEL + ':\n' + description);
  }
  if (certificationCode) {
    sections.push(CERTIFICATION_CODE_SECTION_LABEL + ':\n' + certificationCode);
  }
  if (providerName) {
    sections.push(CERTIFICATION_PROVIDER_SECTION_LABEL + ':\n' + providerName);
  }
  if (level) {
    sections.push(CERTIFICATION_LEVEL_SECTION_LABEL + ':\n' + level);
  }
  if (expirationDate) {
    sections.push(CERTIFICATION_EXPIRATION_SECTION_LABEL + ':\n' + expirationDate);
  }
  if (skills.length > 0) {
    sections.push(CERTIFICATION_SKILLS_SECTION_LABEL + ':\n' + toBullets(skills));
  }
  if (competencies.length > 0) {
    sections.push(
      CERTIFICATION_COMPETENCIES_SECTION_LABEL + ':\n' + toBullets(competencies)
    );
  }

  const content = sections.join('\n\n').trim();

  if (content.length < CERTIFICATION_TEXT_ANALYSIS_MIN_CONTENT_LENGTH) {
    return null;
  }

  // Misma suficiencia conservadora que course, usando los 4 campos con
  // señal formativa real (name/description/skills/competencies).
  // certificationCode/expirationDate/providerName/level son contexto
  // suplementario -- se incluyen en el texto si estan presentes, pero
  // nunca cuentan para decidir si hay suficiente señal formativa.
  const descriptionIsStrongSignal =
    description.length >= CERTIFICATION_TEXT_ANALYSIS_MIN_CONTENT_LENGTH;
  const nonEmptyFormativeSourceCount = [
    name.length > 0,
    description.length > 0,
    skills.length > 0,
    competencies.length > 0
  ].filter(Boolean).length;

  if (!descriptionIsStrongSignal && nonEmptyFormativeSourceCount < 2) {
    return null;
  }

  return content;
}

function toBullets(items: string[]): string {
  return items.map((item) => '- ' + item).join('\n');
}

function normalizeSingleLine(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  // A proposito usa \s (incluye saltos de linea): un titulo/competencia
  // multilinea colapsa a una sola linea; solo normalizeParagraph
  // preserva estructura de parrafos.
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function normalizeParagraph(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(HORIZONTAL_WHITESPACE_RUN, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeSingleLine(item))
    .filter((item) => item.length > 0);
}
