import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_DEMO_ACADEMIC_COURSES,
  EXPECTED_DEMO_ACADEMIC_PROGRAMS,
  EXPECTED_DEMO_PROGRAM_COURSES,
  loadDemoAcademicCatalog,
  parseDemoAcademicCatalog
} from './demo-academic-catalog';

test('loads the complete normalized curriculum without broken references', async () => {
  const catalog = await loadDemoAcademicCatalog();
  const courseCodes = new Set(catalog.courses.map((course) => course.code));
  const programCodes = new Set(catalog.programs.map((program) => program.code));

  assert.equal(catalog.courses.length, EXPECTED_DEMO_ACADEMIC_COURSES);
  assert.equal(catalog.programs.length, EXPECTED_DEMO_ACADEMIC_PROGRAMS);
  assert.equal(catalog.programCourses.length, EXPECTED_DEMO_PROGRAM_COURSES);
  assert.equal(courseCodes.size, EXPECTED_DEMO_ACADEMIC_COURSES);
  assert.equal(programCodes.size, EXPECTED_DEMO_ACADEMIC_PROGRAMS);
  assert.ok(
    catalog.programCourses.every(
      (relation) =>
        programCodes.has(relation.programCode) &&
        courseCodes.has(relation.courseCode)
    )
  );
});

test('preserves distinct institutional codes when program names repeat', async () => {
  const catalog = await loadDemoAcademicCatalog();
  const programsByName = new Map<string, string[]>();

  for (const program of catalog.programs) {
    const codes = programsByName.get(program.name) ?? [];
    codes.push(program.code);
    programsByName.set(program.name, codes);
  }

  const repeatedNames = [...programsByName.values()].filter(
    (codes) => codes.length > 1
  );

  assert.ok(repeatedNames.length > 0);
  assert.ok(repeatedNames.every((codes) => new Set(codes).size === codes.length));
});

test('rejects duplicate and broken curriculum relations', () => {
  const courses = {
    schemaVersion: 'academic_course_catalog_v0',
    courses: Array.from({ length: EXPECTED_DEMO_ACADEMIC_COURSES }, (_, index) => ({
      code: `course-${index}`,
      name: `Course ${index}`
    }))
  };
  const programs = Array.from(
    { length: EXPECTED_DEMO_ACADEMIC_PROGRAMS },
    (_, index) => ({ code: `program-${index}`, name: `Program ${index}` })
  );
  const relations = Array.from(
    { length: EXPECTED_DEMO_PROGRAM_COURSES },
    (_, index) => ({
      programCode: `program-${index % EXPECTED_DEMO_ACADEMIC_PROGRAMS}`,
      courseCode: `course-${index % EXPECTED_DEMO_ACADEMIC_COURSES}`
    })
  );

  relations[0] = { programCode: 'missing-program', courseCode: 'course-0' };

  assert.throws(
    () =>
      parseDemoAcademicCatalog(courses, {
        schemaVersion: 'academic_curriculum_catalog_v0',
        programs,
        programCourses: relations
      }),
    /carrera inexistente/
  );
});
