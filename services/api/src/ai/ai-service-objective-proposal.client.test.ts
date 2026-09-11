/**
 * Transporte de la propuesta de Requirements en el cliente NestJS — slice P2.2.
 *
 * `fetch` se falsea con `context.mock.method`: nunca se llama al AI service real
 * y, por lo tanto,
 *
 *     REAL_PROVIDER_CALLS = 0
 *
 * Lo que se comprueba es que el cliente sea TRANSPORTE —manda el texto tal cual y
 * devuelve la respuesta sin interpretarla— y que clasifique los fallos por CÓDIGO
 * DE APLICACIÓN VALIDADO, no por status a secas. Esa distinción decide si el
 * holder puede reintentar o no, así que un status suelto no alcanza: un `503` de
 * un proxy intermedio no afirma nada sobre el proveedor.
 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import { AiServiceClientError, ObjectiveProposalTransportError } from './ai-service.types';

const RAW = '  - Experiencia minima de 3 anos.\r\n- Titulo universitario.\r\n  ';

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

function captureFetch(
  context: TestContext,
  body = '{"schemaVersion":"product_objective_requirement_proposal_response_v1"}',
  status = 200
): Captured[] {
  const captured: Captured[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(body, {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }
  );
  return captured;
}

function envelope(code: string): string {
  return JSON.stringify({ schemaVersion: 'ai_service_error_v1', code, message: 'x' });
}

const input = (overrides: Record<string, unknown> = {}) =>
  ({
    schemaVersion: 'product_objective_requirement_proposal_request_v1',
    objectiveType: 'EMPLOYMENT',
    title: 'Titulo de contexto',
    rawObjectiveText: RAW,
    ...overrides
  }) as never;

async function expectTransportCode(
  context: TestContext,
  status: number,
  body: string,
  expected: string
): Promise<void> {
  captureFetch(context, body, status);
  const client = new AiServiceClient();
  await assert.rejects(
    () => client.proposeObjectiveRequirements(input()),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveProposalTransportError);
      assert.equal(error.code, expected);
      return true;
    }
  );
}

test('postea al endpoint interno una sola vez', async (context: TestContext) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await client.proposeObjectiveRequirements(input());

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'http://ai.test/v1/objective-requirement-proposal');
  assert.equal(captured[0].init?.method, 'POST');
});

test('el texto crudo viaja EXACTO: sin trim, sin NFC, sin tocar CRLF', async (
  context: TestContext
) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await client.proposeObjectiveRequirements(input());

  const sent = JSON.parse(String(captured[0].init?.body)) as Record<string, unknown>;
  assert.equal(sent.rawObjectiveText, RAW);
  // Los offsets del artefacto se calculan sobre este texto: cualquier arreglo acá
  // desplazaría todas las referencias sin que nadie se entere.
  assert.equal(Array.from(String(sent.rawObjectiveText)).length, Array.from(RAW).length);
});

test('el cuerpo enviado lleva sólo los cuatro campos del contrato', async (
  context: TestContext
) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await client.proposeObjectiveRequirements(input());

  const sent = JSON.parse(String(captured[0].init?.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), [
    'objectiveType',
    'rawObjectiveText',
    'schemaVersion',
    'title'
  ]);
});

test('un Objective sin título es válido y viaja vacío', async (context: TestContext) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await client.proposeObjectiveRequirements(input({ title: '' }));

  const sent = JSON.parse(String(captured[0].init?.body)) as Record<string, unknown>;
  assert.equal(sent.title, '');
});

test('viaja autenticado como servicio interno', async (context: TestContext) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await client.proposeObjectiveRequirements(input());

  const headers = new Headers(captured[0].init?.headers as HeadersInit);
  assert.match(headers.get('authorization') ?? '', /^Bearer /);
});

test('devuelve la respuesta sin interpretarla', async (context: TestContext) => {
  configureAiEnv(context);
  // El cliente es transporte: verificar el artefacto es trabajo del verificador,
  // y hacerlo dos veces en capas distintas invitaría a que diverjan.
  captureFetch(context, '{"artifact":{"candidates":[{"candidateId":"cand_01"}]}}');
  const client = new AiServiceClient();

  const response = (await client.proposeObjectiveRequirements(input())) as {
    artifact: { candidates: Array<{ candidateId: string }> };
  };
  assert.equal(response.artifact.candidates[0].candidateId, 'cand_01');
});

test('rechaza un texto crudo vacío antes de tocar la red', async (context: TestContext) => {
  configureAiEnv(context);
  const captured = captureFetch(context);
  const client = new AiServiceClient();

  await assert.rejects(() => client.proposeObjectiveRequirements(input({ rawObjectiveText: '' })));
  assert.equal(captured.length, 0);
});

test('clasifica cada envelope validado con su código propio', async (
  context: TestContext
) => {
  configureAiEnv(context);
  const casos: Array<[number, string]> = [
    [413, 'OBJECTIVE_TOO_LARGE'],
    [502, 'PROVIDER_INVALID_OUTPUT'],
    [503, 'PROVIDER_TRANSPORT_FAILURE'],
    [424, 'PROVIDER_CONFIGURATION_FAILURE']
  ];
  for (const [status, code] of casos) {
    await context.test(`${status} ${code}`, async (inner: TestContext) => {
      configureAiEnv(inner);
      await expectTransportCode(inner, status, envelope(code), code);
    });
  }
});

test('un status correcto con el código equivocado NO se cree', async (
  context: TestContext
) => {
  // La clasificación exige que status y código coincidan. Si sólo mirara el
  // status, un envelope ajeno reutilizando `502` se leería como afirmación sobre
  // esta etapa.
  configureAiEnv(context);
  await expectTransportCode(
    context,
    502,
    envelope('PROVIDER_TRANSPORT_FAILURE'),
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('un cuerpo sin envelope reconocible es fallo interno, no del proveedor', async (
  context: TestContext
) => {
  configureAiEnv(context);
  await expectTransportCode(context, 502, '{"detail":"algo"}', 'INTERNAL_AI_SERVICE_FAILURE');
});

test('el 422 de validación del borde no es una afirmación sobre la propuesta', async (
  context: TestContext
) => {
  configureAiEnv(context);
  await expectTransportCode(
    context,
    422,
    '{"detail":[{"loc":["body","ownerUserId"]}]}',
    'INTERNAL_AI_SERVICE_FAILURE'
  );
});

test('sin respuesta del AI service es fallo de transporte reintentable', async (
  context: TestContext
) => {
  configureAiEnv(context);
  for (const code of ['timeout', 'unavailable'] as const) {
    context.mock.method(globalThis, 'fetch', async () => {
      throw new AiServiceClientError('sin respuesta del AI service', code);
    });
    const client = new AiServiceClient();
    await assert.rejects(
      () => client.proposeObjectiveRequirements(input()),
      (error: unknown) => {
        assert.ok(error instanceof ObjectiveProposalTransportError);
        assert.equal(error.code, 'PROVIDER_TRANSPORT_FAILURE');
        return true;
      }
    );
  }
});

test('una red caída es transporte, no una afirmación sobre el proveedor', async (
  context: TestContext
) => {
  // El pedido nunca llegó, así que nada se puede afirmar sobre la propuesta: es
  // reintentable. Clasificarlo como fallo del proveedor le diría al holder que su
  // Objective tiene un problema cuando el problema es de red.
  configureAiEnv(context);
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network collapse');
  });
  const client = new AiServiceClient();

  await assert.rejects(
    () => client.proposeObjectiveRequirements(input()),
    (error: unknown) => {
      assert.ok(error instanceof ObjectiveProposalTransportError);
      assert.equal(error.code, 'PROVIDER_TRANSPORT_FAILURE');
      return true;
    }
  );
});

test('el error de transporte no arrastra el cuerpo del AI service', async (
  context: TestContext
) => {
  // Si el detalle interno viajara dentro del error, terminaría en un log o, peor,
  // en la respuesta al holder.
  configureAiEnv(context);
  captureFetch(
    context,
    JSON.stringify({
      schemaVersion: 'ai_service_error_v1',
      code: 'PROVIDER_INVALID_OUTPUT',
      message: 'el modelo gpt-secreto devolvio basura',
      detail: 'OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY ausente'
    }),
    502
  );
  const client = new AiServiceClient();

  await assert.rejects(
    () => client.proposeObjectiveRequirements(input()),
    (error: unknown) => {
      const serialized = JSON.stringify(error) + String((error as Error).message);
      assert.ok(!serialized.includes('gpt-secreto'));
      assert.ok(!serialized.includes('OPENAI_API_KEY'));
      return true;
    }
  );
});

test('no hay reintento automático: repetir es decisión del cliente', async (
  context: TestContext
) => {
  // Como nada se persiste, reintentar produce una observación NUEVA del proveedor.
  // Reintentar por dentro gastaría llamadas sin que el holder lo sepa.
  configureAiEnv(context);
  const captured = captureFetch(context, envelope('PROVIDER_TRANSPORT_FAILURE'), 503);
  const client = new AiServiceClient();

  await assert.rejects(() => client.proposeObjectiveRequirements(input()));
  assert.equal(captured.length, 1);
});
