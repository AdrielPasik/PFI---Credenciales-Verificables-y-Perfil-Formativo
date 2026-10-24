const integrityDateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function abbreviateIntegrityReference(value: string) {
  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function formatIntegrityDate(value: string) {
  return integrityDateFormatter.format(new Date(value));
}

export function formatBlockchainNetwork(network: string) {
  const normalized = network.trim().toLowerCase().replaceAll('_', '-');

  if (normalized === 'anvil' || normalized === 'mock') {
    return 'Entorno técnico/demo';
  }

  if (normalized.includes('sepolia') || normalized.includes('testnet')) {
    return 'Testnet';
  }

  return 'Red técnica';
}

export function formatBlockchainEvidenceStatus(status: string) {
  const normalized = status.trim().toLowerCase();

  if (normalized === 'registered') {
    return 'Registrada';
  }

  if (normalized === 'revoked') {
    return 'Revocada';
  }

  // El registro existe en la base y todavia no se observo su confirmacion en la
  // red. No es "registrada" ni "invalida": es un estado intermedio legitimo.
  if (normalized === 'pending') {
    return 'Pendiente de confirmación';
  }

  return 'Estado técnico';
}
