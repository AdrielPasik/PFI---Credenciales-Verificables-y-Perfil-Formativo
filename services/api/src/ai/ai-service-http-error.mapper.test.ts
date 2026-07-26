import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException
} from '@nestjs/common';

import { AiIntegrationService } from './ai-integration.service';
import { AiServiceClient } from './ai-service.client';
import { mapAiServiceClientError } from './ai-service-http-error.mapper';
import { AiServiceClientError } from './ai-service.types';

test('missing AI_SERVICE_BASE_URL maps to Service Unavailable', async (context) => {
  const previousBaseUrl = process.env.AI_SERVICE_BASE_URL;
  delete process.env.AI_SERVICE_BASE_URL;
  context.after(() => restoreEnv('AI_SERVICE_BASE_URL', previousBaseUrl));

  const service = new AiIntegrationService(
    {} as never,
    new AiServiceClient(),
    {} as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    () =>
      service.analyzePdf({
        fileBytes: Buffer.from('%PDF-1.4\nconfiguration test')
      }),
    (error: unknown) =>
      isMappedAiError(
        error,
        HttpStatus.SERVICE_UNAVAILABLE,
        'configuration'
      )
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

function isMappedAiError(
  error: unknown,
  expectedStatus: HttpStatus,
  expectedCode: string
) {
  if (!(error instanceof HttpException)) {
    return false;
  }

  const response = error.getResponse();
  return (
    error.getStatus() === expectedStatus &&
    typeof response === 'object' &&
    response !== null &&
    'aiServiceCode' in response &&
    response.aiServiceCode === expectedCode
  );
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
