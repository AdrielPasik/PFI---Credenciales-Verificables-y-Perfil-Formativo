/**
 * Fugas de material de fuente por el camino de ERROR — F1.5 §10B.
 *
 * La pregunta no es si FastAPI devuelve un error seguro. Es si NestJS, al fallar,
 * puede terminar loggeando o serializando el REQUEST que envio, o el objeto crudo
 * del cliente HTTP. Para source extraction ese request contiene bytes de PDF o
 * `TextEvidence.content` completo, asi que un `JSON.stringify(error)` descuidado
 * seria una fuga de la fuente entera.
 *
 * Metodo: se manda contenido centinela reconocible, se induce el fallo, y se
 * busca el centinela en TODO lo que el error puede acabar produciendo:
 *
 *     error.message
 *     error.detail
 *     JSON.stringify(error)            <- incluye propiedades enumerables
 *     inspeccion profunda del objeto   <- incluye no enumerables y `cause`
 *     la HttpException mapeada
 */

import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import test, { type TestContext } from 'node:test';

import { AnalysisRunExecutionService } from '../analysis-run/analysis-run-execution.service';
import { AiServiceClient } from './ai-service.client';
import { mapAiServiceClientError } from './ai-service-http-error.mapper';
import { AiServiceClientError } from './ai-service.types';

/** Centinela: no aparece en ningun mensaje legitimo del sistema. */
const SENTINEL = 'CENTINELA_TEXTO_FUENTE_9f3a1c7e';
const SENTINEL_CONTENT = `Modulo uno.\n\nContenido sensible: ${SENTINEL}.`;
const SENTINEL_PDF_BYTES = new Uint8Array(Buffer.from(`%PDF-1.4\n${SENTINEL}`, 'utf8'));
const SHA = 'a'.repeat(64);

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

function respondWith(context: TestContext, body: string, status: number) {
  context.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
}

function throwOnFetch(context: TestContext, error: Error) {
  context.mock.method(globalThis, 'fetch', async () => {
    throw error;
  });
}

/**
 * Todas las superficies por las que un error puede escaparse.
 *
 * `inspect` con `showHidden` alcanza propiedades no enumerables y `cause`, que
 * es justo donde un cliente HTTP descuidado guardaria el request original.
 */
function errorSurfaces(error: unknown): Record<string, string> {
  return {
    message: error instanceof Error ? error.message : String(error),
    stringify: JSON.stringify(error) ?? 'undefined',
    ownProperties: JSON.stringify(
      Object.getOwnPropertyNames(error as object).reduce<Record<string, unknown>>(
        (acc, key) => {
          acc[key] = (error as Record<string, unknown>)[key];
          return acc;
        },
        {}
      )
    ),
    inspected: inspect(error, { depth: 8, showHidden: true })
  };
}

function assertSentinelAbsent(error: unknown, label: string) {
  for (const [surface, text] of Object.entries(errorSurfaces(error))) {
    assert.ok(
      !text.includes(SENTINEL),
      `${label}: el centinela aparece en ${surface}`
    );
  }
}

function assertSentinelAbsentFromHttpResponse(error: unknown, label: string) {
  const mapped = mapAiServiceClientError(error);
  const serialized = JSON.stringify(mapped.getResponse());
  assert.ok(
    !serialized.includes(SENTINEL),
    `${label}: el centinela aparece en la respuesta HTTP mapeada`
  );
}

// ---------------------------------------------------------------------------
// El request nunca queda adjunto al error
// ---------------------------------------------------------------------------

for (const [label, status, body] of [
  ['500 con detail generico', 500, '{"detail":"internal error"}'],
  ['422 de precondicion', 422, '{"detail":"content_is_not_product_normalized: trim"}'],
  ['400 sin campo detail', 400, '{"error":"bad request"}'],
  ['502 con cuerpo no JSON', 502, '<html>gateway</html>'],
  ['200 con cuerpo vacio', 200, '   ']
] as const) {
  test(`TEXT: ${label} — el contenido enviado no queda en el error`, async (context) => {
    configureAiEnv(context);
    respondWith(context, body, status);

    try {
      await new AiServiceClient().extractTextSource({
        content: SENTINEL_CONTENT,
        textEvidenceId: 'text-1',
        sourceSha256: SHA
      });
      assert.fail('se esperaba un fallo');
    } catch (error) {
      assert.ok(error instanceof AiServiceClientError, String(error));
      assertSentinelAbsent(error, label);
      assertSentinelAbsentFromHttpResponse(error, label);
    }
  });
}

test('PDF: los bytes enviados no quedan en el error ni en la respuesta mapeada', async (context) => {
  configureAiEnv(context);
  respondWith(context, '{"detail":"unsupported source"}', 500);

  try {
    await new AiServiceClient().extractPdfSource({
      fileBytes: SENTINEL_PDF_BYTES,
      documentEvidenceId: 'doc-1',
      sourceSha256: SHA,
      storageKey: 'documents/doc-1.pdf'
    });
    assert.fail('se esperaba un fallo');
  } catch (error) {
    assertSentinelAbsent(error, 'pdf-http');
    assertSentinelAbsentFromHttpResponse(error, 'pdf-http');
  }
});

test('el storageKey enviado tampoco queda en el error', async (context) => {
  configureAiEnv(context);
  respondWith(context, '{"detail":"boom"}', 500);

  try {
    await new AiServiceClient().extractPdfSource({
      fileBytes: SENTINEL_PDF_BYTES,
      documentEvidenceId: 'doc-1',
      sourceSha256: SHA,
      storageKey: `documents/${SENTINEL}.pdf`
    });
    assert.fail('se esperaba un fallo');
  } catch (error) {
    assertSentinelAbsent(error, 'storage-key');
    assertSentinelAbsentFromHttpResponse(error, 'storage-key');
  }
});

