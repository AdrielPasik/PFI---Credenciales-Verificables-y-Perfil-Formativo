import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';
import { CredentialType } from '@prisma/client';

import {
  CONTROLLED_ARRAY_ITEM_MAX_LENGTH,
  CONTROLLED_ARRAY_MAX_ITEMS,
  CONTROLLED_STRING_MAX_LENGTH,
  EXTERNAL_URL_MAX_LENGTH,
  validateIssuerCredentialDraftUpdate
} from './issuer-credential-draft-update.validator';

const EXPECTED_UPDATED_AT = '2026-07-30T12:05:00.000Z';

test('validator requires an object, expectedUpdatedAt and at least one editable field', () => {
  for (const payload of [null, [], 'invalid', 42, {}]) {
    assert.throws(
      () => validateIssuerCredentialDraftUpdate(payload),
      BadRequestException
    );
  }

  assert.throws(
    () =>
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT
      }),
    BadRequestException
  );
});

test('validator rejects unknown and prohibited top-level fields instead of ignoring them', () => {
  for (const field of [
    'issuerId',
    'subjectUserId',
    'holderReference',
    'academicCourseId',
    'academicCourse',
    'status',
    'sourceType',
    'credentialSubject',
    'institution_name',
    'achievement_name',
    'issuedAt',
    'revokedAt',
    'canonicalHash',
    'canonicalizationVersion',
    'metadata',
    'rawData',
    'blockchainRecords',
    'semanticAnalyses',
    'walletAddress',
    'did',
    'privateKey',
    'signer',
    'unexpected'
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          description: 'valid',
          [field]: 'forbidden'
        }),
      BadRequestException,
      field
    );
  }
});

test('validator accepts a trimmed academicCourseReference', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    academicCourseReference: ' academic-course-1 '
  });

  assert.deepEqual(result.academicCourseReference, {
    provided: true,
    value: 'academic-course-1'
  });
});

test('validator accepts curricular selection only with its academic course', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    academicCourseReference: ' academic-course-1 ',
    curriculumReference: ' curriculum-1 '
  });

  assert.deepEqual(result.curriculumReference, {
    provided: true,
    value: 'curriculum-1'
  });

  for (const payload of [
    { curriculumReference: 'curriculum-1' },
    {
      academicCourseReference: 'academic-course-1',
      curriculumReference: 'curriculum-1',
      programName: 'Manual program'
    }
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          ...payload
        }),
      BadRequestException
    );
  }

  for (const value of [null, '', '   ', 42, [], {}]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: 'academic-course-1',
          curriculumReference: value
        }),
      BadRequestException
    );
  }
});

test('validator rejects invalid references and ambiguous catalog snapshots', () => {
  for (const value of [null, '', '   ', 42, [], {}]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: value
        }),
      BadRequestException
    );
  }

  for (const field of ['achievementName', 'description', 'hours']) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: 'academic-course-1',
          [field]: field === 'hours' ? '12' : 'ambiguous'
        }),
      BadRequestException
    );
  }
});

test('validator accepts only the exact ISO timestamp emitted by the read model', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    description: 'valid'
  });

  assert.equal(result.expectedUpdatedAtIso, EXPECTED_UPDATED_AT);
  assert.equal(result.expectedUpdatedAt.toISOString(), EXPECTED_UPDATED_AT);

  for (const value of [
    'invalid',
    '2026-07-30T12:05:00Z',
    ' 2026-07-30T12:05:00.000Z',
    123,
    null
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: value,
          description: 'valid'
        }),
      BadRequestException
    );
  }
});

test('validator trims and collapses achievementName and rejects null or empty values', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    achievementName: '  Arquitectura   de\nSoftware  '
  });

  assert.deepEqual(result.achievementName, {
    provided: true,
    value: 'Arquitectura de Software'
  });

  for (const value of [
    '',
    '   ',
    null,
    123,
    'x'.repeat(CONTROLLED_STRING_MAX_LENGTH + 1)
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          achievementName: value
        }),
      BadRequestException
    );
  }
});

test('validator trims description and normalizes null or empty strings to null', () => {
  assert.deepEqual(
    validateIssuerCredentialDraftUpdate({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      description: '  Descripcion opcional  '
    }).description,
    { provided: true, value: 'Descripcion opcional' }
  );

  for (const value of [null, '', '   ']) {
    assert.deepEqual(
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        description: value
      }).description,
      { provided: true, value: null }
    );
  }

  assert.throws(
    () =>
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        description: 123
      }),
    BadRequestException
  );
});

