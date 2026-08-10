/**
 * C2b.3: construye el texto formativo analizable de un `course` sin PDF
 * desde datos DECLARADOS por el emisor. Funcion pura, sin I/O.
 *
 * Solo usa: achievementName/title, description, competencies,
 * learningOutcomes. Nunca platformName, providerName, modality,
 * externalUrl, issuer, holder, credential id, blockchain o metadata --
 * esos van (algunos) como metadata separada hacia el AI Service
 * (ver AiServiceClient.analyzeText) o no se analizan en absoluto
 * (externalUrl nunca se lee como texto).
 *
 * No traduce, no expande skills, no inventa contenido: si no hay
 * suficiente senal formativa declarada, devuelve null y el caller debe
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
