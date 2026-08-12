import { describe, expect, it } from 'vitest';

import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import { mapCredentialError } from '@/lib/errors/credential-error-mapper';

describe('mapCredentialError', () => {
  it('uses a uniform safe holder not-found message', () => {
    const result = mapCredentialError(
      new ApiError('upstream contained PII', 'http', 404),
      'holder-resolution'
    );

    expect(result).toEqual({
      code: 'not_found',
      message:
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
    });
    expect(result.message).not.toContain('upstream');
  });

  it.each([
    [400, 'invalid_input'],
    [401, 'session_expired'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'service_unavailable'],
    [503, 'service_unavailable']
  ])('maps HTTP %i to %s', (status, code) => {
    expect(
      mapCredentialError(
        new ApiError('upstream detail', 'http', status),
        'draft-create'
      ).code
    ).toBe(code);
  });

  it('maps network and incompatible payloads without exposing details', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'detail'
      ).code
    ).toBe('network');
    expect(
      mapCredentialError(
        new IncompatiblePayloadError('private payload detail'),
        'detail'
      ).code
    ).toBe('incompatible_response');
  });

  it('maps draft update conflicts without exposing the upstream detail', () => {
    const result = mapCredentialError(
      new ApiError('private concurrency detail', 'http', 409),
      'draft-update'
    );

    expect(result).toEqual({
      code: 'conflict',
      message: 'Este borrador fue actualizado desde otra sesión.'
    });
    expect(result.message).not.toContain('private');
  });

  it.each([
    [400, 'No pudimos procesar el archivo. Revisalo e intentá nuevamente.'],
    [403, 'No tenés permisos para adjuntar evidencia en esta institución.'],
    [404, 'No encontramos la credencial dentro del contexto institucional activo.'],
    [409, 'La evidencia solo puede modificarse mientras la credencial está en borrador.'],
    [413, 'El archivo supera el máximo permitido de 20 MB.'],
    [415, 'El formato no es compatible. Usá PDF, PNG o JPEG.']
  ])('maps document upload HTTP %i safely', (status, message) => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', status),
      'document-evidence-upload'
    );

    expect(result.message).toBe(message);
    expect(result.message).not.toContain('private');
  });

  it('preserves the selected-file recovery instruction on network failure', () => {
    expect(
      mapCredentialError(
        new ApiError('private network detail', 'network'),
        'document-evidence-upload'
      )
    ).toEqual({
      code: 'network',
      message:
        'No pudimos conectarnos con el servicio. Conservamos el archivo seleccionado para que puedas reintentar.'
    });
  });

  it.each([
    [400, 'Revisá el texto ingresado e intentá nuevamente.'],
    [403, 'No tenés permisos para registrar evidencia textual en esta institución.'],
    [404, 'No encontramos la credencial dentro del contexto institucional activo.'],
    [409, 'La evidencia textual solo puede modificarse mientras la credencial está en borrador.'],
    [503, 'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.']
  ])('maps text evidence HTTP %i safely', (status, message) => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', status),
      'text-evidence-submit'
    );

    expect(result.message).toBe(message);
    expect(result.message).not.toContain('private');
  });

  it('preserves text recovery instructions after a network failure', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'text-evidence-submit'
      )
    ).toEqual({
      code: 'network',
      message:
        'No pudimos conectarnos con el servicio. Conservamos el texto para que puedas reintentar.'
    });
  });

  it.each([
    [400, 'invalid_input'],
    [401, 'session_expired'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [502, 'service_unavailable'],
    [503, 'service_unavailable'],
    [504, 'service_unavailable']
  ])('maps issuance HTTP %i safely to %s', (status, code) => {
    const result = mapCredentialError(
      new ApiError('private signer and RPC detail', 'http', status),
      'issue'
    );

    expect(result.code).toBe(code);
    expect(result.message).not.toMatch(/private|signer|RPC/i);
  });

  it('maps uncertain issuance network errors to a refresh instruction', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'issue'
      )
    ).toEqual({
      code: 'network',
      message:
        'No pudimos confirmar el resultado de la emisión. Actualizá el detalle antes de volver a intentarlo.'
    });
  });

  it.each([
    [400, 'invalid_input', 'No pudimos guardar este contenido como reutilizable. Revisá los datos e intentá nuevamente.'],
    [403, 'forbidden', 'No tenés permisos para guardar contenido reutilizable en esta institución.'],
    [404, 'not_found', 'No encontramos la credencial dentro del contexto institucional activo.'],
    [409, 'conflict', 'Este contenido ya fue guardado como reutilizable.'],
    [503, 'service_unavailable', 'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.']
  ])('maps save-reusable-template HTTP %i safely to %s', (status, code, message) => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', status),
      'save-reusable-template'
    );

    expect(result).toEqual({ code, message });
    expect(result.message).not.toContain('private');
  });

  it('maps save-reusable-template network failures without exposing transport detail', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'save-reusable-template'
      ).code
    ).toBe('network');
  });

  it('maps template-search HTTP 400 to a safe message without exposing backend detail', () => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', 400),
      'template-search'
    );

    expect(result).toEqual({
      code: 'invalid_input',
      message: 'No pudimos buscar contenido reutilizable. Intentá nuevamente.'
    });
    expect(result.message).not.toContain('private');
  });

  it('maps template-search network and 403 failures using the generic safe fallbacks', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'template-search'
      ).code
    ).toBe('network');
    expect(
      mapCredentialError(
        new ApiError('private backend detail', 'http', 403),
        'template-search'
      ).code
    ).toBe('forbidden');
  });

  // C4a.2
  it.each([
    [400, 'invalid_input', 'Esta interpretación semántica no se puede aprobar para este contenido reutilizable.'],
    [403, 'forbidden', 'No tenés permisos para revisar o aprobar interpretaciones semánticas en esta institución.'],
    [404, 'not_found', 'No encontramos la interpretación semántica o el contenido reutilizable solicitados.'],
    [409, 'conflict', 'El estado de este contenido reutilizable cambió. Actualizá la página e intentá nuevamente.'],
    [503, 'service_unavailable', 'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.']
  ])('maps semantic-approval-candidate HTTP %i safely to %s', (status, code, message) => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', status),
      'semantic-approval-candidate'
    );

    expect(result).toEqual({ code, message });
    expect(result.message).not.toContain('private');
  });

  it.each([
    [400, 'invalid_input', 'Esta interpretación semántica no se puede aprobar para este contenido reutilizable.'],
    [403, 'forbidden', 'No tenés permisos para revisar o aprobar interpretaciones semánticas en esta institución.'],
    [404, 'not_found', 'No encontramos la interpretación semántica o el contenido reutilizable solicitados.'],
    [409, 'conflict', 'El estado de este contenido reutilizable cambió. Actualizá la página e intentá nuevamente.'],
    [503, 'service_unavailable', 'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.']
  ])('maps approve-reusable-template-analysis HTTP %i safely to %s', (status, code, message) => {
    const result = mapCredentialError(
      new ApiError('private backend detail', 'http', status),
      'approve-reusable-template-analysis'
    );

    expect(result).toEqual({ code, message });
    expect(result.message).not.toContain('private');
  });

  it('maps semantic approval network failures without exposing transport detail', () => {
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'semantic-approval-candidate'
      ).code
    ).toBe('network');
    expect(
      mapCredentialError(
        new ApiError('private transport detail', 'network'),
        'approve-reusable-template-analysis'
      ).code
    ).toBe('network');
  });
});
