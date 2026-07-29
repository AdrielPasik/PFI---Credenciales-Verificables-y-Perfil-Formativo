const API_BASE_URL_ENV_NAME = 'NEXT_PUBLIC_API_BASE_URL';

export interface ClientEnv {
  apiBaseUrl: string;
}

export function parseApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${API_BASE_URL_ENV_NAME} es requerida.`);
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalized);
  } catch {
    throw new Error(`${API_BASE_URL_ENV_NAME} debe ser una URL válida.`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `${API_BASE_URL_ENV_NAME} debe usar protocolo HTTP o HTTPS.`
    );
  }

  if (
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(
      `${API_BASE_URL_ENV_NAME} no debe incluir credenciales, query ni fragmento.`
    );
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

export function readClientEnv(): ClientEnv {
  return {
    apiBaseUrl: parseApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)
  };
}
