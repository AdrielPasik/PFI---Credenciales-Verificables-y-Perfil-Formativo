import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import { AiServiceClientError } from './ai-service.types';

test('getHealth returns normalized AI Service health', async (context) => {
  configureAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'http://ai.test/health');
    assert.equal(init?.method, 'GET');
    return jsonResponse({
      status: 'ok',
      service: 'pfi-ai-service'
    });
    }
  );

  assert.deepEqual(await new AiServiceClient().getHealth(), {
    status: 'ok',
    service: 'pfi-ai-service'
  });
});

test('getHealth remains public when internal jwt mode is enabled', async (context) => {
  configureJwtAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return jsonResponse({ status: 'ok', service: 'pfi-ai-service' });
    }
  );

  assert.equal((await new AiServiceClient().getHealth()).status, 'ok');
});

test('getHealth reports an unavailable AI Service', async (context) => {
  configureAiEnv(context);
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });

  await assert.rejects(
    () => new AiServiceClient().getHealth(),
    (error: unknown) =>
      error instanceof AiServiceClientError &&
      error.code === 'unavailable' &&
      /AI Service is unavailable/.test(error.message)
  );
});

test('analyzePdf sends native multipart fields and file', async (context) => {
  configureAiEnv(context);
  await withTemporaryPdf(async (filePath) => {
    context.mock.method(
      globalThis,
      'fetch',
      async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, 'http://ai.test/v1/semantic-analysis/pdf');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers, undefined);
      assert.ok(init?.body instanceof FormData);

      const formData = init.body as FormData;
      const file = formData.get('file');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'logical-name.pdf');
      assert.equal(file.type, 'application/pdf');
      assert.equal(formData.get('documentId'), 'backend-doc-1');
      assert.equal(formData.get('fileName'), 'logical-name.pdf');
      assert.equal(formData.get('pipelineVersion'), 'unversioned_current');
      assert.equal(formData.get('taxonomyVersion'), 'unversioned_current');

      return jsonResponse({
        schemaVersion: 'semantic_analysis_v1'
      });
      }
    );

    const response = await new AiServiceClient().analyzePdf({
      filePath,
      documentId: 'backend-doc-1',
      fileName: 'logical-name.pdf',
      pipelineVersion: 'unversioned_current',
      taxonomyVersion: 'unversioned_current'
    });

    assert.deepEqual(response, {
      schemaVersion: 'semantic_analysis_v1'
    });
  });
});

test('analyzePdf accepts an in-memory PDF without filesystem access', async (context) => {
  configureAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      assert.ok(init?.body instanceof FormData);
      const file = (init.body as FormData).get('file');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'browser-upload.pdf');
      assert.equal(await file.text(), '%PDF-1.4\nin-memory test');

      return jsonResponse({
        schemaVersion: 'semantic_analysis_v1'
      });
    }
  );

  const response = await new AiServiceClient().analyzePdf({
    fileBytes: Buffer.from('%PDF-1.4\nin-memory test', 'utf8'),
    fileName: 'browser-upload.pdf'
  });

  assert.deepEqual(response, {
    schemaVersion: 'semantic_analysis_v1'
  });
});

test('analyzePdf forwards a safe analysis-run correlation header', async (context) => {
  configureAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        new Headers(init?.headers).get('x-analysis-run-id'),
        'run-123'
      );
      return jsonResponse({ schemaVersion: 'semantic_analysis_v1' });
    }
  );

  await new AiServiceClient().analyzePdf({
    fileBytes: Buffer.from('%PDF-1.4\ncorrelation test', 'utf8'),
    correlationId: 'run-123'
  });
});

