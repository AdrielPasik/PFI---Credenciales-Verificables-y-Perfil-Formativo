import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException
} from '@nestjs/common';

import { AiServiceClient } from './ai-service.client';
import { mapAiServiceClientError } from './ai-service-http-error.mapper';
import { AiServiceClientError } from './ai-service.types';

test('missing AI_SERVICE_BASE_URL remains a mapped request error in local none mode', async (context) => {
  const previousBaseUrl = process.env.AI_SERVICE_BASE_URL;
  const previousAuthMode = process.env.AI_SERVICE_AUTH_MODE;
  delete process.env.AI_SERVICE_BASE_URL;
  process.env.AI_SERVICE_AUTH_MODE = 'none';
  context.after(() => restoreEnv('AI_SERVICE_BASE_URL', previousBaseUrl));
  context.after(() => restoreEnv('AI_SERVICE_AUTH_MODE', previousAuthMode));

  const client = new AiServiceClient();

  await assert.rejects(
    () => client.getHealth(),
    (error: unknown) =>
      error instanceof AiServiceClientError &&
      error.code === 'configuration' &&
      /AI_SERVICE_BASE_URL is required/.test(error.message)
  );
});

test('AI Service unavailable maps to Service Unavailable', () => {
  assertMappedStatus('unavailable', null, HttpStatus.SERVICE_UNAVAILABLE);
});

test('AI Service timeout maps to Gateway Timeout', () => {
  assertMappedStatus('timeout', null, HttpStatus.GATEWAY_TIMEOUT);
});

test('invalid AI Service response maps to Bad Gateway', () => {
  assertMappedStatus(
    'invalid_response',
    HttpStatus.INTERNAL_SERVER_ERROR,
    HttpStatus.BAD_GATEWAY
  );
});

test('supported upstream HTTP statuses are preserved', () => {
  for (const status of [
    HttpStatus.BAD_REQUEST,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.SERVICE_UNAVAILABLE
  ]) {
    assertMappedStatus('http', status, status);
  }
});

test('upstream unexpected HTTP status maps to Bad Gateway', () => {
  assertMappedStatus(
    'http',
    HttpStatus.INTERNAL_SERVER_ERROR,
    HttpStatus.BAD_GATEWAY
  );
});

test('AI file error maps to Bad Request', () => {
  assertMappedStatus('file', null, HttpStatus.BAD_REQUEST);
});

test('mapper preserves backend domain HttpExceptions unchanged', () => {
  const errors = [
    new ForbiddenException('membership required'),
    new NotFoundException('credential missing'),
    new BadRequestException('credential has no SemanticAnalysis')
  ];

  for (const error of errors) {
    assert.throws(
      () => mapAiServiceClientError(error),
      (received: unknown) => received === error
    );
  }
});

function assertMappedStatus(
  code: ConstructorParameters<typeof AiServiceClientError>[1],
  upstreamStatus: number | null,
  expectedStatus: HttpStatus
) {
  const mapped = mapAiServiceClientError(
    new AiServiceClientError(
      `AI error for ${code}`,
      code,
      upstreamStatus,
      {
        artifact: 'must not be exposed'
      }
    )
  );
  const response = mapped.getResponse() as Record<string, unknown>;

  assert.equal(mapped.getStatus(), expectedStatus);
  assert.equal(response.aiServiceCode, code);
  assert.equal(response.upstreamStatus, upstreamStatus);
  assert.equal('detail' in response, false);
  assert.equal(JSON.stringify(response).includes('must not be exposed'), false);
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
