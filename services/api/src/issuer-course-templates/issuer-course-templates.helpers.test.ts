import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  normalizeTitleForComparison,
  readSubjectStringArray,
  readSubjectText,
  resolveTemplateTitleFromCredential,
  toJsonObject
} from './issuer-course-templates.helpers';

test('toJsonObject returns an empty object for non-object json values', () => {
  assert.deepEqual(toJsonObject(null), {});
  assert.deepEqual(toJsonObject('string' as never), {});
  assert.deepEqual(toJsonObject([1, 2] as never), {});
  assert.deepEqual(toJsonObject({ achievement_name: 'x' }), {
    achievement_name: 'x'
  });
});

test('readSubjectText trims and returns null for missing/blank/non-string values', () => {
  assert.equal(
    readSubjectText({ platform_name: '  Campus Virtual  ' }, 'platform_name'),
    'Campus Virtual'
  );
  assert.equal(readSubjectText({}, 'platform_name'), null);
  assert.equal(readSubjectText({ platform_name: '   ' }, 'platform_name'), null);
  assert.equal(readSubjectText({ platform_name: 42 }, 'platform_name'), null);
});

test('readSubjectStringArray dedupes case-insensitively and drops empty/non-string entries', () => {
  assert.deepEqual(
    readSubjectStringArray(
      { competencies: ['Python', 'python', '  Data  ', '', 42, null] },
      'competencies'
    ),
    ['Python', 'Data']
  );
  assert.deepEqual(readSubjectStringArray({}, 'competencies'), []);
  assert.deepEqual(
    readSubjectStringArray({ competencies: 'not-an-array' }, 'competencies'),
    []
  );
});

test('resolveTemplateTitleFromCredential prioritizes achievement_name over Credential.title', () => {
  const title = resolveTemplateTitleFromCredential(
    { achievement_name: 'Python para Data Science' },
    'Curso de Python (legacy title)'
  );

  assert.equal(title, 'Python para Data Science');
});

test('resolveTemplateTitleFromCredential falls back to Credential.title when achievement_name is absent', () => {
  const title = resolveTemplateTitleFromCredential({}, 'Curso de Python');
  assert.equal(title, 'Curso de Python');
});

test('resolveTemplateTitleFromCredential rejects when neither source has a usable title', () => {
  assert.throws(
    () => resolveTemplateTitleFromCredential({ achievement_name: '   ' }, '   '),
    BadRequestException
  );
});

test('normalizeTitleForComparison trims, collapses whitespace and lowercases', () => {
  assert.equal(
    normalizeTitleForComparison('  Python   para  Data  '),
    'python para data'
  );
  assert.equal(
    normalizeTitleForComparison('Python para Data'),
    normalizeTitleForComparison('  python   PARA   data ')
  );
});
