import { HttpClient } from '@/lib/api/http-client';
import { ApiError } from '@/lib/errors/api-error';
import {
  createFailingFetch,
  createTestHttpClient
} from '@/test/http';

describe('HttpClient', () => {
  it('compone la URL a partir de la base configurada', async () => {
    const { client, calls } = createTestHttpClient({ body: { ok: true } });

    await client.request('/me/credentials');

    expect(calls[0]?.url).toBe('https://api.scope.test/me/credentials');
    expect(calls[0]?.method).toBe('GET');
  });

  it('aplica el token como Bearer y nunca lo agrega si no hay token', async () => {
    const withToken = createTestHttpClient({ body: {} });
    await withToken.client.request('/me/profile/current', { token: 'jwt-1' });
    expect(withToken.calls[0]?.headers.Authorization).toBe('Bearer jwt-1');

    const withoutToken = createTestHttpClient({ body: {} });
    await withoutToken.client.request('/auth/login', { method: 'POST', body: {} });
    expect(withoutToken.calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('serializa el cuerpo como JSON y declara Content-Type', async () => {
    const { client, calls } = createTestHttpClient({ body: {} });

    await client.request('/auth/login', {
      method: 'POST',
      body: { email: 'a@b.com', password: 'secreto' }
    });

    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.body).toBe(
      JSON.stringify({ email: 'a@b.com', password: 'secreto' })
    );
  });

  it('devuelve null cuando la respuesta no tiene cuerpo', async () => {
    const { client } = createTestHttpClient({ status: 204, rawBody: '' });
    await expect(client.request('/me/profile/rebuild', { method: 'POST' })).resolves
      .toBeNull();
  });

  it.each([401, 403, 404, 500])(
    'clasifica el status %s como error http conservando el codigo',
    async (status) => {
      const { client } = createTestHttpClient({ status, body: { message: 'x' } });

      await expect(client.request('/me/credentials')).rejects.toMatchObject({
        name: 'ApiError',
        kind: 'http',
        status
      });
    }
  );

  it('nunca propaga el cuerpo del error del servidor', async () => {
    const { client } = createTestHttpClient({
      status: 500,
      body: { message: 'Error interno: password=hunter2 at line 42' }
    });

    await expect(client.request('/me/credentials')).rejects.toThrow(
      'El servicio rechazó la operación.'
    );
  });

  it('trata una respuesta 200 no-JSON como invalid-response', async () => {
    const { client } = createTestHttpClient({
      status: 200,
      rawBody: '<html>gateway</html>'
    });

    await expect(client.request('/me/credentials')).rejects.toMatchObject({
      kind: 'invalid-response'
    });
  });

  it('un error 500 con cuerpo no-JSON sigue siendo un error http', async () => {
    const { client } = createTestHttpClient({
      status: 502,
      rawBody: '<html>bad gateway</html>'
    });

    await expect(client.request('/me/credentials')).rejects.toMatchObject({
      kind: 'http',
      status: 502
    });
  });

  it('clasifica el rechazo de fetch como error de red', async () => {
    const client = new HttpClient('https://api.scope.test', createFailingFetch());

    await expect(client.request('/me/credentials')).rejects.toMatchObject({
      kind: 'network'
    });
  });

  it('aborta por timeout y lo distingue de un error de red', async () => {
    jest.useFakeTimers();

    const client = new HttpClient('https://api.scope.test', ((
      _input: RequestInfo | URL,
      init?: RequestInit
    ) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        );
      })) as unknown as typeof fetch);

    const pending = client.request('/me/credentials', { timeoutMs: 100 });
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });

    jest.advanceTimersByTime(200);
    await assertion;

    jest.useRealTimers();
  });

  it('propaga un ApiError, no un error genérico', async () => {
    const { client } = createTestHttpClient({ status: 404 });

    await expect(client.request('/me/credentials/x')).rejects.toBeInstanceOf(
      ApiError
    );
  });
});
