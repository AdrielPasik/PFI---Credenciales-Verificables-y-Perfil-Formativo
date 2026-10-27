import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/errors/api-error';

import {
  confirmPasswordReset,
  requestPasswordReset,
  verifyPasswordResetToken
} from './auth-api';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit];
  return {
    url: url.toString(),
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? undefined : JSON.parse(String(init.body))
  };
}

describe('password reset API functions', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('request: POSTs only the email to the public endpoint, without Authorization', async () => {
    reply(202, { status: 'requested' });

    await expect(
      requestPasswordReset({ email: 'ana@example.com' })
    ).resolves.toBeUndefined();

    const call = lastCall();
    expect(call.url).toBe('http://api.test/auth/password-reset/request');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ email: 'ana@example.com' });
    expect(call.headers.get('Authorization')).toBeNull();
  });

  it('verify: POSTs only the token, without Authorization', async () => {
    reply(200, { status: 'valid' });

    await verifyPasswordResetToken({ token: TOKEN });

    const call = lastCall();
    expect(call.url).toBe('http://api.test/auth/password-reset/verify');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ token: TOKEN });
    expect(call.headers.get('Authorization')).toBeNull();
    // Nunca el token en la URL.
    expect(call.url).not.toContain(TOKEN);
  });

  it('confirm: sends exactly token and password, untouched, without Authorization', async () => {
    reply(200, { status: 'password_reset' });

    await confirmPasswordReset({ token: TOKEN, password: '  con espacios  ' });

    const call = lastCall();
    expect(call.url).toBe('http://api.test/auth/password-reset/confirm');
    expect(call.method).toBe('POST');
    expect(Object.keys(call.body).sort()).toEqual(['password', 'token']);
    expect(call.body.password).toBe('  con espacios  ');
    expect(call.body.token).toBe(TOKEN);
    expect(call.headers.get('Authorization')).toBeNull();
    expect(call.url).not.toContain(TOKEN);
  });

  it.each([
    ['request', () => requestPasswordReset({ email: 'a@b.co' }), 202, { status: 'ok' }],
    ['verify', () => verifyPasswordResetToken({ token: TOKEN }), 200, {}],
    [
      'confirm',
      () => confirmPasswordReset({ token: TOKEN, password: '12345678' }),
      200,
      { status: 'valid' }
    ]
  ])(
    '%s: a 2xx body that is not the contract is not treated as success',
    async (_name, call, status, body) => {
      reply(status, body);

      await expect(call()).rejects.toMatchObject({
        kind: 'invalid-response'
      });
    }
  );

  it('propagates the stable backend code on rejection', async () => {
    reply(400, {
      code: 'PASSWORD_RESET_TOKEN_INVALID',
      message: 'detalle'
    });

    await expect(verifyPasswordResetToken({ token: TOKEN })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 400 &&
        error.code === 'PASSWORD_RESET_TOKEN_INVALID'
    );
  });

  it('does not put the token or password in the error it raises', async () => {
    reply(500, { message: `echo ${TOKEN}` });

    let message = '';

    try {
      await confirmPasswordReset({
        token: TOKEN,
        password: 'ContraseñaSecreta1'
      });
    } catch (caught) {
      message = (caught as Error).message;
    }

    expect(message).not.toBe('');
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('ContraseñaSecreta1');
  });
});
