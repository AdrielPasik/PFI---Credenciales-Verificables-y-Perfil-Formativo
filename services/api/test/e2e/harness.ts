/**
 * Harness HTTP del E2E institucional -- slice S7a.
 *
 * Levanta un servidor Nest REAL en un puerto efimero de loopback y lo maneja
 * por HTTP con `fetch`. No hay supertest ni `@nestjs/testing` en este repo, y
 * no se agrego ninguna dependencia: `NestFactory.create` + `app.listen(0)` +
 * el `fetch` global de Node alcanzan.
 *
 * QUE ES REAL ACA
 *
 *   - el routing de Nest y los codigos HTTP (incluido el mapeo de
 *     `HttpException` -> status), porque `main.ts` no instala ningun pipe,
 *     filtro ni prefijo global: lo unico que hace de mas es CORS, irrelevante
 *     para un cliente server-side. El harness reproduce entonces la misma
 *     semantica HTTP que produccion;
 *   - `AuthController`, `AuthService`, firma y verificacion de JWT con
 *     `@nestjs/jwt`, y el hashing/verificacion de password;
 *   - `AuthGuard` y `PlatformAdminGuard`;
 *   - los cuatro controllers de `/admin` con sus validadores y DTOs;
 *   - `IssuersService.assertUserCanOperateAuthorizedIssuer`, que es la regla
 *     de autoridad institucional;
 *   - `IssuerCourseTemplatesController`, usado como lectura institucional
 *     protegida.
 *
 * QUE ESTA SUSTITUIDO
 *
 *   - la persistencia, por `InMemoryPrisma` (ver ese archivo: en este entorno
 *     no hay PostgreSQL y conectarse a una base remota esta prohibido);
 *   - nada mas.
 *
 * AISLAMIENTO. El modulo de test importa UNICAMENTE los cuatro modulos que el
 * circuito necesita. No importa `AppModule`, y por lo tanto no instancia
 * `BlockchainModule`, `AiModule`, `DocumentEvidenceModule` ni ningun otro
 * modulo con dependencias externas: no hay provider de RPC, ni de S3, ni de
 * servicio de IA. `PrismaClient` nunca se construye.
 */

import 'reflect-metadata';

import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

import { AuthModule } from '../../src/auth/auth.module';
import { IssuerCourseTemplatesModule } from '../../src/issuer-course-templates/issuer-course-templates.module';
import { IssuersModule } from '../../src/issuers/issuers.module';
import { PlatformAdminModule } from '../../src/platform-admin/platform-admin.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InMemoryPrisma } from './in-memory-prisma';

/** Secreto de test. No es un secreto real y no sale de este proceso. */
export const E2E_JWT_SECRET = 'scope-s7a-e2e-only-secret';

export interface E2eResponse<T = unknown> {
  status: number;
  body: T;
}

export interface E2eClient {
  baseUrl: string;
  prisma: InMemoryPrisma;
  request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    options?: { token?: string; body?: unknown }
  ): Promise<E2eResponse<T>>;
  close(): Promise<void>;
}

export async function startE2eApi(): Promise<E2eClient> {
  // El JWT es real; el secreto es de test. `getJwtSecretOrThrow` lo exige.
  process.env.JWT_SECRET = E2E_JWT_SECRET;
  // Sin `PUBLIC_DID_BASE_URL` el registro deja `User.did = null`, que es el
  // camino productivo cuando la identidad personal no esta configurada.
  delete process.env.PUBLIC_DID_BASE_URL;
  // Explicito aunque sea el default: ningun test de S7a toca cadena.
  process.env.BLOCKCHAIN_EVIDENCE_MODE = 'mock';

  const prisma = new InMemoryPrisma();

  @Global()
  @Module({
    providers: [{ provide: PrismaService, useValue: prisma }],
    exports: [PrismaService]
  })
  class InMemoryPrismaModule {}

  @Module({
    imports: [
      InMemoryPrismaModule,
      AuthModule,
      PlatformAdminModule,
      IssuersModule,
      IssuerCourseTemplatesModule
    ]
  })
  class E2eApiModule {}

  const app: INestApplication = await NestFactory.create(E2eApiModule, {
    logger: false,
    abortOnError: false
  });

  // Puerto efimero en loopback: nada se expone fuera de la maquina.
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown } = {}
  ): Promise<E2eResponse<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    let body: unknown = null;

    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return { status: response.status, body: body as T };
  }

  return {
    baseUrl,
    prisma,
    request,
    close: async () => {
      await app.close();
    }
  };
}

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

/** Emails de test, en un TLD reservado (`.test`, RFC 2606). Nunca reales. */
export const ACTORS = {
  platformAdmin: 'platform-admin.e2e@example.test',
  institutionalUser: 'institutional-user.e2e@example.test',
  outsider: 'outsider.e2e@example.test',
  personalUser: 'personal-user.e2e@example.test',
  legacyUser: 'legacy-user.e2e@example.test'
} as const;

/**
 * Password de test, compartida por todos los actores. No es un secreto real,
 * no se persiste en ningun archivo de configuracion y el hash vive solo en
 * memoria durante el test.
 */
export const E2E_PASSWORD = 'ScopeE2ePassword123';

export interface RegisteredActor {
  email: string;
  token: string;
  userId: string;
}

/**
 * Registra una persona por el endpoint REAL de signup y devuelve su token.
 *
 * `onboardingIntent` viaja tal como lo manda el cliente productivo; omitirlo
 * reproduce una cuenta anterior a O1.
 */
export async function registerActor(
  client: E2eClient,
  email: string,
  options: {
    onboardingIntent?: 'personal' | 'institutional';
    firstName?: string;
    lastName?: string;
  } = {}
): Promise<RegisteredActor> {
  const response = await client.request<{
    accessToken: string;
    user: { id: string };
  }>('POST', '/auth/register', {
    body: {
      email,
      password: E2E_PASSWORD,
      firstName: options.firstName ?? 'Persona',
      lastName: options.lastName ?? 'DeTest',
      ...(options.onboardingIntent
        ? { onboardingIntent: options.onboardingIntent }
        : {})
    }
  });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(
      `No se pudo registrar ${email}: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return {
    email,
    token: response.body.accessToken,
    userId: response.body.user.id
  };
}

/** Inicia sesion por el endpoint REAL y devuelve un token nuevo. */
export async function loginActor(
  client: E2eClient,
  email: string
): Promise<string> {
  const response = await client.request<{ accessToken: string }>(
    'POST',
    '/auth/login',
    { body: { email, password: E2E_PASSWORD } }
  );

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `No se pudo autenticar ${email}: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return response.body.accessToken;
}
