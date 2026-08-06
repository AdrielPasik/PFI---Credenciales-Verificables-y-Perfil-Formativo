import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from '@/lib/api/api-client';
import { ApiError } from '@/lib/errors/api-error';

const baseUrl = 'http://127.0.0.1:3001';

describe('ApiClient', () => {
  it('builds the URL and sends a GET with only the Accept header', async () => {
    const fetchMock = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    await expect(client.request('/health')).resolves.toEqual({
      status: 'ok'
    });

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe('http://127.0.0.1:3001/health');
    expect(init?.method).toBe('GET');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(init?.body).toBeUndefined();
  });

  it('serializes a JSON POST and sends Bearer only when supplied', async () => {
    const fetchMock = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200
        });
      }
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);
    const body = {
      email: 'persona@example.com',
      password: '[REDACTED]'
    };

    await client.request('/auth/login', {
      method: 'POST',
      body,
      token: '[REDACTED]'
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer [REDACTED]');
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it('passes FormData unchanged without setting Content-Type and preserves Bearer auth', async () => {
    const fetchMock = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(JSON.stringify({ accepted: true }), {
          status: 201
        });
      }
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);
    const body = new FormData();
    const evidence = new File(['document'], 'programa.pdf', {
      type: 'application/pdf'
    });
    body.append('file', evidence);

    await client.request('/evidence/documents', {
      method: 'POST',
      body,
      token: '[REDACTED]'
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.body).toBe(body);
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer [REDACTED]');
  });

  it('sends an authenticated POST without serializing an absent body', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    }
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    await client.request('/analysis-runs/document', {
      method: 'POST',
      token: '[REDACTED]'
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(init?.body).toBeUndefined();
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer [REDACTED]');
  });

  it('returns null for a successful response without a body', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    await expect(client.request('/health')).resolves.toBeNull();
  });

  it('maps HTTP 401 to an ApiError without response details', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'sensitive upstream detail' }), {
        status: 401
      })
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    const error = await client
      .request('/auth/me', { token: '[REDACTED]' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', status: 401 });
    expect((error as Error).message).not.toContain('[REDACTED]');
    expect((error as Error).message).not.toContain('sensitive');
  });

  it('maps transport failures to a network ApiError without sensitive input', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('transport included [REDACTED]');
    });
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    const error = await client
      .request('/auth/login', {
        method: 'POST',
        token: '[REDACTED]',
        body: { password: '[REDACTED]' }
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'network', status: null });
    expect((error as Error).message).not.toContain('[REDACTED]');
    expect((error as Error).message).not.toContain('password');
  });

  it('invokes fetch with the global receiver', async () => {
    let dispatchCount = 0;
    const receiverSensitiveFetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      void input;
      void init;

      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      dispatchCount += 1;

      return Promise.resolve(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    };
    const client = new ApiClient(
      baseUrl,
      receiverSensitiveFetch as typeof fetch
    );

    await expect(client.request('/health')).resolves.toEqual({
      status: 'ok'
    });
    expect(dispatchCount).toBe(1);
  });

  it('rejects invalid JSON from a successful response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('not-json', { status: 200 })
    );
    const client = new ApiClient(baseUrl, fetchMock as typeof fetch);

    const error = await client
      .request('/health')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'invalid-response',
      status: 200
    });
  });
});
