/**
 * Formateadores de presentación.
 *
 * Centralizados a propósito: ninguna pantalla parsea fechas ni arma etiquetas
 * por su cuenta (sección 97 del encargo). El locale de producto es es-AR.
 *
 * Estos formateadores NO cambian valores del backend: sólo los presentan.
 */

const LOCALE = 'es-AR';

/**
 * Formatea una fecha ISO. Cuando el valor es sólo fecha (`YYYY-MM-DD`) se
 * formatea sin convertir zona horaria: interpretarla como UTC y mostrarla en
 * horario local corre el día hacia atrás en Argentina (UTC-3).
 */
export function formatDate(isoValue: string): string {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoValue.trim());

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const localDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day)
    );
    return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(
      localDate
    );
  }

  const parsed = new Date(isoValue);

  if (Number.isNaN(parsed.valueOf())) {
    return isoValue;
  }

  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(
    parsed
  );
}

/** Números de producto (horas, conteos) con separadores es-AR. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: 2
  }).format(value);
}

export function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

/**
 * Abrevia una referencia técnica larga (hash canónico, digest, txHash) para
 * usarla como etiqueta compacta. El valor completo se conserva aparte: la
 * abreviatura es presentación, nunca el dato.
 */
export function abbreviateTechnicalReference(value: string): string {
  const normalized = value.trim();

  if (normalized.length <= 18) return normalized;

  return `${normalized.slice(0, 10)}...${normalized.slice(-6)}`;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% de confianza`;
}

export function pluralCredential(count: number): string {
  return count === 1 ? 'credencial' : 'credenciales';
}

const NETWORK_LABELS: Record<string, string> = {
  anvil: 'Red de desarrollo',
  localhost: 'Red de desarrollo',
  hardhat: 'Red de desarrollo',
  sepolia: 'Red de prueba Sepolia',
  amoy: 'Red de prueba Amoy',
  mumbai: 'Red de prueba Mumbai',
  polygon: 'Red Polygon',
  mainnet: 'Red principal Ethereum'
};

export function formatBlockchainNetwork(value: string): string {
  return NETWORK_LABELS[value.trim().toLowerCase()] ?? value.trim();
}

const BLOCKCHAIN_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Registro confirmado',
  pending: 'Registro pendiente',
  failed: 'Registro fallido',
  revoked: 'Registro revocado'
};

export function formatBlockchainEvidenceStatus(value: string): string {
  return (
    BLOCKCHAIN_STATUS_LABELS[value.trim().toLowerCase()] ??
    'Estado de registro no disponible'
  );
}

const QUALITY_FLAG_LABELS: Record<string, string> = {
  low_confidence: 'confianza limitada del análisis',
  low_evidence: 'evidencia limitada',
  limited_evidence: 'evidencia limitada',
  partial_coverage: 'cobertura parcial',
  missing_hours: 'horas no informadas',
  no_semantic_analysis: 'sin análisis semántico disponible',
  short_text: 'texto de respaldo breve',
  truncated_input: 'contenido de respaldo recortado',
  unverified_source: 'fuente sin verificación adicional'
};

/**
 * Humaniza un quality flag técnico. Si el backend agrega uno nuevo que acá no
 * está mapeado, se muestra el identificador legible en vez de ocultarlo: es
 * información epistemológicamente relevante y perderla sería peor.
 */
export function formatQualityFlag(value: string): string {
  const normalized = value.trim().toLowerCase();
  return (
    QUALITY_FLAG_LABELS[normalized] ?? normalized.replace(/[_-]+/g, ' ')
  );
}
