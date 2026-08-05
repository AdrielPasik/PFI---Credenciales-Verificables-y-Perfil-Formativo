import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { AiServiceClient } from './ai-service.client';
import { AiServiceInternalAuth } from './ai-service-internal-auth';
import { AiServiceClientError } from './ai-service.types';

const INTERNAL_SECRET = 'internal-service-test-secret';

test('mode none does not create an Authorization header', (context) => {
  configureAuthEnv(context, { AI_SERVICE_AUTH_MODE: 'none' });

  assert.equal(new AiServiceInternalAuth().createAuthorizationHeader(), null);
});

test('mode jwt creates a signed HS256 token with service-only claims', (context) => {
  configureJwtEnv(context);
  const auth = new AiServiceInternalAuth();
  const header = auth.createAuthorizationHeader();

  assert.ok(header);
  assert.ok(header.startsWith('Bearer '));
  const token = header.slice('Bearer '.length);
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  const jwtHeader = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  const expectedSignature = createHmac('sha256', INTERNAL_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  assert.deepEqual(jwtHeader, { alg: 'HS256', typ: 'JWT' });
  assert.equal(signature, expectedSignature);
  assert.equal(payload.iss, 'traza-api');
  assert.equal(payload.aud, 'traza-ai-service');
  assert.equal(payload.sub, 'traza-api');
  assert.equal(payload.exp - payload.iat, 60);
  assert.equal(typeof payload.jti, 'string');
  assert.ok(payload.jti.length > 0);
  assert.deepEqual(Object.keys(payload).sort(), [
    'aud',
    'exp',
    'iat',
    'iss',
    'jti',
    'sub'
  ]);
  assert.equal('userId' in payload, false);
  assert.equal('email' in payload, false);
  assert.equal('roles' in payload, false);
  assert.equal('permissions' in payload, false);
});

test('mode jwt creates a unique jti for every request', (context) => {
  configureJwtEnv(context);
  const auth = new AiServiceInternalAuth();

  const first = decodeAuthorizationPayload(auth.createAuthorizationHeader());
  const second = decodeAuthorizationPayload(auth.createAuthorizationHeader());

  assert.notEqual(first.jti, second.jti);
});

test('mode jwt rejects reuse of the human JWT secret', (context) => {
  configureJwtEnv(context, { JWT_SECRET: INTERNAL_SECRET });

  assert.throws(
    () => new AiServiceInternalAuth(),
    (error: unknown) =>
      isConfigurationError(error, 'must be different from JWT_SECRET')
  );
});

for (const name of [
  'AI_SERVICE_JWT_SECRET',
  'AI_SERVICE_JWT_ISSUER',
  'AI_SERVICE_JWT_AUDIENCE',
  'AI_SERVICE_JWT_EXPIRES_IN_SECONDS'
]) {
  test(`mode jwt fails fast when ${name} is missing`, (context) => {
    configureJwtEnv(context, { [name]: undefined });

    assert.throws(
      () => new AiServiceInternalAuth(),
      (error: unknown) => isConfigurationError(error, `${name} is required`)
    );
  });
}

for (const value of ['0', '-1', 'invalid', '301', '1.5']) {
  test(`mode jwt rejects invalid TTL ${value}`, (context) => {
    configureJwtEnv(context, {
      AI_SERVICE_JWT_EXPIRES_IN_SECONDS: value
    });

    assert.throws(
      () => new AiServiceInternalAuth(),
      (error: unknown) =>
        isConfigurationError(error, 'must be an integer between 1 and 300')
    );
  });
}

test('unknown auth mode fails fast', (context) => {
  configureAuthEnv(context, { AI_SERVICE_AUTH_MODE: 'passthrough' });

  assert.throws(
    () => new AiServiceInternalAuth(),
    (error: unknown) =>
      isConfigurationError(error, 'must be none or jwt')
  );
});

test('jwt client construction requires AI_SERVICE_BASE_URL', (context) => {
  configureJwtEnv(context);
  const previousBaseUrl = process.env.AI_SERVICE_BASE_URL;
  delete process.env.AI_SERVICE_BASE_URL;
  context.after(() => {
    if (previousBaseUrl === undefined) {
      delete process.env.AI_SERVICE_BASE_URL;
    } else {
      process.env.AI_SERVICE_BASE_URL = previousBaseUrl;
    }
  });

  assert.throws(
    () => new AiServiceClient(),
    (error: unknown) =>
      isConfigurationError(error, 'AI_SERVICE_BASE_URL is required')
  );
});

function configureJwtEnv(
  context: TestContext,
  overrides: Record<string, string | undefined> = {}
) {
  configureAuthEnv(context, {
    AI_SERVICE_AUTH_MODE: 'jwt',
    AI_SERVICE_JWT_SECRET: INTERNAL_SECRET,
    AI_SERVICE_JWT_ISSUER: 'traza-api',
    AI_SERVICE_JWT_AUDIENCE: 'traza-ai-service',
    AI_SERVICE_JWT_EXPIRES_IN_SECONDS: '60',
    JWT_SECRET: 'different-human-jwt-secret',
    ...overrides
  });
}

function configureAuthEnv(
  context: TestContext,
  values: Record<string, string | undefined>
) {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}

function decodeAuthorizationPayload(header: string | null) {
  assert.ok(header);
  return decodePart(header.slice('Bearer '.length).split('.')[1]);
}

function decodePart(value: string): Record<string, any> {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
    string,
    any
  >;
}

function isConfigurationError(error: unknown, message: string) {
  return (
    error instanceof AiServiceClientError &&
    error.code === 'configuration' &&
    error.message.includes(message)
  );
}
