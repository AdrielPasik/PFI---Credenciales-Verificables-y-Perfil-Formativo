/**
 * Arnes de las suites de recuperacion: el servicio REAL, el ejecutor de segundo
 * plano REAL, el transporte `log` REAL (con su gancho de simulacion) y el doble de
 * Prisma con estado.
 */

import assert from 'node:assert/strict';

import { type LoggerService, Logger } from '@nestjs/common';

import { LogMailTransport } from '../../../mail/log-mail-transport';
import type { MailMessage, MailTransport } from '../../../mail/mail-transport';
import { BackgroundTaskRunner } from '../background-task-runner';
import { PasswordResetService } from '../password-reset.service';
import { createAuthWorld, type AuthWorldOptions } from './auth-world';

export const WEB_ORIGIN = 'https://app.scope.test';
export const NEW_PASSWORD = 'BrandNewPassword456';
export const OLD_PASSWORD = 'OldPassword123';
export const LINK_PATTERN = /\/reset-password#token=([A-Za-z0-9_-]{43})/;

/** Deja el entorno en el estado "recuperacion configurada en desarrollo". */
export function configureRecoveryEnv(): void {
  process.env.WEB_PUBLIC_BASE_URL = WEB_ORIGIN;
  process.env.JWT_SECRET = 'recovery-test-secret';
  delete process.env.NODE_ENV;
  delete process.env.MAIL_TRANSPORT;
  delete process.env.JWT_EXPIRES_IN;
  delete process.env.PUBLIC_DID_BASE_URL;
}

// ---------------------------------------------------------------------------
// Captura de logs de Nest
// ---------------------------------------------------------------------------

export function installLogCapture(): string[] {
  const lines: string[] = [];
  const capture = (level: string) => (message: unknown, ...rest: unknown[]) => {
    lines.push(
      `${level}|${typeof message === 'string' ? message : JSON.stringify(message)}|${JSON.stringify(rest)}`
    );
  };
  const logger: LoggerService = {
    log: capture('log'),
    error: capture('error'),
    warn: capture('warn'),
    debug: capture('debug'),
    verbose: capture('verbose')
  };

  Logger.overrideLogger(logger);
  return lines;
}

// ---------------------------------------------------------------------------
// Servicio ensamblado
// ---------------------------------------------------------------------------

export interface Recovery {
  world: ReturnType<typeof createAuthWorld>;
  service: PasswordResetService;
  tasks: BackgroundTaskRunner;
  transport: LogMailTransport;
  /** Cambiar `beforeSend` simula fallos del proveedor. */
  behavior: { beforeSend: (message: MailMessage) => void | Promise<void> };
  /** Transacciones abiertas en el instante exacto de cada envio. */
  openTransactionsAtSend: number[];
  /** Pide la recuperacion y espera a que el trabajo en segundo plano termine. */
  request(email: string): Promise<{ status: 'requested' }>;
  /** Token del ultimo correo "enviado", extraido del enlace. */
  lastToken(): string;
  /** Claves de los advisory locks pedidos, en orden. */
  rawKeys(): unknown[];
}

export function buildRecovery(
  options: AuthWorldOptions & { transport?: MailTransport } = {}
): Recovery {
  const world = createAuthWorld(options);
  const openTransactionsAtSend: number[] = [];
  const behavior: Recovery['behavior'] = { beforeSend: () => undefined };
  const transport = new LogMailTransport({
    write: () => undefined,
    beforeSend: (message) => {
      openTransactionsAtSend.push(world.openTransactions);
      return behavior.beforeSend(message);
    }
  });
  const tasks = new BackgroundTaskRunner();
  const service = new PasswordResetService(
    world.prisma as never,
    options.transport ?? transport,
    tasks,
    world.now
  );

  return {
    world,
    service,
    tasks,
    transport,
    behavior,
    openTransactionsAtSend,
    async request(email) {
      const response = service.requestReset({ email });
      await tasks.idle();
      return response;
    },
    rawKeys() {
      return world.rawQueries.map((query) => query.values[0]);
    },
    lastToken() {
      const message = transport.outbox.at(-1);
      assert.ok(message, 'no se envio ningun correo');
      const match = LINK_PATTERN.exec(message.text);
      assert.ok(match, 'el correo no contiene un enlace de recuperacion');
      return match[1];
    }
  };
}

export function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

export function statusOf(error: unknown): number | undefined {
  return (error as { getStatus?: () => number } | null)?.getStatus?.();
}