test('fetch failure preserves only a safe network cause code', async (context) => {
  configureAiEnv(context);
  context.mock.method(globalThis, 'fetch', async () => {
    const cause = Object.assign(new Error('internal DNS detail'), {
      code: 'ENOTFOUND'
    });
    throw Object.assign(new TypeError('fetch failed'), { cause });
  });

  await assert.rejects(
    () => new AiServiceClient().getHealth(),
    (error: unknown) =>
      error instanceof AiServiceClientError &&
      error.code === 'unavailable' &&
      error.causeCode === 'ENOTFOUND' &&
      error.detail === null &&
      !error.message.includes('internal DNS detail')
  );
});

test('analyzePdf preserves useful detail from a 422 response', async (context) => {
  configureAiEnv(context);
  await withTemporaryPdf(async (filePath) => {
    context.mock.method(globalThis, 'fetch', async () =>
      jsonResponse(
        {
          detail: 'pdf_could_not_be_processed: malformed content'
        },
        422
      )
    );

    await assert.rejects(
      () => new AiServiceClient().analyzePdf({ filePath }),
      (error: unknown) =>
        error instanceof AiServiceClientError &&
        error.status === 422 &&
        /pdf_could_not_be_processed/.test(error.message)
    );
  });
});

test('analyzePdf reports a controlled timeout', async (context) => {
  configureAiEnv(context, '5');
  await withTemporaryPdf(async (filePath) => {
    context.mock.method(
      globalThis,
      'fetch',
      async (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
    );

    await assert.rejects(
      () => new AiServiceClient().analyzePdf({ filePath }),
      (error: unknown) =>
        error instanceof AiServiceClientError &&
        error.code === 'timeout' &&
        /5 ms/.test(error.message)
    );
  });
});

test('buildFormativeProfile sends the expected JSON body', async (context) => {
  configureAiEnv(context);
  const artifacts = [
    {
      schemaVersion: 'semantic_analysis_v1'
    }
  ];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'http://ai.test/v1/formative-profile/build');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(init?.headers, {
      'content-type': 'application/json'
    });
    assert.deepEqual(JSON.parse(String(init?.body)), {
      artifacts
    });

    return jsonResponse({
      profileVersion: 'formative_profile_result_v0'
    });
    }
  );

  assert.deepEqual(
    await new AiServiceClient().buildFormativeProfile({
      artifacts
    }),
    {
      profileVersion: 'formative_profile_result_v0'
    }
  );
});

test('jwt mode sends a new internal token and never forwards a human bearer', async (context) => {
  configureJwtAiEnv(context);
  const humanAuthorization = 'Bearer human-user-jwt-must-not-be-forwarded';
  const captured: { authorization: string | null } = {
    authorization: null
  };
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, init?: RequestInit) => {
      captured.authorization = new Headers(init?.headers).get('authorization');
      return jsonResponse({
        profileVersion: 'formative_profile_result_v0'
      });
    }
  );

  // A browser bearer can exist in the Nest request context, but the AI client
  // has no API for receiving it and creates a separate service credential.
  const simulatedNestRequest = { authorization: humanAuthorization };
  assert.equal(simulatedNestRequest.authorization, humanAuthorization);
  await new AiServiceClient().buildFormativeProfile({
    artifacts: [{ schemaVersion: 'semantic_analysis_v1' }]
  });

  const upstreamAuthorization = captured.authorization;
  assert.ok(upstreamAuthorization);
  assert.ok(upstreamAuthorization.startsWith('Bearer '));
  assert.notEqual(upstreamAuthorization, humanAuthorization);
  assert.equal(upstreamAuthorization.includes('human-user-jwt'), false);
  const payload = decodeJwtPayload(upstreamAuthorization);
  assert.deepEqual(Object.keys(payload).sort(), [
    'aud',
    'exp',
    'iat',
    'iss',
    'jti',
    'sub'
  ]);
});

