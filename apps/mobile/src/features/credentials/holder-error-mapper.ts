import { InvalidCredentialReferenceError } from '@/lib/api/scope-api';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';

/**
 * Traducción de errores de datos del titular a estados de pantalla.
 *
 * Cada categoría real tiene su propio mensaje: red, timeout, sesión vencida,
 * sin permiso, no encontrado, servicio caído y contrato incompatible. NUNCA
 * se colapsa todo en "No encontrado" (sección 18 del encargo), y nunca se
 * muestra detalle interno del servidor.
 */

export interface HolderErrorState {
  title: string;
  description: string;
  /** `false` cuando reintentar no puede ayudar (404, 403, sesión vencida). */
  retryable: boolean;
}

export function mapHolderError(
  error: unknown,
  subject: 'profile' | 'credentials' | 'credential'
): HolderErrorState {
  if (error instanceof InvalidCredentialReferenceError) {
    return {
      title: 'No pudimos mostrar la credencial',
      description: 'La credencial solicitada no es válida.',
      retryable: false
    };
  }

  if (error instanceof IncompatiblePayloadError) {
    return {
      title: 'La información no tiene el formato esperado',
      description:
        'Scope respondió con datos que esta versión de la app no puede interpretar. Volvé a intentar en unos instantes.',
      retryable: true
    };
  }

  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return {
        title: 'Sin conexión con Scope',
        description:
          'Revisá tu conexión a internet y volvé a intentar.',
        retryable: true
      };
    }

    if (error.kind === 'timeout') {
      return {
        title: 'Scope tardó demasiado en responder',
        description: 'Volvé a intentar en unos instantes.',
        retryable: true
      };
    }

    if (error.kind === 'invalid-response') {
      return {
        title: 'Respuesta inesperada de Scope',
        description: 'Volvé a intentar en unos instantes.',
        retryable: true
      };
    }

    if (error.status === 401) {
      return {
        title: 'Tu sesión ya no está disponible',
        description: 'Volvé a iniciar sesión para continuar.',
        retryable: false
      };
    }

    if (error.status === 403) {
      return {
        title: 'No tenés acceso a esta información',
        description: 'Esta credencial no forma parte de tu espacio personal.',
        retryable: false
      };
    }

    if (error.status === 404) {
      return NOT_FOUND[subject];
    }

    if (error.status !== null && error.status >= 500) {
      return {
        title: 'Scope no está disponible en este momento',
        description: 'El servicio tuvo un problema. Volvé a intentar más tarde.',
        retryable: true
      };
    }
  }

  return {
    title: FALLBACK_TITLES[subject],
    description: 'Volvé a intentar en unos instantes.',
    retryable: true
  };
}

const NOT_FOUND: Record<
  'profile' | 'credentials' | 'credential',
  HolderErrorState
> = {
  profile: {
    title: 'No encontramos tu perfil formativo',
    description: 'Todavía no hay un perfil disponible para mostrar.',
    retryable: false
  },
  credentials: {
    title: 'No encontramos credenciales',
    description: 'No hay credenciales disponibles en tu espacio personal.',
    retryable: false
  },
  credential: {
    title: 'No pudimos mostrar la credencial',
    description: 'No encontramos esta credencial en tu espacio personal.',
    retryable: false
  }
};

const FALLBACK_TITLES: Record<
  'profile' | 'credentials' | 'credential',
  string
> = {
  profile: 'No pudimos cargar tu perfil formativo',
  credentials: 'No pudimos cargar tus credenciales',
  credential: 'No pudimos cargar la credencial'
};
