const FALLBACK_VALUE = 'No disponible';
const esArNumberFormatter = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 2
});

export function formatDisplayValue(
  value: string | number | null | undefined
): string {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? esArNumberFormatter.format(value)
      : FALLBACK_VALUE;
  }

  if (typeof value !== 'string') {
    return FALLBACK_VALUE;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || FALLBACK_VALUE;
}
