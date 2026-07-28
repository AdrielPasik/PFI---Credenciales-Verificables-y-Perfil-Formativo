export interface WebCorsOptions {
  origin: string;
  methods: string[];
  allowedHeaders: string[];
  credentials: false;
}

const ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
];

const ALLOWED_HEADERS = ['Authorization', 'Content-Type'];

export function resolveWebCorsOptions(
  configuredOrigin: string | undefined
): WebCorsOptions | null {
  const candidate = configuredOrigin?.trim();

  if (!candidate) {
    return null;
  }

  let parsedOrigin: URL;

  try {
    parsedOrigin = new URL(candidate);
  } catch {
    throw new Error('WEB_ORIGIN debe contener un origen HTTP o HTTPS valido.');
  }

  const hasUnsupportedUrlParts =
    parsedOrigin.username.length > 0 ||
    parsedOrigin.password.length > 0 ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search.length > 0 ||
    parsedOrigin.hash.length > 0;

  if (
    (parsedOrigin.protocol !== 'http:' &&
      parsedOrigin.protocol !== 'https:') ||
    parsedOrigin.origin === 'null' ||
    hasUnsupportedUrlParts
  ) {
    throw new Error('WEB_ORIGIN debe contener un origen HTTP o HTTPS valido.');
  }

  return {
    origin: parsedOrigin.origin,
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_HEADERS],
    credentials: false
  };
}
