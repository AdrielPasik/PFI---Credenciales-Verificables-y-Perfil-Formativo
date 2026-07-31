const HOLDER_LABEL_FALLBACK = 'Titular sin datos de presentacion';

export function buildHolderDisplayLabel(
  displayName: string | null,
  firstName: string | null,
  lastName: string | null,
  email: string | null
): string {
  const normalizedDisplayName = normalizeLabelPart(displayName);

  if (normalizedDisplayName) {
    return normalizedDisplayName;
  }

  const normalizedFirstName = normalizeLabelPart(firstName);
  const normalizedLastName = normalizeLabelPart(lastName);

  if (normalizedFirstName && normalizedLastName) {
    return `${normalizedFirstName} ${normalizedLastName}`;
  }

  return (
    normalizedFirstName ??
    normalizedLastName ??
    normalizeLabelPart(email) ??
    HOLDER_LABEL_FALLBACK
  );
}

function normalizeLabelPart(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
