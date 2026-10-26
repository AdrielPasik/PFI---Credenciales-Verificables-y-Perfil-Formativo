import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import {
  MAIL_TRANSPORT,
  MailDeliveryError,
  type MailTransport
} from '../../mail/mail-transport';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../password-hashing';
import { BackgroundTaskRunner } from './background-task-runner';
import {
  buildPasswordResetLink,
  resolveWebPublicBaseUrl
} from './password-reset.config';
import { buildPasswordResetEmail } from './password-reset-email';
import { PasswordResetError } from './password-reset.errors';
import {
  ACCOUNT_COOLDOWN_MS,
  ACCOUNT_QUOTA_MAX,
  ACCOUNT_QUOTA_WINDOW_MS,
  CONFIRM_TRANSACTION_OPTIONS,
  GLOBAL_QUOTA_MAX,
  GLOBAL_QUOTA_WINDOW_MS,
  ISSUE_TRANSACTION_OPTIONS,
  PASSWORD_RESET_ISSUE_LOCK_KEY,
  PASSWORD_RESET_RETENTION_MS,
  PASSWORD_RESET_TTL_MS
} from './password-reset.limits';
import {
  generatePasswordResetToken,
  hashPasswordResetToken
} from './password-reset-token';
import {
  parseConfirmBody,
  parseRequestResetBody,
  parseVerifyBody
} from './password-reset.validator';

/** Reloj inyectable: los tests fijan el tiempo; en produccion es `new Date()`. */
export type PasswordResetClock = () => Date;
export const PASSWORD_RESET_CLOCK = Symbol('PASSWORD_RESET_CLOCK');

/** Por que una solicitud elegible NO produjo un token. Solo para logs internos. */
export type DropReason = 'cooldown' | 'account_quota' | 'global_cap';

type Reservation =
  | { reserved: true; tokenId: string; token: string }
  | { reserved: false; reason: DropReason };

