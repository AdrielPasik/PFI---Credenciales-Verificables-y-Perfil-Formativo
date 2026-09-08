/**
 * Configuración de entorno de la app móvil.
 *
 * Único lugar del proyecto donde se leen variables `EXPO_PUBLIC_*`. Ninguna
 * pantalla, hook ni cliente construye una URL de backend por su cuenta: si
 * mañana el API deja de estar en Render y pasa a otro proveedor, sólo cambia
 * la variable de entorno (ver sección 169 del encargo).
 *
 * `EXPO_PUBLIC_*` es configuración PÚBLICA: queda embebida en el bundle.
 * Nunca poner secretos acá.
 */

export interface AppConfig {
  /** Base URL del backend NestJS de Scope. Sin barra final. */
  apiBaseUrl: string;
  /**
   * Base URL de Scope Web. Sólo se usa para construir enlaces públicos que
   * se comparten hacia afuera (perfil público, verificación pública de una
   * credencial): el backend devuelve rutas relativas y esas vistas son
   * experiencias web, no pantallas nativas.
   */
  webBaseUrl: string;
}

export class AppConfigError extends Error {
  constructor(
    readonly variableName: string,
    readonly reason: string
  ) {
    super(`${variableName}: ${reason}`);
    this.name = 'AppConfigError';
  }
}

/**
 * Valida una base URL con el mismo criterio que Scope Web
 * (`apps/web/src/lib/env/client-env.ts`): http/https, sin credenciales,
 * sin query y sin fragmento; se normaliza sin barra final.
 */
export function parseBaseUrl(
  value: string | undefined,
  variableName: string
): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppConfigError(variableName, 'es requerida.');
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new AppConfigError(variableName, 'debe ser una URL válida.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppConfigError(
      variableName,
      'debe usar protocolo HTTP o HTTPS.'
    );
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppConfigError(
      variableName,
      'no debe incluir credenciales, query ni fragmento.'
    );
  }

  return parsed.toString().replace(/\/$/, '');
}

export interface RawEnv {
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_WEB_BASE_URL?: string;
}

export function readAppConfig(env: RawEnv): AppConfig {
  return {
    apiBaseUrl: parseBaseUrl(
      env.EXPO_PUBLIC_API_BASE_URL,
      'EXPO_PUBLIC_API_BASE_URL'
    ),
    webBaseUrl: parseBaseUrl(
      env.EXPO_PUBLIC_WEB_BASE_URL,
      'EXPO_PUBLIC_WEB_BASE_URL'
    )
  };
}

export type AppConfigResult =
  | { status: 'ready'; config: AppConfig }
  | { status: 'misconfigured'; error: AppConfigError };

/**
 * Nunca cae a un `localhost` implícito: si falta configuración, el arranque
 * muestra un estado explícito (en desarrollo con el detalle técnico; en
 * producción con un mensaje genérico) — sección 92 del encargo.
 */
export function resolveAppConfig(
  env: RawEnv = {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL
  }
): AppConfigResult {
  try {
    return { status: 'ready', config: readAppConfig(env) };
  } catch (error) {
    if (error instanceof AppConfigError) {
      return { status: 'misconfigured', error };
    }

    return {
      status: 'misconfigured',
      error: new AppConfigError('EXPO_PUBLIC_*', 'no pudo interpretarse.')
    };
  }
}
