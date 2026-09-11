/**
 * Transporte de source extraction en el cliente NestJS — F1.3.
 *
 * `fetch` se falsea con `context.mock.method`, igual que en
 * `ai-service.client.test.ts`; nunca se llama a FastAPI real desde TypeScript.
 * Lo que se comprueba es que el cliente sea TRANSPORTE: envía exactamente lo que
 * recibe y devuelve la respuesta sin interpretarla.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import { AiServiceClientError } from './ai-service.types';

const SHA = 'a'.repeat(64);
const TEST_TUBE = String.fromCodePoint(0x1f9ea);
const NBSP = String.fromCodePoint(0xa0);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x41]);

function configureAiEnv(context: TestContext) {
  const previous = new Map<string, string | undefined>();
  const values: Record<string, string> = {
    AI_SERVICE_BASE_URL: 'http://ai.test',
    AI_SERVICE_TIMEOUT_MS: '60000',
    AI_SERVICE_AUTH_MODE: 'jwt',
    AI_SERVICE_JWT_SECRET: 'internal-service-test-secret',
    AI_SERVICE_JWT_ISSUER: 'traza-api',
    AI_SERVICE_JWT_AUDIENCE: 'traza-ai-service',
    AI_SERVICE_JWT_EXPIRES_IN_SECONDS: '60'
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(context: TestContext, body = '{"schemaVersion":"source_extraction_v1"}', status = 200) {
  const captured: Captured[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    }
  );
  return captured;
}

function throwingFetch(context: TestContext, error: Error) {
  context.mock.method(globalThis, 'fetch', async () => {
    throw error;
  });
}

const pdfInput = (overrides: Record<string, unknown> = {}) =>
  ({
    fileBytes: PDF_BYTES,
    documentEvidenceId: 'doc-1',
    sourceSha256: SHA,
    storageKey: 'documents/doc-1.pdf',
    ...overrides
  }) as never;

const textInput = (overrides: Record<string, unknown> = {}) =>
  ({
    content: 'Contenido persistido.',
    textEvidenceId: 'text-1',
    sourceSha256: SHA,
    ...overrides
  }) as never;

// ---------------------------------------------------------------------------
// Endpoint, auth y forma del request
// ---------------------------------------------------------------------------

test('PDF: hits the source-extraction route with the internal credential', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().extractPdfSource(pdfInput());

  assert.equal(captured[0].url, 'http://ai.test/v1/source-extraction/pdf');
  assert.equal(captured[0].init?.method, 'POST');
  assert.match(
    new Headers(captured[0].init?.headers).get('authorization') ?? '',
    /^Bearer /
  );
});

test('TEXT: hits the source-extraction route with the internal credential', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().extractTextSource(textInput());

  assert.equal(captured[0].url, 'http://ai.test/v1/source-extraction/text');
  const headers = new Headers(captured[0].init?.headers);
  assert.match(headers.get('authorization') ?? '', /^Bearer /);
  assert.equal(headers.get('content-type'), 'application/json');
});

test('PDF: sends the exact bytes and the three metadata fields', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().extractPdfSource(pdfInput());

  const form = captured[0].init?.body as FormData;
  const sent = new Uint8Array(await (form.get('file') as Blob).arrayBuffer());

  assert.deepEqual(sent, PDF_BYTES, 'los bytes viajan completos y sin alterar');
  assert.equal(sent.byteLength, PDF_BYTES.byteLength);
  assert.equal(form.get('documentEvidenceId'), 'doc-1');
  assert.equal(form.get('sourceSha256'), SHA);
  assert.equal(form.get('storageKey'), 'documents/doc-1.pdf');
});

test('PDF: sends no pipeline/taxonomy version — those have no role in F0', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().extractPdfSource(pdfInput());

  const form = captured[0].init?.body as FormData;
  assert.deepEqual([...form.keys()].sort(), [
    'documentEvidenceId',
    'file',
    'sourceSha256',
    'storageKey'
  ]);
});

test('TEXT: sends the content verbatim, with no normalization', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const content = `  Uno\r\nDos  ${NBSP}${TEST_TUBE}`;

  await new AiServiceClient().extractTextSource(textInput({ content }));

  const body = JSON.parse(captured[0].init?.body as string);
  // Ni trim, ni NFC, ni fines de linea: si el contenido no es punto fijo lo
  // rechaza F0.3. Arreglarlo aca esconderia el bug de origen.
  assert.equal(body.content, content);
  assert.deepEqual(Object.keys(body).sort(), ['content', 'sourceSha256', 'textEvidenceId']);
});

test('TEXT: astral and non-ASCII survive JSON transport intact', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const content = `Ensayo ${TEST_TUBE}\n\nCarga: 40${NBSP}horas.`;

  await new AiServiceClient().extractTextSource(textInput({ content }));

  const body = JSON.parse(captured[0].init?.body as string);
  assert.equal(body.content, content);
  assert.equal(Array.from(body.content as string).length, Array.from(content).length);
  assert.ok(
    Array.from(body.content as string).some((ch) => (ch.codePointAt(0) as number) > 0xffff)
  );
});

test('TEXT: empty content is transmitted, not rejected', async (context) => {
  // El vacio es un caso contractual valido de F0: FULL con cero evidencia.
  configureAiEnv(context);
  const captured = captureFetch(context);

  await new AiServiceClient().extractTextSource(textInput({ content: '' }));
  assert.equal(JSON.parse(captured[0].init?.body as string).content, '');
});

// ---------------------------------------------------------------------------
// Frontera no confiable
// ---------------------------------------------------------------------------

for (const body of ['{}', '[]', '"hola"', '{"unexpected":true}', 'null']) {
  test(`a structurally wrong but valid JSON response is returned as-is: ${body}`, async (context) => {
    // El cliente NO valida `source_extraction_v1`. Estas respuestas deben llegar
    // a F1.4 y ser rechazadas por F0.4 / F0.5, no por el transporte.
    configureAiEnv(context);
    captureFetch(context, body);

    const result = await new AiServiceClient().extractTextSource(textInput());
    assert.deepEqual(result, JSON.parse(body));
  });
}

test('the client never coerces, reorders or completes the response', async (context) => {
  configureAiEnv(context);
  captureFetch(
    context,
    '{"schemaVersion":"source_extraction_v1","segments":[3,1,2],"pages":null}'
  );

  const result = (await new AiServiceClient().extractPdfSource(pdfInput())) as Record<
    string,
    unknown
  >;
  assert.deepEqual(result.segments, [3, 1, 2], 'el orden del array se preserva');
  assert.equal(result.pages, null, 'null no se convierte en []');
  assert.deepEqual(Object.keys(result).sort(), ['pages', 'schemaVersion', 'segments']);
});

test('a non-JSON 2xx body is a transport failure, not an unknown result', async (context) => {
  configureAiEnv(context);
  captureFetch(context, '<html>gateway</html>');

  await assert.rejects(
    new AiServiceClient().extractTextSource(textInput()),
    (error: unknown) => {
      assert.ok(error instanceof AiServiceClientError);
      assert.equal(error.code, 'invalid_response');
      return true;
    }
  );
});

test('an empty 2xx body is a transport failure', async (context) => {
  configureAiEnv(context);
  captureFetch(context, '   ');

  await assert.rejects(new AiServiceClient().extractPdfSource(pdfInput()), (error: unknown) => {
    assert.ok(error instanceof AiServiceClientError);
    assert.equal(error.code, 'invalid_response');
    return true;
  });
});

// ---------------------------------------------------------------------------
// Fallos, con la clasificación existente
// ---------------------------------------------------------------------------

test('a non-2xx response follows the existing http classification', async (context) => {
  configureAiEnv(context);
  captureFetch(context, '{"detail":"source_sha256_does_not_match_uploaded_bytes"}', 422);

  await assert.rejects(new AiServiceClient().extractPdfSource(pdfInput()), (error: unknown) => {
    assert.ok(error instanceof AiServiceClientError);
    assert.equal(error.code, 'http');
    assert.equal(error.status, 422);
    return true;
  });
});

test('a rejected internal credential is reported as such', async (context) => {
  configureAiEnv(context);
  captureFetch(context, '{"detail":"no"}', 401);

  await assert.rejects(new AiServiceClient().extractTextSource(textInput()), (error: unknown) => {
    assert.ok(error instanceof AiServiceClientError);
    assert.match(error.message, /internal service credential/i);
    return true;
  });
});

test('a timeout follows the existing abort behaviour', async (context) => {
  configureAiEnv(context);
  throwingFetch(context, Object.assign(new Error('aborted'), { name: 'AbortError' }));

  await assert.rejects(new AiServiceClient().extractPdfSource(pdfInput()), (error: unknown) => {
    assert.ok(error instanceof AiServiceClientError);
    assert.equal(error.code, 'timeout');
    return true;
  });
});

test('a network failure is reported as unavailable', async (context) => {
  configureAiEnv(context);
  throwingFetch(context, new Error('ECONNREFUSED'));

  await assert.rejects(new AiServiceClient().extractTextSource(textInput()), (error: unknown) => {
    assert.ok(error instanceof AiServiceClientError);
    assert.equal(error.code, 'unavailable');
    return true;
  });
});

// ---------------------------------------------------------------------------
// Validación de argumentos
// ---------------------------------------------------------------------------

test('empty PDF bytes are rejected before any request', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);

  await assert.rejects(
    new AiServiceClient().extractPdfSource(pdfInput({ fileBytes: new Uint8Array() })),
    AiServiceClientError
  );
  assert.equal(captured.length, 0);
});

test('missing identifiers are rejected before any request', async (context) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await assert.rejects(client.extractPdfSource(pdfInput({ storageKey: '  ' })));
  await assert.rejects(client.extractTextSource(textInput({ textEvidenceId: '' })));
  assert.equal(captured.length, 0);
});

test('the client performs no verification and no persistence', async () => {
  // Estructural: el módulo del cliente no importa el verificador de F0.4, el
  // trust gate de F0.5 ni el repositorio de F1.2.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(__dirname, 'ai-service.client.ts'), 'utf8');

  for (const forbidden of [
    'source-extraction-artifact.verifier',
    'source-extraction-trust-gate',
    'source-extraction-slot'
  ]) {
    assert.ok(!source.includes(forbidden), `el cliente no debe importar ${forbidden}`);
  }
});
