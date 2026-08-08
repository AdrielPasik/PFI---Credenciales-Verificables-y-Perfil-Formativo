const knownLabels: Record<string, string> = {
  partial_evidence: 'Información parcial',
  low_coverage: 'Cobertura limitada',
  qualitative_only: 'Resultado principalmente cualitativo'
};

export function formatHolderQualityFlag(value: string) {
  const normalized = value.trim().toLowerCase();
  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