test('un fallo de red no adjunta el request ni la excepcion cruda', async (context) => {
  configureAiEnv(context);
  // Una excepcion de red que SI lleva el request colgado, como haria un cliente
  // HTTP que adjunta su config. El cliente solo debe extraer un codigo.
  const networkError = Object.assign(new Error('ECONNREFUSED'), {
    cause: { code: 'ECONNREFUSED', request: { body: SENTINEL_CONTENT } },
    config: { data: SENTINEL_CONTENT }
  });
  throwOnFetch(context, networkError);

  try {
    await new AiServiceClient().extractTextSource({
      content: SENTINEL_CONTENT,
      textEvidenceId: 'text-1',
      sourceSha256: SHA
    });
    assert.fail('se esperaba un fallo');
  } catch (error) {
    assertSentinelAbsent(error, 'network');
    assertSentinelAbsentFromHttpResponse(error, 'network');
  }
});

test('un timeout no adjunta el request', async (context) => {
  configureAiEnv(context);
  throwOnFetch(context, Object.assign(new Error('aborted'), { name: 'AbortError' }));

  try {
    await new AiServiceClient().extractPdfSource({
      fileBytes: SENTINEL_PDF_BYTES,
      documentEvidenceId: 'doc-1',
      sourceSha256: SHA,
      storageKey: 'documents/doc-1.pdf'
    });
    assert.fail('se esperaba un fallo');
  } catch (error) {
    assertSentinelAbsent(error, 'timeout');
    assertSentinelAbsentFromHttpResponse(error, 'timeout');
  }
});

// ---------------------------------------------------------------------------
// Control positivo del metodo
// ---------------------------------------------------------------------------

test('control: el detector encontraria el centinela si estuviera', () => {
  // Sin esto, un `assertSentinelAbsent` roto pasaria de forma vacia sobre
  // cualquier error. Se comprueba en las CUATRO superficies.
  const leaky = Object.assign(new AiServiceClientError('boom', 'http', 500), {
    requestBody: SENTINEL_CONTENT
  });

  const surfaces = errorSurfaces(leaky);
  assert.ok(surfaces.stringify.includes(SENTINEL));
  assert.ok(surfaces.ownProperties.includes(SENTINEL));
  assert.ok(surfaces.inspected.includes(SENTINEL));
  assert.throws(() => assertSentinelAbsent(leaky, 'control'));

  const inMessage = new AiServiceClientError(`falla: ${SENTINEL}`, 'http', 500);
  assert.throws(() => assertSentinelAbsent(inMessage, 'control-message'));
  assert.throws(() => assertSentinelAbsentFromHttpResponse(inMessage, 'control-http'));
});

// ---------------------------------------------------------------------------
// Limite conocido del borde: un upstream que ecoe contenido en `detail`
// ---------------------------------------------------------------------------

test('LIMITE: un `detail` de upstream se propaga al mensaje, recortado a 500', async (context) => {
  // Esto NO es una fuga de F1.5, y conviene tenerlo escrito en vez de asumido.
  //
  // El cliente propaga `body.detail` cuando es un string. Las rutas de F1.3
  // estan construidas para que ese `detail` NUNCA lleve material de fuente
  // —solo nombres de invariante y etapas—, y eso se verifico alli. Pero si un
  // upstream comprometido o mal implementado ecoara el contenido, el string
  // llegaria al mensaje del error.
  //
  // La defensa real esta aguas abajo y ya existe: `AnalysisRunExecutionService`
  // aplica `sanitizeDiagnosticDetail` antes de loggear, y persiste en el run un
  // `errorMessage` de una tabla fija de mensajes seguros. Se documenta como
  // limite del borde, no se "arregla" ampliando el contrato de F1.3.
  configureAiEnv(context);
  respondWith(context, JSON.stringify({ detail: `eco: ${SENTINEL}` }), 500);

  try {
    await new AiServiceClient().extractTextSource({
      content: SENTINEL_CONTENT,
      textEvidenceId: 'text-1',
      sourceSha256: SHA
    });
    assert.fail('se esperaba un fallo');
  } catch (error) {
    assert.ok(error instanceof AiServiceClientError);
    // El centinela viene del CUERPO DE RESPUESTA del upstream, no del request.
    assert.ok(error.message.includes(SENTINEL), 'documenta el comportamiento real');
    // Lo que importa para F1.5: sigue sin haber ni rastro del request enviado.
    assert.ok(
      !error.message.includes('Modulo uno.'),
      'el contenido ENVIADO nunca aparece'
    );
  }
});

test('el sanitizador del run redacta un detail de upstream con material de fuente', () => {
  // Segunda mitad del limite anterior: el camino que efectivamente loggea.
  const sanitize = (
    AnalysisRunExecutionService.prototype as unknown as {
      sanitizeDiagnosticDetail(value: unknown): string | null;
    }
  ).sanitizeDiagnosticDetail;

  assert.equal(sanitize.call(null, { any: 'object' }), 'structured_detail');
  assert.equal(sanitize.call(null, `%PDF-1.4 ${SENTINEL}`), 'upstream_detail_redacted');
  assert.equal(
    sanitize.call(null, `content: ${SENTINEL}`),
    'upstream_detail_redacted'
  );
  assert.equal(
    sanitize.call(null, `storageKey documents/${SENTINEL}.pdf`),
    'upstream_detail_redacted'
  );
  // Un detail seguro sobrevive: no se redacta indiscriminadamente.
  assert.equal(sanitize.call(null, 'ai_timeout'), 'ai_timeout');
});
