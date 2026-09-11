import { HttpClient } from '@/lib/api/http-client';
import { probeApiConnectivity } from '@/lib/api/connectivity-probe';
import { createFailingFetch, createTestHttpClient } from '@/test/http';

describe('probeApiConnectivity', () => {
  it('interpreta un 401 sin token como API accesible', async () => {
    const { client, calls } = createTestHttpClient({ status: 401 });

    await expect(probeApiConnectivity(client)).resolves.toEqual({
      status: 'reachable',
      httpStatus: 401
    });
    expect(calls[0]?.url).toBe('https://api.scope.test/auth/me');
    expect(calls[0]?.headers.Authorization).toBeUndefined();
  });

  it('clasifica timeout y red sin tocar la sesión', async () => {
    const client = new HttpClient('https://api.scope.test', createFailingFetch());

    await expect(probeApiConnectivity(client)).resolves.toEqual({
      status: 'unreachable',
      category: 'network'
    });
  });
});
