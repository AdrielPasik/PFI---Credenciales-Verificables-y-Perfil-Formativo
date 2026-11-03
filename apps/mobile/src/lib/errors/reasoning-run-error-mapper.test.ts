import { ApiError } from '@/lib/errors/api-error';
import { mapReasoningRunActionError } from '@/lib/errors/reasoning-run-error-mapper';

describe('mapReasoningRunActionError', () => {
  it('un 422 (OBJECTIVE_EXCEEDS_REQUIREMENT_LIMIT) explica el tope de 15 como en Web', () => {
    expect(mapReasoningRunActionError(new ApiError('detalle', 'http', 422))).toEqual({
      message:
        'Este objetivo tiene más de 15 requisitos. Creá una nueva versión con los 15 más relevantes para analizarlo.',
      retryable: false
    });
  });
});