test('validator accepts positive decimal strings within Decimal(10,2)', () => {
  for (const [value, expected] of [
    ['1', '1.00'],
    ['24', '24.00'],
    ['24.5', '24.50'],
    ['96.00', '96.00'],
    ['0001.5', '1.50'],
    ['99999999.99', '99999999.99']
  ]) {
    const result = validateIssuerCredentialDraftUpdate({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      hours: value
    });

    assert.equal(result.hours.value?.toFixed(2), expected);
  }

  assert.deepEqual(
    validateIssuerCredentialDraftUpdate({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      hours: null
    }).hours,
    { provided: true, value: null }
  );
});

test('validator rejects numeric JSON, zero, negatives, invalid decimals and excess precision', () => {
  for (const value of [
    24.5,
    0,
    '0',
    '0.00',
    '-1',
    'NaN',
    'Infinity',
    'text',
    '1e2',
    '24.555',
    '999999999',
    ''
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          hours: value
        }),
      BadRequestException
    );
  }
});

test('validator preserves omitted fields as not provided', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    description: null
  });

  assert.deepEqual(result.achievementName, { provided: false });
  assert.deepEqual(result.hours, { provided: false });
  assert.deepEqual(result.type, { provided: false });
  assert.deepEqual(result.completionDate, { provided: false });
  assert.deepEqual(result.skills, { provided: false });
});

test('validator accepts only the four supported CredentialType values', () => {
  for (const type of Object.values(CredentialType)) {
    assert.deepEqual(
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        type
      }).type,
      { provided: true, value: type }
    );
  }

  for (const type of [null, '', 'unknown', 42]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          type
        }),
      BadRequestException
    );
  }
});

test('validator normalizes controlled strings and enforces the v0 length limit', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    academicPeriod: '  2026   primer semestre  ',
    programName: '',
    grade: null,
    providerName: '  Traza   Academy  ',
    platformName: 'Campus',
    modality: ' Hibrida ',
    level: ' Avanzado ',
    certificationCode: ' CERT-001 '
  });

  assert.deepEqual(result.academicPeriod, {
    provided: true,
    value: '2026 primer semestre'
  });
  assert.deepEqual(result.programName, { provided: true, value: null });
  assert.deepEqual(result.grade, { provided: true, value: null });
  assert.deepEqual(result.providerName, {
    provided: true,
    value: 'Traza Academy'
  });

  assert.throws(
    () =>
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        programName: 'x'.repeat(CONTROLLED_STRING_MAX_LENGTH + 1)
      }),
    BadRequestException
  );

  for (const value of [42, {}, []]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          level: value
        }),
      BadRequestException
    );
  }
});

test('validator accepts real calendar dates and rejects invalid dates or timestamps', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    completionDate: ' 2024-02-29 ',
    expirationDate: ''
  });

  assert.deepEqual(result.completionDate, {
    provided: true,
    value: '2024-02-29'
  });
  assert.deepEqual(result.expirationDate, { provided: true, value: null });

  for (const value of [
    '2023-02-29',
    '2026-13-01',
    '2026-04-31',
    '2026-07-30T00:00:00Z',
    20260730,
    {}
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          completionDate: value
        }),
      BadRequestException
    );
  }
});

test('validator accepts only HTTP or HTTPS externalUrl without requesting it', () => {
  for (const value of [
    'https://example.com/certificate?id=1',
    'http://127.0.0.1/reference'
  ]) {
    assert.equal(
      validateIssuerCredentialDraftUpdate({
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        externalUrl: value
      }).externalUrl.value,
      value
    );
  }

  for (const value of [
    'ftp://example.com/file',
    'javascript:alert(1)',
    'not-a-url',
    42,
    'https://example.com/' + 'x'.repeat(EXTERNAL_URL_MAX_LENGTH)
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          externalUrl: value
        }),
      BadRequestException
    );
  }

  assert.deepEqual(
    validateIssuerCredentialDraftUpdate({
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      externalUrl: '   '
    }).externalUrl,
    { provided: true, value: null }
  );
});

test('validator normalizes, removes empty entries and deduplicates string arrays case-insensitively', () => {
  const result = validateIssuerCredentialDraftUpdate({
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    skills: [' TypeScript ', 'typescript', 'API   Design', '', '   '],
    competencies: null,
    learningOutcomes: ['Construir APIs']
  });

  assert.deepEqual(result.skills, {
    provided: true,
    value: ['TypeScript', 'API Design']
  });
  assert.deepEqual(result.competencies, { provided: true, value: [] });
  assert.deepEqual(result.learningOutcomes, {
    provided: true,
    value: ['Construir APIs']
  });

  for (const value of [
    'not-an-array',
    [1],
    [{}],
    [['nested']],
    Array.from({ length: CONTROLLED_ARRAY_MAX_ITEMS + 1 }, (_, index) =>
      String(index)
    ),
    ['x'.repeat(CONTROLLED_ARRAY_ITEM_MAX_LENGTH + 1)]
  ]) {
    assert.throws(
      () =>
        validateIssuerCredentialDraftUpdate({
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          skills: value
        }),
      BadRequestException
    );
  }
});
