import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCourseTextAnalysisContent } from './course-text-analysis-content';

test('builds content from achievementName/title and description', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: 'The Complete Python Bootcamp From Zero to Hero in Python',
    description:
      'Learn Python like a Professional. Start from the basics and go all the way to creating your own applications and games.'
  });

  assert.ok(content);
  assert.match(content as string, /^Nombre del curso:\n/);
  assert.match(
    content as string,
    /The Complete Python Bootcamp From Zero to Hero in Python/
  );
  assert.match(content as string, /Descripcion:\n/);
  assert.match(content as string, /Learn Python like a Professional/);
});

test('adds competencies and learningOutcomes as bullet lists', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: 'Python Bootcamp',
    description: 'Curso introductorio de programacion con Python.',
    competencies: ['Python', 'Programacion orientada a objetos'],
    learningOutcomes: ['Crear aplicaciones simples', 'Resolver problemas basicos']
  });

  assert.ok(content);
  assert.match(
    content as string,
    /Competencias declaradas:\n- Python\n- Programacion orientada a objetos/
  );
  assert.match(
    content as string,
    /Resultados de aprendizaje declarados:\n- Crear aplicaciones simples\n- Resolver problemas basicos/
  );
});

test('never includes platformName, modality or externalUrl (not accepted as input)', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: 'Python Bootcamp',
    description: 'Curso introductorio de programacion con Python en linea.'
  } as never);

  assert.ok(content);
  const serialized = content as string;
  assert.equal(serialized.includes('platformName'), false);
  assert.equal(serialized.includes('modality'), false);
  assert.equal(serialized.includes('externalUrl'), false);
  assert.equal(serialized.includes('Online'), false);
  assert.equal(serialized.includes('http'), false);
});

test('ignores non-string/non-array pollution instead of throwing', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: 123 as never,
    description: { evil: true } as never,
    competencies: 'not-an-array' as never,
    learningOutcomes: null as never
  });

  assert.equal(content, null);
});

test('normalizes messy whitespace, tabs and repeated blank lines stably', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: '  The   Complete\tPython  Bootcamp  ',
    description: 'Line one.\n\n\n\nLine   two   with\ttabs.'
  });

  assert.equal(
    content,
    'Nombre del curso:\nThe Complete Python Bootcamp\n\n' +
      'Descripcion:\nLine one.\n\nLine two with tabs.'
  );

  // Idempotent: re-running on the already-normalized output changes nothing
  // relevant to the analyzable text (stability check).
  const again = buildCourseTextAnalysisContent({
    achievementName: 'The Complete Python Bootcamp',
    description: 'Line one.\n\nLine two with tabs.'
  });
  assert.equal(again, content);
});

test('returns null when there is no achievementName/title and no description', () => {
  assert.equal(
    buildCourseTextAnalysisContent({
      competencies: ['Python'],
      learningOutcomes: ['Crear aplicaciones']
    }),
    null
  );
  assert.equal(buildCourseTextAnalysisContent({}), null);
});

test('returns null for a generic title alone, even if individually longer than the minimum', () => {
  for (const achievementName of [
    'Curso',
    'Python',
    'Capacitacion online',
    'The Complete Python Bootcamp From Zero to Hero in Python'
  ]) {
    assert.equal(
      buildCourseTextAnalysisContent({ achievementName }),
      null,
      `expected null for title-only "${achievementName}"`
    );
  }
});

test('accepts a strong description alone, even without a title', () => {
  const content = buildCourseTextAnalysisContent({
    description:
      'Curso completo de introduccion a Python: variables, estructuras de control, funciones y proyectos practicos.'
  });
  assert.ok(content);
  assert.match(content as string, /^Descripcion:\n/);
});

test('accepts title plus a single competency or learning outcome as two combined sources', () => {
  const withCompetency = buildCourseTextAnalysisContent({
    achievementName: 'Python Bootcamp',
    competencies: ['Programacion en Python']
  });
  assert.ok(withCompetency);

  const withOutcome = buildCourseTextAnalysisContent({
    achievementName: 'Python Bootcamp',
    learningOutcomes: ['Desarrollar aplicaciones simples en Python']
  });
  assert.ok(withOutcome);
});

test('returns null for a weak description alone, below the minimum signal threshold', () => {
  // A single short description with no other formative source is neither
  // "strong on its own" (< COURSE_TEXT_ANALYSIS_MIN_CONTENT_LENGTH raw
  // characters) nor combined with a second source -- must not analyze.
  const content = buildCourseTextAnalysisContent({
    description: 'Curso corto.'
  });
  assert.equal(content, null);
});
