/**
 * Servidor Nest REAL para las suites de HTTP, configuracion y ciclo de vida.
 *
 * Levanta el `AuthModule` verdadero (controllers, guards de throttling, `MailModule`,
 * `JwtModule`, `BackgroundTaskRunner`) en 127.0.0.1 con puerto efimero. Lo unico
 * simulado es la base: el doble de Prisma con estado.
 *
 * Los transportes `resend` creados por `MailModule` usan el `fetch` GLOBAL (resuelto
 * en cada llamada): las suites que los ejercitan reemplazan `globalThis.fetch` con
 * `installFetchStub` y nunca llegan a la red.
 */

import type { AddressInfo } from 'node:net';

import { Controller, Get, Global, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { MAIL_TRANSPORT, type MailTransport } from '../../../mail/mail-transport';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthGuard } from '../../auth.guard';
import { AuthModule } from '../../auth.module';
import { CurrentUser } from '../../current-user.decorator';
import { type AuthenticatedUser } from '../../auth.types';
import { applyTrustProxy } from '../../trust-proxy.config';
import {
  BACKGROUND_DRAIN_TIMEOUT,
  BackgroundTaskRunner
} from '../background-task-runner';
import { createAuthWorld, type AuthWorld } from './auth-world';

export interface StartAppOptions {
  hops?: number;
  /** `MAIL_TRANSPORT` y `NODE_ENV` al CREAR el modulo (ahi se elige el transporte). */
  mailTransport?: string;
  nodeEnv?: string;
  /** Variables extra, solo durante la creacion (p. ej. RESEND_API_KEY, MAIL_FROM). */
  env?: Record<string, string | undefined>;
  /** Tope de drenaje del runner. Por defecto, el de produccion. */
  drainTimeoutMs?: number;
  world?: AuthWorld;
}

export interface CallResult {
  status: number;
  json: Record<string, unknown> | undefined;
  text: string;
  headers: Headers;
}

export async function startApp(options: StartAppOptions = {}) {
  const overrides: Record<string, string | undefined> = {
    MAIL_TRANSPORT: options.mailTransport,
    NODE_ENV: options.nodeEnv,
    ...options.env
  };
  const originals = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(overrides)) {
    originals.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  const world = options.world ?? createAuthWorld();
  /** Orden en que se destruyen las piezas al cerrar. */
  const lifecycle: string[] = [];

  // Un `onModuleDestroy` sobre el doble: `PrismaService` real hace `$disconnect()`.
  (world.prisma as Record<string, unknown>).onModuleDestroy = async () => {
    lifecycle.push('prisma-disconnect');
  };

  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: world.prisma },
      ...(options.drainTimeoutMs !== undefined
        ? [{ provide: BACKGROUND_DRAIN_TIMEOUT, useValue: options.drainTimeoutMs }]
        : [])
    ],
    exports: [
      PrismaService,
      ...(options.drainTimeoutMs !== undefined ? [BACKGROUND_DRAIN_TIMEOUT] : [])
    ]
  })
  class FakePrismaModule {}

  // Una ruta protegida minima, para comprobar sesiones viejas y nuevas por HTTP.
  @Controller('probe')
  class ProbeController {
    @Get()
    @UseGuards(AuthGuard)
    whoAmI(@CurrentUser() user: AuthenticatedUser) {
      return { id: user.id };
    }
  }

  @Module({ imports: [FakePrismaModule, AuthModule], controllers: [ProbeController] })
  class TestAppModule {}

  let app: NestExpressApplication;

  try {
    // SIN `{ logger: false }`: esa opcion llama a `Logger.overrideLogger(false)` y
    // desinstala la captura de logs de las suites. Las suites que usan este arnes
    // instalan `installLogCapture()`, que ya silencia la consola.
    app = await NestFactory.create<NestExpressApplication>(TestAppModule);
    applyTrustProxy(app, options.hops ?? 0);
    await app.listen(0, '127.0.0.1');
  } finally {
    // La seleccion del transporte ya ocurrio al crear el modulo.
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const runner = app.get(BackgroundTaskRunner);
  const originalDestroy = runner.onModuleDestroy.bind(runner);

  // Marca cuando el runner termina de drenar, para compararlo con Prisma.
  runner.onModuleDestroy = async () => {
    lifecycle.push('runner-drain-start');
    await originalDestroy();
    lifecycle.push('runner-drain-end');
  };

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<CallResult> {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    const text = await response.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  return {
    app,
    world,
    lifecycle,
    tasks: runner,
    transport: app.get(MAIL_TRANSPORT, { strict: false }) as MailTransport & {
      outbox?: Array<{ text: string }>;
    },
    post: (path: string, body?: unknown, headers?: Record<string, string>) =>
      call('POST', path, body, headers),
    get: (path: string, headers?: Record<string, string>) => call('GET', path, undefined, headers),
    close: () => app.close()
  };
}

export type Server = Awaited<ReturnType<typeof startApp>>;

export async function withApp(
  options: StartAppOptions,
  run: (server: Server) => Promise<void>
): Promise<void> {
  const server = await startApp(options);

  try {
    await run(server);
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// fetch simulado: ninguna prueba toca la red
// ---------------------------------------------------------------------------

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type FetchResponder = (call: RecordedCall) => Response | Promise<Response>;

/**
 * Reemplaza `globalThis.fetch`. Las llamadas a `127.0.0.1` (el propio servidor de
 * prueba) pasan al `fetch` real; CUALQUIER otra URL se atiende con `respond` y queda
 * registrada. Una URL que `respond` no esperaba no sale a internet: se registra y
 * responde 599 para que el test falle en voz alta.
 */
export function installFetchStub(respond: FetchResponder) {
  const realFetch = globalThis.fetch;
  const calls: RecordedCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith('http://127.0.0.1')) {
      return realFetch(input, init);
    }

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const call: RecordedCall = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : ''
    };
    calls.push(call);

    if (!url.startsWith('https://api.resend.com/')) {
      return new Response('unexpected host in test', { status: 599 });
    }

    return respond(call);
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    }
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
