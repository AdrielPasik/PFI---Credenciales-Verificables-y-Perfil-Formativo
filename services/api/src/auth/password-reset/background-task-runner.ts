import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional
} from '@nestjs/common';

import {
  BACKGROUND_DRAIN_TIMEOUT_MS,
  MAX_BACKGROUND_TASKS_IN_FLIGHT
} from './password-reset.limits';

/** Token de inyeccion del tope de espera (solo para tests). Va ANTES de la clase:
 * el decorador `@Inject(...)` se evalua al definirla. */
export const BACKGROUND_DRAIN_TIMEOUT = Symbol('BACKGROUND_DRAIN_TIMEOUT_MS');

/**
 * Desprende un trabajo del request que lo origino.
 *
 * POR QUE EXISTE. `POST /auth/password-reset/request` responde 202 SIN esperar a
 * que se busque la cuenta ni a que se envie el correo. Si esperara, el tiempo de
 * respuesta delataria si la cuenta existe (con cuenta: busqueda + escrituras + una
 * llamada al proveedor; sin cuenta: nada). El trabajo corre despues, y la
 * respuesta es la misma sea cual sea su resultado.
 *
 * COMO. `setImmediate` difiere el inicio al siguiente turno del event loop, asi el
 * handler devuelve y Nest serializa la respuesta antes de que el trabajo empiece.
 * Una llamada `async` sin `await` NO alcanzaria: su parte sincronica corre dentro
 * del request y un rechazo no manejado seria una `unhandledRejection`. Aca:
 *
 *   * todo error se captura y se registra SIN su mensaje (los mensajes de Prisma o
 *     de un proveedor pueden incluir datos);
 *   * ninguna promesa puede rechazar;
 *   * hay un techo de trabajos en vuelo, para que una rafaga no acumule memoria.
 *
 * ES BEST-EFFORT, NO DURADERO. El trabajo vive en la memoria de ESTE proceso. Si el
 * proceso termina despues del 202 y antes del envio (un deploy, un OOM, un
 * `SIGKILL`), el trabajo se pierde sin dejar rastro y el correo no sale. Responder
 * 202 significa "recibimos tu pedido", NUNCA "el correo fue enviado". La persona lo
 * resuelve volviendo a pedirlo.
 *
 * CIERRE ORDENADO. `main.ts` llama a `app.enableShutdownHooks()`: ante `SIGTERM` o
 * `SIGINT` Nest ejecuta `onModuleDestroy`, que (1) deja de aceptar trabajos nuevos y
 * (2) espera a los que estan en vuelo, hasta un tope de tiempo. Esto REDUCE la
 * ventana de perdida; NO la elimina: ante `SIGKILL`, un OOM o la destruccion abrupta
 * de la task, el trabajo en vuelo se pierde igual. La entrega sigue siendo
 * best-effort, no una cola duradera.
 *
 * El tope de espera tiene que ser MENOR que el `stopTimeout` de ECS (120 s en el
 * Terraform del repo): pasado ese plazo ECS envia `SIGKILL` de todos modos.
 *
 * Una cola duradera (SQS, una tabla de outbox) cambiaria esta garantia. No se
 * introduce para este volumen; es la alternativa si "best-effort" deja de alcanzar.
 */
@Injectable()
export class BackgroundTaskRunner implements OnModuleDestroy {
  private readonly logger = new Logger('BackgroundTaskRunner');
  private readonly inFlight = new Set<Promise<void>>();
  private readonly drainTimeoutMs: number;
  private closing = false;

  /** `drainTimeoutMs` solo se inyecta en los tests; en produccion rige el default. */
  constructor(
    @Optional()
    @Inject(BACKGROUND_DRAIN_TIMEOUT)
    drainTimeoutMs?: number
  ) {
    this.drainTimeoutMs = drainTimeoutMs ?? BACKGROUND_DRAIN_TIMEOUT_MS;
  }

  /** `true` desde que empezo el cierre: ya no se aceptan trabajos nuevos. */
  get isClosing(): boolean {
    return this.closing;
  }

  /** Cantidad de trabajos en vuelo. Para tests y diagnostico. */
  get pending(): number {
    return this.inFlight.size;
  }

  run(name: string, task: () => Promise<void>): void {
    // Durante el cierre el trabajo nuevo NO se acepta: arrancarlo ahora lo dejaria a
    // medio hacer cuando el proceso termine. Es el caso de un `request` que llega
    // despues de `SIGTERM` pero antes de que el servidor deje de escuchar.
    if (this.closing) {
      this.logger.warn(`${name} dropped (shutting down)`);
      return;
    }

    if (this.inFlight.size >= MAX_BACKGROUND_TASKS_IN_FLIGHT) {
      // Sin datos del trabajo: solo su nombre fijo.
      this.logger.warn(`${name} dropped (too many in flight)`);
      return;
    }

    const tracked = new Promise<void>((resolve) => {
      setImmediate(() => {
        void (async () => {
          try {
            await task();
          } catch (error) {
            // Solo el NOMBRE del error. `error.message` queda afuera a proposito.
            this.logger.error(`${name} failed (${describeError(error)})`);
          } finally {
            resolve();
          }
        })();
      });
    });

    this.inFlight.add(tracked);
    // `tracked` nunca rechaza: no hay promesa colgada sin manejar.
    void tracked.then(() => {
      this.inFlight.delete(tracked);
    });
  }

  /** Resuelve cuando no queda ningun trabajo en vuelo (o vence `timeoutMs`). */
  async idle(timeoutMs?: number): Promise<void> {
    const drain = (async () => {
      while (this.inFlight.size > 0) {
        await Promise.all([...this.inFlight]);
      }
    })();

    if (timeoutMs === undefined) {
      await drain;
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    });

    try {
      await Promise.race([drain, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Primero se cierra la puerta; recien despues se espera. Al reves, un trabajo
    // podria colarse entre el drenaje y el cierre.
    this.closing = true;

    const pending = this.inFlight.size;

    if (pending === 0) {
      return;
    }

    this.logger.log(`drain.started (${pending} in flight, up to ${this.drainTimeoutMs}ms)`);
    await this.idle(this.drainTimeoutMs);

    const remaining = this.inFlight.size;

    if (remaining > 0) {
      // Observable: son recuperaciones que NO se completaron por el cierre. Siguen
      // corriendo hasta que el proceso termine y pueden perderse.
      this.logger.warn(
        `drain.timeout (${remaining} still running after ${this.drainTimeoutMs}ms; they may be lost)`
      );
      return;
    }

    this.logger.log('drain.completed');
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Los errores conocidos de Prisma llevan un codigo estable (P2002...) que no
    // es un dato del usuario.
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
      ? `${error.name}:${code}`
      : error.name;
  }

  return 'non-error thrown';
}
