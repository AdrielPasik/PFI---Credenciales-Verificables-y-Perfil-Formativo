import { createHmac, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AiServiceClientError } from './ai-service.types';

const INTERNAL_JWT_ALGORITHM = 'HS256';
const INTERNAL_JWT_SUBJECT = 'traza-api';
const MAX_INTERNAL_JWT_TTL_SECONDS = 300;

type AiServiceAuthConfig =
  | { mode: 'none' }
  | {
      mode: 'jwt';
      secret: string;
      issuer: string;
      audience: string;
      expiresInSeconds: number;
    };

@Injectable()
export class AiServiceInternalAuth {
  private readonly config: AiServiceAuthConfig;

  constructor() {
    this.config = this.readConfig();
  }

  createAuthorizationHeader(): string | null {
    if (this.config.mode === 'none') {
      return null;
    }

    const issuedAt = Math.floor(Date.now() / 1_000);
    const payload = {
      iss: this.config.issuer,
      aud: this.config.audience,
      sub: INTERNAL_JWT_SUBJECT,
      iat: issuedAt,
      exp: issuedAt + this.config.expiresInSeconds,
      jti: randomUUID()
    };
    const encodedHeader = this.encodeJson({
      alg: INTERNAL_JWT_ALGORITHM,
      typ: 'JWT'
    });
    const encodedPayload = this.encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.config.secret)
      .update(signingInput)
      .digest('base64url');

    return `Bearer ${signingInput}.${signature}`;
  }

  isJwtEnabled(): boolean {
    return this.config.mode === 'jwt';
  }

  private readConfig(): AiServiceAuthConfig {
    const mode = (process.env.AI_SERVICE_AUTH_MODE ?? 'none')
      .trim()
      .toLowerCase();

    if (mode === 'none') {
      return { mode };
    }
    if (mode !== 'jwt') {
      throw this.configurationError(
        'AI_SERVICE_AUTH_MODE must be none or jwt.'
      );
    }

    const secret = this.requiredEnv('AI_SERVICE_JWT_SECRET');
    const issuer = this.requiredEnv('AI_SERVICE_JWT_ISSUER');
    const audience = this.requiredEnv('AI_SERVICE_JWT_AUDIENCE');
    const expiresInSeconds = this.readTtl();
    const userJwtSecret = process.env.JWT_SECRET?.trim();

    if (userJwtSecret && secret === userJwtSecret) {
      throw this.configurationError(
        'AI_SERVICE_JWT_SECRET must be different from JWT_SECRET.'
      );
    }

    return {
      mode,
      secret,
      issuer,
      audience,
      expiresInSeconds
    };
  }

  private readTtl(): number {
    const rawValue = this.requiredEnv('AI_SERVICE_JWT_EXPIRES_IN_SECONDS');
    const value = Number(rawValue);

    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_INTERNAL_JWT_TTL_SECONDS
    ) {
      throw this.configurationError(
        `AI_SERVICE_JWT_EXPIRES_IN_SECONDS must be an integer between 1 and ${MAX_INTERNAL_JWT_TTL_SECONDS}.`
      );
    }

    return value;
  }

  private requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw this.configurationError(`${name} is required in jwt mode.`);
    }
    return value;
  }

  private encodeJson(value: object): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  private configurationError(message: string): AiServiceClientError {
    return new AiServiceClientError(message, 'configuration');
  }
}
