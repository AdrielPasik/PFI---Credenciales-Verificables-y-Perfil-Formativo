export const TEXT_EVIDENCE_CONTENT_MAX_CODE_POINTS = 50_000;
export const TEXT_EVIDENCE_LABEL_MAX_CODE_POINTS = 120;

const invalidContentControlPattern =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const invalidLabelControlPattern =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
const unicodeSpaceSeparatorPattern =
  /[\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/gu;

export interface TextEvidenceDraftValidation {
  valid: boolean;
  normalizedSubmission: {
    content: string;
    label: string | null;
  };
  characterCount: number;
  contentError: string | null;
  labelError: string | null;
}

export function normalizeTextEvidenceContentForSubmission(raw: string) {
  return raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function normalizeTextEvidenceLabelForSubmission(
  raw: string | null | undefined
) {
  if (raw === null || raw === undefined) {
    return null;
  }

  const normalized = raw
    .normalize('NFC')
    .trim()
    .replace(unicodeSpaceSeparatorPattern, ' ');

  return normalized.length === 0 ? null : normalized;
}

export function countTextEvidenceCharacters(content: string) {
  return Array.from(content).length;
}

export function validateTextEvidenceDraft(
  rawContent: string,
  rawLabel: string | null | undefined
): TextEvidenceDraftValidation {
  const contentBeforeTrim = rawContent
    .normalize('NFC')
    .replace(/\r\n?/g, '\n');
  const labelBeforeTrim = rawLabel?.normalize('NFC') ?? null;
  const content = normalizeTextEvidenceContentForSubmission(rawContent);
  const label = normalizeTextEvidenceLabelForSubmission(rawLabel);
  const characterCount = countTextEvidenceCharacters(content);
  let contentError: string | null = null;
  let labelError: string | null = null;

  if (invalidContentControlPattern.test(contentBeforeTrim)) {
    contentError = 'El contenido incluye caracteres de control no permitidos.';
  } else if (content.length === 0) {
    contentError = 'Ingresá el contenido institucional de respaldo.';
  } else if (characterCount > TEXT_EVIDENCE_CONTENT_MAX_CODE_POINTS) {
    contentError = 'El contenido supera el máximo de 50.000 caracteres.';
  }

  if (labelBeforeTrim !== null) {
    if (invalidLabelControlPattern.test(labelBeforeTrim)) {
      labelError = 'El nombre de la fuente debe ocupar una sola línea.';
    } else if (
      label !== null &&
      countTextEvidenceCharacters(label) >
      TEXT_EVIDENCE_LABEL_MAX_CODE_POINTS
    ) {
      labelError = 'El nombre de la fuente supera los 120 caracteres.';
    }
  }

  return {
    valid: contentError === null && labelError === null,
    normalizedSubmission: { content, label },
    characterCount,
    contentError,
    labelError
  };
}

export interface TextEvidencePreview {
  collapsed: boolean;
  text: string;
}

export function buildTextEvidencePreview(
  content: string,
  maxCodePoints = 1_000,
  maxLines = 12
): TextEvidencePreview {
  const codePoints = Array.from(content);
  const lines = content.split('\n');
  const collapsed =
    codePoints.length > maxCodePoints || lines.length > maxLines;

  if (!collapsed) {
    return { collapsed: false, text: content };
  }

  const codePointLimited = codePoints.slice(0, maxCodePoints).join('');
  const lineLimited = codePointLimited.split('\n').slice(0, maxLines).join('\n');

  return { collapsed: true, text: lineLimited.trimEnd() };
}
