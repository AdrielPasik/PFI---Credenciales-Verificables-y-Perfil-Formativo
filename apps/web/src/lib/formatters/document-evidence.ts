const byteFormatter = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 0
});
const scaledSizeFormatter = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 1
});
const uploadedAtFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires'
});

export function formatDocumentSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${byteFormatter.format(sizeBytes)} bytes`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${scaledSizeFormatter.format(sizeBytes / 1024)} KB`;
  }

  return `${scaledSizeFormatter.format(sizeBytes / (1024 * 1024))} MB`;
}

export function formatDocumentUploadedAt(uploadedAt: string) {
  return uploadedAtFormatter.format(new Date(uploadedAt));
}

export function abbreviateDocumentHash(sha256: string) {
  return `${sha256.slice(0, 12)}…${sha256.slice(-8)}`;
}
