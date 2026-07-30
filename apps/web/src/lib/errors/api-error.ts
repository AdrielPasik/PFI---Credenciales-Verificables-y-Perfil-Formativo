export type ApiErrorKind = 'network' | 'http' | 'invalid-response';

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

export class IncompatiblePayloadError extends Error {
  constructor(message = 'La respuesta del servicio no es compatible.') {
    super(message);
    this.name = 'IncompatiblePayloadError';
  }
}