/**
 * Recuperacion de contrasena por enlace.
 *
 * TODA la autoridad de autenticacion de este flujo es de este servicio y de la base:
 * la web solo presenta un token y recibe un si o un no. Nada de lo que el cliente
 * envie (id, email en el confirm, version de sesion) decide quien es el usuario: se
 * resuelve unicamente a partir del token.
 *
 * MODELO DE CONFIANZA -- LEER. Scope no verifica que una persona sea duena del email
 * con el que se registra. Esta recuperacion convierte el CONTROL DEL BUZON en
 * autoridad sobre la cuenta. Eso significa que: (1) quien controle el buzon asociado
 * a una cuenta puede tomarla aunque nunca haya sido quien la registro; (2) controlar
 * un email NO demuestra quien creo originalmente la cuenta; (3) si alguien se
 * registro con un email ajeno por error, el dueno real de ese buzon puede recuperar
 * esa cuenta y ver las credenciales educativas que tenga asociadas. Esto es
 * coherente con el modelo actual (una institucion emite a un titular resolviendolo
 * por email), pero es una decision de confianza que debe aceptarse expresamente, o
 * mitigarse con verificacion de email, ANTES de habilitar el flujo en produccion.
 *
 * ENUMERACION. Esta superficie no agrega ningun oraculo: `request` responde igual
 * exista o no la cuenta. NO elimina los que ya existian -- `POST /auth/register`
 * sigue respondiendo 409 para un email registrado, y el tiempo de `login` difiere
 * segun la cuenta exista o no. La existencia de una cuenta sigue siendo deducible
 * por esos caminos.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');
  private readonly now: PasswordResetClock;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    private readonly tasks: BackgroundTaskRunner,
    @Optional() @Inject(PASSWORD_RESET_CLOCK) clock?: PasswordResetClock
  ) {
    this.now = clock ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------
  // POST /auth/password-reset/request
  // ---------------------------------------------------------------------------

  /**
   * Valida, comprueba que la funcionalidad este disponible, desprende el trabajo y
   * responde. NO consulta la base: la respuesta (y su tiempo) no puede depender de
   * que la cuenta exista.
   *
   * Diferencia de tiempo residual que no se puede excluir: el trabajo desprendido
   * corre en el MISMO event loop, asi que una solicitud con cuenta (consultas y
   * una llamada al proveedor) deja el proceso algo mas ocupado que una sin cuenta, y
   * eso podria alterar apenas la latencia de requests CONCURRENTES. Es un canal muy
   * ruidoso y de bajo ancho de banda; no se afirma que sea nulo.
   */
  requestReset(body: unknown): { status: 'requested' } {
    const { email } = parseRequestResetBody(body);
    const webOrigin = this.requireAvailability();

    this.tasks.run('password-reset.request', () =>
      this.processRequest(email, webOrigin)
    );
    this.logger.log('request.accepted');

    return { status: 'requested' };
  }

  /**
   * 503 si no hay manera de entregar un enlace. Se evalua ANTES de emitir nada: no se
   * crean autorizaciones que nunca podran llegar a una persona. Depende solo de la
   * configuracion, no de la cuenta, asi que no es un oraculo.
   */
  private requireAvailability(): string {
    // Durante el cierre de la app el runner ya no acepta trabajo. Nest ejecuta los
    // hooks de destruccion ANTES de cerrar el servidor HTTP, asi que un request puede
    // llegar en esa ventana: responderle 202 seria reconocer un pedido que se va a
    // descartar. Un 503 (el mismo estado y codigo de "recuperacion no disponible")
    // le dice al cliente que reintente. Depende solo del estado del proceso, no de la
    // cuenta: no es un oraculo.
    if (this.tasks.isClosing) {
      this.logger.warn('recovery.unavailable (shutting_down)');
      throw new PasswordResetError('PASSWORD_RECOVERY_UNAVAILABLE');
    }

    const web = resolveWebPublicBaseUrl(process.env);

    if (!web.ok) {
      this.logger.warn(`recovery.unavailable (web_url:${web.reason})`);
      throw new PasswordResetError('PASSWORD_RECOVERY_UNAVAILABLE');
    }

    if (!this.mail.operational) {
      this.logger.warn('recovery.unavailable (mail_transport)');
      throw new PasswordResetError('PASSWORD_RECOVERY_UNAVAILABLE');
    }

    return web.origin;
  }

  private async processRequest(email: string, webOrigin: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          status: true,
          authCredential: { select: { id: true } }
        }
      });

      // Sin cuenta, cuenta no activa o sin credencial: nada que recuperar. Se
      // descarta en silencio; el cliente ya recibio su 202.
      if (!user || user.status !== UserStatus.active || !user.authCredential) {
        this.logger.log('request.dropped (ineligible)');
        return;
      }

      // El envio NO ocurre dentro de la transaccion: el lock se libera antes de
      // hablar con ningun proveedor.
      const reservation = await this.reserve(user.id);

      if (!reservation.reserved) {
        // El cooldown es lo normal (un doble clic, un reintento). Las dos cuotas NO:
        // son la senal de que alguien esta agotando un presupuesto, y por eso suben
        // a `warn` -- el unico lugar donde un operador puede enterarse, porque la
        // respuesta publica es la misma 202 de siempre.
        if (reservation.reason === 'cooldown') {
          this.logger.log(`request.dropped (${reservation.reason})`);
        } else {
          this.logger.warn(`request.dropped (${reservation.reason})`);
        }
        return;
      }

      await this.deliver(email, webOrigin, reservation);
    } catch (error) {
      // Nunca `error.message`: un error de Prisma puede incluir el email buscado.
      this.logger.error(`request.failed (${errorLabel(error)})`);
    }
  }

  /**
   * EMISION: aplica las cuotas, invalida los enlaces anteriores y crea el nuevo, todo
   * bajo un advisory lock transaccional.
   *
   * POR QUE EL LOCK. "Invalidar y crear dentro de una transaccion" NO basta. En READ
   * COMMITTED, dos transacciones pueden leer a la vez "esta cuenta no tiene token
   * vigente", ambas invalidar cero filas e insertar cada una el suyo: quedan DOS
   * vigentes. El mismo defecto rompe el tope global: dos transacciones leen "79 de
   * 80" e insertan las dos, y quedan 81.
   *
   * `pg_advisory_xact_lock(clave)` serializa: la segunda transaccion se queda
   * esperando en la primera sentencia hasta que la primera termina (commit o
   * rollback), y como READ COMMITTED toma una instantanea nueva por sentencia, los
   * `count` que ejecuta DESPUES del lock ya ven las filas que la primera confirmo.
   *
   *   Intercalacion que evita (cuenta):  T1 cuenta 0 / T2 cuenta 0 / T1 inserta /
   *                                      T2 inserta  =>  dos vigentes.
   *   Intercalacion que evita (global):  T1 cuenta 79 / T2 cuenta 79 / T1 inserta /
   *                                      T2 inserta  =>  81 > 80.
   *
   * UN lock GLOBAL y no uno por usuario, a proposito: uno por usuario protege "a lo
   * sumo un vigente por cuenta" pero NO el tope global, porque dos cuentas distintas
   * no se bloquean entre si. El volumen previsto es de decenas de emisiones por dia,
   * asi que serializarlas todas cuesta microsegundos de espera.
   *
   * Efectos sobre concurrencia y latencia: el lock cubre SOLO esta transaccion (cinco
   * o seis sentencias indexadas, milisegundos) y se libera solo al terminar. No cubre
   * el envio del correo, ni scrypt, ni afecta a ningun otro modulo (la clave esta
   * reservada para esta responsabilidad). Una emision lenta demoraria a las demas
   * emisiones y a ninguna otra operacion.
   *
   * LAS CUOTAS CUENTAN FILAS EMITIDAS (incluidas las invalidadas, consumidas o cuyo
   * envio fallo): un fallo de entrega no devuelve cupo.
   */
  private async reserve(userId: string): Promise<Reservation> {
    // Se genera FUERA de la transaccion: no hace falta retener el lock para eso.
    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);

    return this.prisma.$transaction(async (tx): Promise<Reservation> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PASSWORD_RESET_ISSUE_LOCK_KEY}::bigint)`;

      // Todo el tiempo se toma DESPUES de adquirir el lock: lo que esperamos por
      // el no cuenta contra las ventanas.
      const now = this.now();

      const last = await tx.passwordResetToken.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      });

      if (last && now.getTime() - last.createdAt.getTime() < ACCOUNT_COOLDOWN_MS) {
        return { reserved: false, reason: 'cooldown' };
      }

      const accountCount = await tx.passwordResetToken.count({
        where: {
          userId,
          createdAt: { gt: new Date(now.getTime() - ACCOUNT_QUOTA_WINDOW_MS) }
        }
      });

      if (accountCount >= ACCOUNT_QUOTA_MAX) {
        return { reserved: false, reason: 'account_quota' };
      }

      const globalCount = await tx.passwordResetToken.count({
        where: {
          createdAt: { gt: new Date(now.getTime() - GLOBAL_QUOTA_WINDOW_MS) }
        }
      });

      if (globalCount >= GLOBAL_QUOTA_MAX) {
        return { reserved: false, reason: 'global_cap' };
      }

      // Solo un enlace vigente por cuenta: el anterior deja de servir.
      await tx.passwordResetToken.updateMany({
        where: { userId, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now }
      });

      // Higiene acotada a ESTA cuenta; las ventanas de cuota son <= 24 h, asi que
      // borrar lo de mas de 7 dias no altera ningun conteo.
      await tx.passwordResetToken.deleteMany({
        where: {
          userId,
          createdAt: { lt: new Date(now.getTime() - PASSWORD_RESET_RETENTION_MS) }
        }
      });

      const created = await tx.passwordResetToken.create({
        data: {
          userId,
          tokenHash,
          // Con el reloj de la aplicacion (no el DEFAULT de la base): las ventanas
          // se calculan con el mismo reloj con el que se escriben.
          createdAt: now,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS)
        },
        select: { id: true }
      });

      return { reserved: true, tokenId: created.id, token };
    }, ISSUE_TRANSACTION_OPTIONS);
  }

  /**
   * ENTREGA. Corre FUERA de la transaccion de emision.
   *
   * Que hacer con el token segun como falle el envio:
   *
   *   not_sent / rejected  el mensaje NO salio: nadie tiene el enlace. Se invalida el
   *                        token (higiene: no queda una autorizacion vigente que
   *                        nadie puede usar). El cupo NO se devuelve.
   *   ambiguous            timeout, corte o 5xx: el proveedor PUDO haberlo aceptado.
   *                        Se deja el token VIGENTE. Invalidarlo podria dejar a una
   *                        persona con un enlace en el buzon que ya no sirve, sin
   *                        modo de saberlo. El costo de dejarlo es nulo: expira solo
   *                        a los 30 minutos y un reintento lo reemplaza.
   *   error no tipado      se trata como ambiguo (la opcion que no puede danar).
   */
  private async deliver(
    email: string,
    webOrigin: string,
    reservation: { tokenId: string; token: string }
  ): Promise<void> {
    const link = buildPasswordResetLink(webOrigin, reservation.token);

    try {
      await this.mail.send(
        buildPasswordResetEmail({
          to: email,
          link,
          // Estable por autorizacion (el id de la fila, no el token ni su hash) y
          // distinta para cada una: un reintento del MISMO envio reutiliza la clave y
          // el proveedor lo deduplica; una solicitud nueva es otra fila, otra clave.
          idempotencyKey: `password-reset/${reservation.tokenId}`
        })
      );
      this.logger.log(`email.sent (token ${reservation.tokenId})`);
    } catch (error) {
      const kind = error instanceof MailDeliveryError ? error.kind : 'ambiguous';

      if (kind === 'ambiguous') {
        this.logger.warn(`email.ambiguous (token ${reservation.tokenId})`);
        return;
      }

      this.logger.warn(`email.failed:${kind} (token ${reservation.tokenId})`);
      await this.invalidateUndelivered(reservation.tokenId);
    }
  }

  private async invalidateUndelivered(tokenId: string): Promise<void> {
    try {
      await this.prisma.passwordResetToken.updateMany({
        where: { id: tokenId, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: this.now() }
      });
    } catch (error) {
      this.logger.error(`token.invalidate_failed (${errorLabel(error)})`);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /auth/password-reset/verify
  // ---------------------------------------------------------------------------

  /**
   * Responde si el token sigue vigente. ESTRICTAMENTE DE LECTURA: no consume, no
   * invalida, no toca nada. Es lo que permite a la web decidir si muestra el
   * formulario de contrasena nueva sin quemar el enlace.
   */
  async verifyToken(body: unknown): Promise<{ status: 'valid' }> {
    const { token } = parseVerifyBody(body);
    await this.requireUsableToken(hashPasswordResetToken(token));

    return { status: 'valid' };
  }

  // ---------------------------------------------------------------------------
  // POST /auth/password-reset/confirm
  // ---------------------------------------------------------------------------

  /**
   * Consume el token y cambia la contrasena en UNA transaccion.
   *
   * El hash de la contrasena (scrypt, costoso) se calcula ANTES de abrir la
   * transaccion: no se retiene ninguna fila bloqueada mientras corre.
   *
   * La garantia de "exactamente un consumo" es un UPDATE condicional
   * (`consumedAt: null`, `invalidatedAt: null`, `expiresAt > ahora`, cuenta activa)
   * cuyo conteo de filas tiene que ser 1. Dos confirmaciones del mismo token chocan
   * en la misma fila: la segunda espera el lock de fila de la primera y, al
   * confirmarse esta, vuelve a evaluar el WHERE -- ya no se cumple -- y afecta 0
   * filas. Cualquier conteo distinto de 1 revierte TODO: la contrasena y
   * `sessionVersion` cambian si y solo si el consumo tuvo exito.
   *
   * Sin auto-login: no emite ningun JWT. La persona inicia sesion con la contrasena
   * nueva.
   */
  async confirmReset(body: unknown): Promise<{ status: 'password_reset' }> {
    // Forma, token y politica de contrasena, ANTES de cualquier trabajo costoso.
    const { token, password } = parseConfirmBody(body);
    const tokenHash = hashPasswordResetToken(token);

    // Preverificacion barata: un token inexistente no gasta un scrypt.
    const record = await this.requireUsableToken(tokenHash);

    const passwordHash = await hashPassword(password);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Se toma el tiempo AHORA, despues de scrypt: un token que vencio mientras
        // se hasheaba no se consume.
        const now = this.now();

        const consumed = await tx.passwordResetToken.updateMany({
          where: {
            id: record.id,
            consumedAt: null,
            invalidatedAt: null,
            expiresAt: { gt: now },
            user: { is: { status: UserStatus.active } }
          },
          data: { consumedAt: now }
        });

        if (consumed.count !== 1) {
          throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID');
        }

        const credential = await tx.authCredential.updateMany({
          where: { userId: record.userId },
          data: {
            passwordHash,
            // Invalida TODOS los JWT emitidos antes (ver `resolveAuthenticatedUser`).
            sessionVersion: { increment: 1 }
          }
        });

        if (credential.count !== 1) {
          // Sin credencial no hay nada que actualizar: se revierte, incluido el
          // consumo recien hecho.
          throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID');
        }

        // Cualquier otro enlace vigente de la cuenta deja de servir. El que se
        // acaba de consumir ya tiene `consumedAt`, asi que el filtro lo excluye.
        await tx.passwordResetToken.updateMany({
          where: { userId: record.userId, consumedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now }
        });
      }, CONFIRM_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof PasswordResetError) {
        this.logger.warn('confirm.rejected (not_consumable)');
      } else {
        this.logger.error(`confirm.failed (${errorLabel(error)})`);
      }

      throw error;
    }

    this.logger.log(`confirm.succeeded (user ${record.userId})`);

    return { status: 'password_reset' };
  }

  // ---------------------------------------------------------------------------
  // Compartido por verify y confirm
  // ---------------------------------------------------------------------------

  /**
   * Busca el token por su hash y comprueba TODAS las condiciones de vigencia. Si
   * alguna falla, el mismo error: no se distingue inexistente de vencido de
   * consumido de invalidado de cuenta no elegible.
   */
  private async requireUsableToken(
    tokenHash: string
  ): Promise<{ id: string; userId: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        consumedAt: true,
        invalidatedAt: true,
        user: {
          select: {
            status: true,
            authCredential: { select: { id: true } }
          }
        }
      }
    });

    const usable =
      record !== null &&
      record.consumedAt === null &&
      record.invalidatedAt === null &&
      record.expiresAt.getTime() > this.now().getTime() &&
      record.user.status === UserStatus.active &&
      record.user.authCredential !== null;

    if (!usable) {
      throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID');
    }

    return { id: record.id, userId: record.userId };
  }
}

/** Solo el nombre (y el codigo estable de Prisma). Jamas `message`. */
function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
      ? `${error.name}:${code}`
      : error.name;
  }

  return 'non-error thrown';
}
