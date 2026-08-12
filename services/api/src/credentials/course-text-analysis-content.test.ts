import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCertificationTextAnalysisContent,
  buildCourseTextAnalysisContent
} from './course-text-analysis-content';

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

test('includes every declared course block that can inform the automatic analysis', () => {
  const content = buildCourseTextAnalysisContent({
    achievementName: 'Gestión ágil de proyectos con Scrum y Kanban',
    description: 'Curso práctico para planificar trabajo iterativo y facilitar equipos ágiles.',
    competencies: ['Gestión de proyectos', 'Planificación de sprints'],
    learningOutcomes: ['Organizar un backlog', 'Aplicar retrospectivas de mejora continua']
  });

  assert.ok(content);
  assert.match(content, /Nombre del curso:\nGestión ágil de proyectos con Scrum y Kanban/);
  assert.match(content, /Descripción|Descripcion/);
  assert.match(content, /Competencias declaradas:\n- Gestión de proyectos\n- Planificación de sprints/);
  assert.match(content, /Resultados de aprendizaje declarados:\n- Organizar un backlog\n- Aplicar retrospectivas de mejora continua/);
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

test('includes certification context and declared skills without leaking unsupported fields', () => {
  const content = buildCertificationTextAnalysisContent({
    achievementName: 'Certificación Scrum Master',
    description: 'Evaluación de prácticas ágiles para facilitar equipos y proyectos iterativos.',
    certificationCode: 'SM-2026',
    expirationDate: '2028-12-31',
    providerName: 'Entidad formadora',
    level: 'Fundamental',
    skills: ['Scrum', 'Kanban'],
    competencies: ['Gestión de proyectos ágiles'],
    platformName: 'must-not-leak' as never,
    modality: 'must-not-leak' as never,
    approvedSemanticSnapshot: { value: 'must-not-leak' } as never,
    lastSemanticAnalysisId: 'must-not-leak' as never
  } as never);

  assert.ok(content);
  assert.match(content, /Nombre de la certificacion:\nCertificación Scrum Master/);
  assert.match(content, /Código de certificacion|Codigo de certificacion/);
  assert.match(content, /Fecha de vencimiento:\n2028-12-31/);
  assert.match(content, /Entidad o proveedor:\nEntidad formadora/);
  assert.match(content, /Nivel:\nFundamental/);
  assert.match(content, /Habilidades declaradas:\n- Scrum\n- Kanban/);
  assert.match(content, /Competencias declaradas:\n- Gestión de proyectos ágiles/);
  assert.equal(content.includes('must-not-leak'), false);
});
