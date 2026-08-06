import { describe, expect, it } from 'vitest';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { mapAnalysisRunError } from '@/lib/errors/analysis-run-error-mapper';

describe('analysis run error mapper', () => {
  it.each([
    [400, 'Verificá que exista una evidencia PDF vigente'],
    [403, 'No tenés permisos para iniciar análisis'],
    [404, 'No encontramos la credencial dentro'],
    [409, 'Solo una credencial en borrador'],
    [502, 'respuesta no válida'],
    [503, 'no está disponible temporalmente'],
    [504, 'excedió el tiempo disponible']
  ])('maps trigger HTTP %d without upstream detail', (status, message) => {
    const result = mapAnalysisRunError(
      new ApiError('private upstream detail', 'http', status),
      'document-analysis-trigger'
    );
    expect(result).toContain(message);
    expect(result).not.toContain('private upstream detail');
  });

  it('recommends latest after an uncertain network trigger result', () => {
    expect(
      mapAnalysisRunError(
        new ApiError('private', 'network'),
        'document-analysis-trigger'
      )
    ).toContain('Consultá el último análisis');
  });

  it('maps read errors independently and payload incompatibility safely', () => {
    expect(
      mapAnalysisRunError(new ApiError('private', 'http', 403), 'analysis-run-latest')
    ).toContain('consultar análisis');
    expect(
      mapAnalysisRunError(
        new IncompatiblePayloadError('private raw payload'),
        'analysis-run-by-id'
      )
    ).toBe('El servicio devolvió un resultado de análisis incompatible.');
  });
});

