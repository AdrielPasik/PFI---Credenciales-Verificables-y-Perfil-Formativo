import { InternalServerErrorException } from '@nestjs/common';

export interface DidConfig {
  // host tal como debe aparecer dentro del identificador especifico de
  // metodo de un did:web: hostname en minusculas, con el puerto (si lo
  // hay) codificado como %3A segun la especificacion did:web.
  readonly host: string;
}

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// A2.1: unica funcion que lee PUBLIC_DID_BASE_URL -- ni AuthService ni
// CredentialsService ni el resolver DID leen process.env directamente.
// Semantica exacta (ver seccion "SEMANTICA EXACTA DE PUBLIC_DID_BASE_URL"
// del diseno aprobado):
//   - ausente/vacio  -> null (provisioning deshabilitado, NUNCA fake DID);
//   - presente/valido -> DidConfig;
//   - presente/invalido -> excepcion clara (NUNCA tratado como ausente).
// A diferencia de WEB_ORIGIN (resolveWebCorsOptions en web-cors.ts), esta
// variable exige HTTPS siempre, incluso en desarrollo local -- un
// did:web con host localhost/IP nunca debe presentarse como una
// identidad publica real (ver seccion "LOCAL DEVELOPMENT" del diseno).
export function resolveDidConfig(): DidConfig | null {
  const raw = process.env.PUBLIC_DID_BASE_URL;
  const trimmed = raw?.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InternalServerErrorException(
      'PUBLIC_DID_BASE_URL debe ser una URL HTTPS valida (https://host[:puerto]).'
    );
  }

  const hasUnsupportedUrlParts =
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0;

  if (parsed.protocol !== 'https:' || hasUnsupportedUrlParts) {
    throw new InternalServerErrorException(
      'PUBLIC_DID_BASE_URL debe ser un origen HTTPS (https://host[:puerto]) sin usuario, password, path, query ni fragment.'
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    !hostname ||
    hostname === 'localhost' ||
    IPV4_PATTERN.test(hostname) ||
    hostname.startsWith('[')
  ) {
    throw new InternalServerErrorException(
      'PUBLIC_DID_BASE_URL debe usar un hostname publico real -- no localhost ni una direccion IP.'
    );
  }

  const host = parsed.port ? `${hostname}%3A${parsed.port}` : hostname;

  return { host };
}
