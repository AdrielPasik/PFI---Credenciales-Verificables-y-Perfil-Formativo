import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import type { AnalysisOperation } from '@/models/analysis-runs';

export function mapAnalysisRunError(
  error: unknown,
  operation: AnalysisOperation
) {
  if (
    error instanceof IncompatiblePayloadError ||
    (error instanceof ApiError && error.kind === 'invalid-response')
  ) {
    return 'El servicio devolvió un resultado de análisis incompatible.';
  }

  if (!(error instanceof ApiError)) {
    return 'No pudimos completar la operación de análisis. Intentá nuevamente.';
  }

  if (error.status === 401) {
    return 'Tu sesión venció. Volvé a iniciar sesión.';
  }

  if (error.kind === 'network') {
    return operation === 'document-analysis-trigger'
      ? 'No pudimos confirmar el resultado. Consultá el último análisis antes de volver a intentarlo.'
      : 'No pudimos conectarnos para consultar el análisis. Podés volver a intentar sin perder los datos de la credencial.';
  }

  if (error.status === 403) {
    return operation === 'document-analysis-trigger'
      ? 'No tenés permisos para iniciar análisis en esta institución.'
      : 'No tenés permisos para consultar análisis en esta institución.';
  }

  if (error.status === 404) {
    return operation === 'document-analysis-trigger'
      ? 'No encontramos la credencial dentro del contexto institucional activo.'
      : 'No encontramos la credencial o el análisis dentro del contexto institucional activo.';
  }

  if (operation === 'document-analysis-trigger') {
    if (error.status === 400) {
      return 'No se pudo iniciar el análisis. Verificá que exista una evidencia PDF vigente.';
    }
    if (error.status === 409) {
      return 'Solo una credencial en borrador puede analizarse nuevamente.';
    }
    if (error.status === 502) {
      return 'El servicio de análisis devolvió una respuesta no válida.';
    }
    if (error.status === 503) {
      return 'El servicio de análisis no está disponible temporalmente.';
    }
    if (error.status === 504) {
      return 'El análisis excedió el tiempo disponible.';
    }
  }

  if (error.status !== null && error.status >= 500) {
    return 'No pudimos consultar el estado del análisis. El resto de la credencial sigue disponible.';
  }

  return 'No pudimos completar la operación de análisis. Intentá nuevamente.';
}