for (const status of [401, 403]) {
  test(`upstream ${status} is sanitized`, async (context) => {
    configureJwtAiEnv(context);
    context.mock.method(globalThis, 'fetch', async () =>
      jsonResponse(
        {
          detail: 'sensitive upstream token or configuration detail'
        },
        status
      )
    );

    await assert.rejects(
      () =>
        new AiServiceClient().buildFormativeProfile({
          artifacts: [{ schemaVersion: 'semantic_analysis_v1' }]
        }),
      (error: unknown) =>
        error instanceof AiServiceClientError &&
        error.status === status &&
        error.message.includes('rejected the internal service credential') &&
        !error.message.includes('sensitive upstream')
    );
  });
}

for (const [label, baseUrl] of [
  ['invalid syntax', 'not-a-url'],
  ['unsupported protocol', 'ftp://ai.test'],
  ['credentials', 'http://user:password@ai.test'],
  ['query', 'http://ai.test?token=sensitive'],
  ['fragment', 'http://ai.test#sensitive']
]) {
  test(`AI Service base URL rejects ${label}`, (context) => {
    configureAiEnv(context, '60000', baseUrl);
    let fetchCalled = false;
    context.mock.method(globalThis, 'fetch', async () => {
      fetchCalled = true;
      return jsonResponse({ status: 'ok', service: 'pfi-ai-service' });
    });

    assert.throws(
      () => new AiServiceClient(),
      (error: unknown) =>
        error instanceof AiServiceClientError &&
        error.code === 'configuration' &&
        !error.message.includes(baseUrl)
    );
    assert.equal(fetchCalled, false);
  });
}

test('buildFormativeProfile rejects a non-JSON response', async (context) => {
  configureAiEnv(context);
  context.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('service unavailable', {
        status: 500,
        headers: {
          'content-type': 'text/plain'
        }
      })
  );

  await assert.rejects(
    () =>
      new AiServiceClient().buildFormativeProfile({
        artifacts: [
          {
            schemaVersion: 'semantic_analysis_v1'
          }
        ]
      }),
    (error: unknown) =>
      error instanceof AiServiceClientError &&
      error.code === 'invalid_response' &&
      error.status === 500
  );
});

function configureAiEnv(
  context: TestContext,
  timeout = '60000',
  baseUrl = 'http://ai.test'
) {
  const previousBaseUrl = process.env.AI_SERVICE_BASE_URL;
  const previousTimeout = process.env.AI_SERVICE_TIMEOUT_MS;
  const previousAuthMode = process.env.AI_SERVICE_AUTH_MODE;
  process.env.AI_SERVICE_BASE_URL = baseUrl;
  process.env.AI_SERVICE_TIMEOUT_MS = timeout;
  process.env.AI_SERVICE_AUTH_MODE = 'none';
  context.after(() => {
    restoreEnv('AI_SERVICE_BASE_URL', previousBaseUrl);
    restoreEnv('AI_SERVICE_TIMEOUT_MS', previousTimeout);
    restoreEnv('AI_SERVICE_AUTH_MODE', previousAuthMode);
  });
}

function configureJwtAiEnv(context: TestContext) {
  const values: Record<string, string> = {
    AI_SERVICE_BASE_URL: 'http://ai.test',
    AI_SERVICE_TIMEOUT_MS: '60000',
    AI_SERVICE_AUTH_MODE: 'jwt',
    AI_SERVICE_JWT_SECRET: 'internal-service-test-secret',
    AI_SERVICE_JWT_ISSUER: 'traza-api',
    AI_SERVICE_JWT_AUDIENCE: 'traza-ai-service',
    AI_SERVICE_JWT_EXPIRES_IN_SECONDS: '60',
    JWT_SECRET: 'different-human-user-secret'
  };
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  context.after(() => {
    for (const [name, value] of previous) {
      restoreEnv(name, value);
    }
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

function decodeJwtPayload(authorization: string) {
  const token = authorization.slice('Bearer '.length);
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
  ) as Record<string, unknown>;
}

async function withTemporaryPdf(
  callback: (filePath: string) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-client-pdf-'));
  const filePath = join(directory, 'source.pdf');
  try {
    await writeFile(filePath, '%PDF-1.4\nminimal test', 'utf8');
    await callback(filePath);
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
}
