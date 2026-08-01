import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const EXPECTED_DEMO_ACADEMIC_COURSES = 617;
export const EXPECTED_DEMO_ACADEMIC_PROGRAMS = 22;
export const EXPECTED_DEMO_PROGRAM_COURSES = 977;

export interface DemoAcademicCourse {
  code: string;
  name: string;
}

export interface DemoAcademicProgram {
  code: string;
  name: string;
}

export interface DemoProgramCourse {
  programCode: string;
  courseCode: string;
}

export interface DemoAcademicCatalog {
  courses: DemoAcademicCourse[];
  programs: DemoAcademicProgram[];
  programCourses: DemoProgramCourse[];
}

export async function loadDemoAcademicCatalog(): Promise<DemoAcademicCatalog> {
  const catalogRoot = resolve(__dirname, '../../../data/academic_catalog');
  const [coursesText, curriculumText] = await Promise.all([
    readFile(resolve(catalogRoot, 'demo-academic-courses-v0.json'), 'utf8'),
    readFile(resolve(catalogRoot, 'demo-academic-curriculum-v0.json'), 'utf8')
  ]);

  return parseDemoAcademicCatalog(
    JSON.parse(coursesText) as unknown,
    JSON.parse(curriculumText) as unknown
  );
}

export function parseDemoAcademicCatalog(
  coursesDocument: unknown,
  curriculumDocument: unknown
): DemoAcademicCatalog {
  const coursesRecord = requireObject(coursesDocument, 'catalogo de materias');
  const curriculumRecord = requireObject(
    curriculumDocument,
    'catalogo curricular'
  );

  if (
    coursesRecord.schemaVersion !== 'academic_course_catalog_v0' ||
    !Array.isArray(coursesRecord.courses)
  ) {
    throw new Error('El contrato del catalogo academico demo es invalido.');
  }

  if (
    curriculumRecord.schemaVersion !== 'academic_curriculum_catalog_v0' ||
    !Array.isArray(curriculumRecord.programs) ||
    !Array.isArray(curriculumRecord.programCourses)
  ) {
    throw new Error('El contrato del catalogo curricular demo es invalido.');
  }

  const courses = coursesRecord.courses.map((entry, index) =>
    parseCodeAndName(entry, `courses[${index}]`)
  );
  const programs = curriculumRecord.programs.map((entry, index) =>
    parseCodeAndName(entry, `programs[${index}]`)
  );
  const programCourses = curriculumRecord.programCourses.map(
    (entry, index) => {
      const relation = requireObject(entry, `programCourses[${index}]`);
      assertOnlyKeys(
        relation,
        ['programCode', 'courseCode'],
        `programCourses[${index}]`
      );

      return {
        programCode: normalizeRequiredText(
          relation.programCode,
          `programCourses[${index}].programCode`
        ),
        courseCode: normalizeRequiredText(
          relation.courseCode,
          `programCourses[${index}].courseCode`
        )
      };
    }
  );

  assertExpectedCount(
    courses,
    EXPECTED_DEMO_ACADEMIC_COURSES,
    'materias'
  );
  assertExpectedCount(
    programs,
    EXPECTED_DEMO_ACADEMIC_PROGRAMS,
    'carreras'
  );
  assertExpectedCount(
    programCourses,
    EXPECTED_DEMO_PROGRAM_COURSES,
    'relaciones carrera-materia'
  );

  const courseCodes = assertUniqueCodes(courses, 'materias');
  const programCodes = assertUniqueCodes(programs, 'carreras');
  const relationKeys = new Set<string>();

  for (const relation of programCourses) {
    if (!programCodes.has(relation.programCode)) {
      throw new Error(
        `La relacion referencia una carrera inexistente: ${relation.programCode}.`
      );
    }

    if (!courseCodes.has(relation.courseCode)) {
      throw new Error(
        `La relacion referencia una materia inexistente: ${relation.courseCode}.`
      );
    }

    const relationKey = `${relation.programCode}\u0000${relation.courseCode}`;

    if (relationKeys.has(relationKey)) {
      throw new Error('El catalogo curricular contiene relaciones duplicadas.');
    }

    relationKeys.add(relationKey);
  }

  return { courses, programs, programCourses };
}

function parseCodeAndName(value: unknown, path: string) {
  const record = requireObject(value, path);
  assertOnlyKeys(record, ['code', 'name'], path);

  return {
    code: normalizeRequiredText(record.code, `${path}.code`),
    name: normalizeRequiredText(record.name, `${path}.name`)
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} debe ser un objeto JSON.`);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: string[],
  path: string
) {
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${path} contiene campos no permitidos.`);
  }
}

function normalizeRequiredText(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`${field} debe ser string.`);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    throw new Error(`${field} no puede estar vacio.`);
  }

  return normalized;
}

function assertExpectedCount<T>(values: T[], expected: number, label: string) {
  if (values.length !== expected) {
    throw new Error(`El catalogo demo debe contener ${expected} ${label}.`);
  }
}

function assertUniqueCodes(
  values: Array<{ code: string }>,
  label: string
): Set<string> {
  const codes = new Set(values.map((value) => value.code));

  if (codes.size !== values.length) {
    throw new Error(`El catalogo demo contiene codigos duplicados de ${label}.`);
  }

  return codes;
}
