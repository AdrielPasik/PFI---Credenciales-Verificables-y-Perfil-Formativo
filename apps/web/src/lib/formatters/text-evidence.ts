const characterFormatter = new Intl.NumberFormat('es-AR');
const submittedAtFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires'
});

export function formatTextEvidenceCharacterCount(characterCount: number) {
  return `${characterFormatter.format(characterCount)} ${
    characterCount === 1 ? 'carácter' : 'caracteres'
  }`;
}

export function abbreviateTextEvidenceHash(sha256: string) {
  return `${sha256.slice(0, 12)}…${sha256.slice(-8)}`;
}

export function formatTextEvidenceSubmittedAt(submittedAt: string) {
  return submittedAtFormatter.format(new Date(submittedAt));
}
