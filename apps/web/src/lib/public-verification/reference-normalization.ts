export function normalizePublicCredentialReference(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const direct = normalizeReference(raw);
  if (direct) return direct;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const fromQuery = normalizeReference(url.searchParams.get('credential') ?? '');
  if (fromQuery) return fromQuery;

  const segments = url.pathname.split('/').filter(Boolean);
  const hasSupportedPath = segments.some((segment) =>
    ['verify', 'wallet', 'credentials', 'credential'].includes(segment.toLowerCase())
  );

  return hasSupportedPath ? normalizeReference(segments.at(-1) ?? '') : null;
}

function normalizeReference(value: string): string | null {
  const normalized = value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    return null;
  }

  return /^[A-Za-z0-9_-]{1,200}$/.test(normalized) ? normalized : null;
}
