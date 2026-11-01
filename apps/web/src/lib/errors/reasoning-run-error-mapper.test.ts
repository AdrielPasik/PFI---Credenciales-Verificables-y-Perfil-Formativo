import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';
import { mapReasoningRunActionError } from '@/lib/errors/reasoning-run-error-mapper';

describe('reasoning run action error mapper', () => {
  it('P0: un objetivo de mas de 15 requisitos pide una nueva version, sin reintento', () => {
    const result = mapReasoningRunActionError(
      new ApiError('private upstream detail', 'http', 422)
    );
    expect(result.message).toContain('mas de 15 requisitos');
    expect(result.message).toContain('nueva version');
    expect(result.message).not.toContain('private upstream detail');
    expect(result.retryable).toBe(false);
  });

  it('el 409 y el 503 conservan su copy', () => {
    expect(mapReasoningRunActionError(new ApiError('x', 'http', 409)).retryable).toBe(false);
    expect(mapReasoningRunActionError(new ApiError('x', 'http', 503)).retryable).toBe(true);
  });
});
