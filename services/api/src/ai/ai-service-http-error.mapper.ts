import { HttpException, HttpStatus } from '@nestjs/common';

import { AiServiceClientError } from './ai-service.types';

const MAX_ERROR_MESSAGE_LENGTH = 2_000;

export function mapAiServiceClientError(error: unknown): HttpException {
  if (!(error instanceof AiServiceClientError)) {
    throw error;
  }

  const status = resolveHttpStatus(error);
  const message =
    error.message.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH) ||
    'AI Service request failed.';

  return new HttpException(
    {
      statusCode: status,
      message,
      error: 'AI Service Error',
      aiServiceCode: error.code,
      upstreamStatus: error.status
    },
    status
  );
}

function resolveHttpStatus(error: AiServiceClientError): HttpStatus {
  switch (error.code) {
    case 'configuration':
    case 'unavailable':
      return HttpStatus.SERVICE_UNAVAILABLE;
    case 'timeout':
      return HttpStatus.GATEWAY_TIMEOUT;
    case 'invalid_response':
      return HttpStatus.BAD_GATEWAY;
    case 'file':
      return HttpStatus.BAD_REQUEST;
    case 'http':
      return resolveUpstreamHttpStatus(error.status);
  }
}

function resolveUpstreamHttpStatus(status: number | null): HttpStatus {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return HttpStatus.BAD_REQUEST;
    case HttpStatus.CONFLICT:
      return HttpStatus.CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.BAD_GATEWAY;
  }
}
