import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  MAX_TEXT_EVIDENCE_CHARACTERS,
  validateTextEvidenceBody
} from './text-evidence.validator';

test('validator normalizes content to NFC and LF, trims edges and preserves internal text', () => {
  const result = validateTextEvidenceBody({
    label: '  Descripcion\u00a0  oficial  ',
    content: '  Cafe\u0301\r\nLinea dos\rLinea\t tres  '
  });

  assert.deepEqual(result, {
    label: 'Descripcion oficial',
    content: 'Caf\u00e9\nLinea dos\nLinea\t tres',
    characterCount: 26,
    sha256: result.sha256
  });
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test('validator computes a known SHA-256 over exact normalized UTF-8 bytes', () => {
  const result = validateTextEvidenceBody({
    content: '  Linea uno\r\nLinea dos  '
  });

  assert.equal(result.content, 'Linea uno\nLinea dos');
  assert.equal(result.characterCount, 19);
  assert.equal(
    result.sha256,
    '3e7b242d32c2b31ab9a8d2006a1c13b61dc3840f23b9e39dee963d98e928da2d'
  );
});

test('validator supports omitted, null and empty labels as null', () => {
  for (const body of [
    { content: 'Texto' },
    { content: 'Texto', label: null },
    { content: 'Texto', label: '   ' }
  ]) {
    assert.equal(validateTextEvidenceBody(body).label, null);
  }
});

test('validator rejects missing, invalid, empty and oversized content', () => {
  for (const body of [
    undefined,
    null,
    [],
    'text',
    {},
    { content: null },
    { content: 42 },
    { content: '' },
    { content: ' \r\n\t ' },
    { content: 'a'.repeat(MAX_TEXT_EVIDENCE_CHARACTERS + 1) }
  ]) {
    assert.throws(() => validateTextEvidenceBody(body), BadRequestException);
  }
});

test('validator rejects NUL and C0 controls except tab and line feed', () => {
  for (const content of ['texto\u0000oculto', 'texto\u0007control', 'texto\u000bcontrol']) {
    assert.throws(
      () => validateTextEvidenceBody({ content }),
      BadRequestException
    );
  }

  assert.equal(
    validateTextEvidenceBody({ content: 'linea\tuno\nlinea dos' }).content,
    'linea\tuno\nlinea dos'
  );
});

test('validator rejects invalid labels and line separators', () => {
  for (const label of [
    42,
    {},
    'a'.repeat(121),
    'linea\notra',
    'linea\rotra',
    'linea\totra',
    'linea\u2028otra',
    'control\u0007'
  ]) {
    assert.throws(
      () => validateTextEvidenceBody({ content: 'Texto', label }),
      BadRequestException
    );
  }
});

test('validator applies an exact top-level allowlist even to empty forbidden values', () => {
  for (const key of [
    'description',
    'skills',
    'competencies',
    'learningOutcomes',
    'credentialSubject',
    'metadata',
    'rawData',
    'issuerId',
    'credentialId',
    'canonicalHash'
  ]) {
    assert.throws(
      () => validateTextEvidenceBody({ content: 'Texto', [key]: [] }),
      BadRequestException
    );
  }
});

test('characterCount counts Unicode code points instead of UTF-16 units', () => {
  const result = validateTextEvidenceBody({ content: 'A\ud83e\udde0B' });

  assert.equal(result.characterCount, 3);
});
