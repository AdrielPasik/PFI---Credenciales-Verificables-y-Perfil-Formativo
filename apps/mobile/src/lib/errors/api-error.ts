/**
 * Errores de transporte y de contrato.
 *
 * Mantiene deliberadamente las mismas categorías que Scope Web
 * (`apps/web/src/lib/errors/api-error.ts`) para que las decisiones de
 * producto (qué se reintenta, qué expira la sesión, qué es "no encontrado")
 * sean las mismas en las dos superficies. No se importa desde `apps/web`.
 */
export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'invalid-response';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type IncompatiblePayloadActualCategory =
  | 'missing'
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object';

export interface IncompatiblePayloadDiagnostic {
  path: string;
  expected: string;
  actualCategory: IncompatiblePayloadActualCategory;
}

export class IncompatiblePayloadError extends Error {
  constructor(
    message = 'La respuesta del servicio no es compatible.',
    readonly diagnostic: IncompatiblePayloadDiagnostic | null = null
  ) {
    super(message);
    this.name = 'IncompatiblePayloadError';
  }
}

export function describeActualCategory(
  value: unknown
): IncompatiblePayloadActualCategory {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}
