import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';

import { type NormalizedTextEvidenceInput } from './text-evidence.types';

export const MAX_TEXT_EVIDENCE_CHARACTERS = 50_000;
export const MAX_TEXT_EVIDENCE_LABEL_CHARACTERS = 120;

const ALLOWED_KEYS = new Set(['content', 'label']);
const INVALID_CONTENT_CONTROLS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/u;
const INVALID_LABEL_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

export function validateTextEvidenceBody(
  body: unknown
): NormalizedTextEvidenceInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidBody('El body debe ser un objeto JSON.');
  }

  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !ALLOWED_KEYS.has(key));

  if (unknownKey) {
    throw invalidBody('El body contiene propiedades no permitidas.');
  }

  const content = normalizeContent(record.content);
  const label = normalizeLabel(record.label);

  return {
    label,
    content,
    characterCount: Array.from(content).length,
    sha256: createHash('sha256')
      .update(Buffer.from(content, 'utf8'))
      .digest('hex')
  };
}

function normalizeContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidBody('content debe ser un string.');
  }

  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();

  if (!normalized) {
    throw invalidBody('content debe contener texto.');
  }

  if (normalized.includes('\u0000')) {
    throw invalidBody('content contiene un caracter NUL no permitido.');
  }

  if (INVALID_CONTENT_CONTROLS.test(normalized)) {
    throw invalidBody('content contiene caracteres de control no permitidos.');
  }

  if (Array.from(normalized).length > MAX_TEXT_EVIDENCE_CHARACTERS) {
    throw invalidBody(
      `content no puede superar ${MAX_TEXT_EVIDENCE_CHARACTERS} caracteres.`
    );
  }

  return normalized;
}

function normalizeLabel(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw invalidBody('label debe ser un string o null.');
  }

  const normalized = value
    .normalize('NFC')
    .trim()
    .replace(/[\p{Zs}]+/gu, ' ');

  if (!normalized) {
    return null;
  }

  if (INVALID_LABEL_CONTROLS.test(normalized)) {
    throw invalidBody('label contiene caracteres no permitidos.');
  }

  if (Array.from(normalized).length > MAX_TEXT_EVIDENCE_LABEL_CHARACTERS) {
    throw invalidBody(
      `label no puede superar ${MAX_TEXT_EVIDENCE_LABEL_CHARACTERS} caracteres.`
    );
  }

  return normalized;
}

function invalidBody(message: string): BadRequestException {
  return new BadRequestException(message);
}
