import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { PasswordResetError } from './password-reset.errors';
import {
  REQUEST_THROTTLE_LIMIT,
  THROTTLE_WINDOW_MS,
  TOKEN_THROTTLE_LIMIT
} from './password-reset.limits';

type HandleRequestProps = Parameters<ThrottlerGuard['handleRequest']>[0];

/**
 * Limite por IP de los endpoints publicos de recuperacion.
 *
 * SE APLICA SOLO AQUI, con `@UseGuards` en el controller de recuperacion. No hay un
 * `APP_GUARD`: login, registro y el resto del API no tienen ningun limite nuevo.
 *
 * El politica (cuantos y en que ventana) vive EN la clase, no en decoradores
 * dispersos por los handlers, y se impone sobreescribiendo `handleRequest`: un
 * handler nuevo que olvide un `@Throttle` no hereda un limite equivocado.
 *
 * CONTADOR COMPARTIDO. La clave por defecto del throttler incluye el nombre del
 * handler (`Clase-metodo-nombre-ip`), lo que daria a `verify` y a `confirm` dos
 * contadores independientes. Se sobreescribe `generateKey` para que la clave sea
 * `ambito + IP`: todos los handlers del mismo ambito comparten UN contador.
 *
 * IP. `getTracker` (heredado) usa `req.ip` normalizado. Que `req.ip` sea la del
 * cliente real o la del ALB depende de `TRUST_PROXY_HOPS` (ver `trust-proxy.config`).
 *
 * ALMACENAMIENTO EN MEMORIA, POR PROCESO. El storage por defecto del throttler es un
 * `Map` local. Con mas de una task de ECS cada una cuenta por separado, y el limite
 * efectivo por IP es de hasta N veces el configurado. Un reinicio lo pone a cero.
 * NO es un limite distribuido; el cupo por cuenta y el global (en PostgreSQL) si
 * valen entre instancias.
 *
 * Superado el limite el cliente queda bloqueado durante una ventana completa
 * (`blockDuration` = ventana) y el throttler agrega `Retry-After`.
 */
abstract class PasswordResetThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly scope: string;
  protected abstract readonly limit: number;

  protected override async handleRequest(
    requestProps: HandleRequestProps
  ): Promise<boolean> {
    return super.handleRequest({
      ...requestProps,
      limit: this.limit,
      ttl: THROTTLE_WINDOW_MS,
      blockDuration: THROTTLE_WINDOW_MS
    });
  }

  protected override generateKey(
    _context: unknown,
    tracker: string,
    throttlerName: string
  ): string {
    return createHash('sha256')
      .update(`password-reset:${this.scope}:${throttlerName}:${tracker}`)
      .digest('hex');
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new PasswordResetError('TOO_MANY_REQUESTS');
  }
}

/** `POST /auth/password-reset/request`: 5 por 15 minutos por IP. */
@Injectable()
export class PasswordResetRequestThrottlerGuard extends PasswordResetThrottlerGuard {
  protected readonly scope = 'request';
  protected readonly limit = REQUEST_THROTTLE_LIMIT;
}

/** `verify` y `confirm`: 20 por 15 minutos por IP, UN contador entre los dos. */
@Injectable()
export class PasswordResetTokenThrottlerGuard extends PasswordResetThrottlerGuard {
  protected readonly scope = 'token';
  protected readonly limit = TOKEN_THROTTLE_LIMIT;
}
