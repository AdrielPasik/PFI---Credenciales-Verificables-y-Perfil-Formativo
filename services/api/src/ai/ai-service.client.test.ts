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

function configureAiEnv(context: TestContext, timeout = '60000') {
  const previousBaseUrl = process.env.AI_SERVICE_BASE_URL;
  const previousTimeout = process.env.AI_SERVICE_TIMEOUT_MS;
  process.env.AI_SERVICE_BASE_URL = 'http://ai.test';
  process.env.AI_SERVICE_TIMEOUT_MS = timeout;
  context.after(() => {
    restoreEnv('AI_SERVICE_BASE_URL', previousBaseUrl);
    restoreEnv('AI_SERVICE_TIMEOUT_MS', previousTimeout);
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
