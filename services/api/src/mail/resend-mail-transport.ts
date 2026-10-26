import { Logger } from '@nestjs/common';

import {
  MailDeliveryError,
  type MailMessage,
  type MailTransport
} from './mail-transport';

/**
 * Transporte de correo sobre la API HTTPS de Resend.
 *
 * Contrato (docs oficiales de Resend, consultadas para esta implementacion):
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <API key>        Content-Type: application/json
 *   Idempotency-Key: <1..256 caracteres>   (opcional; ventana de deduplicacion de 24 h)
 *   body: { from, to, subject, html, text }
 *   200 -> { "id": "<uuid>" }
 *
 * `fetch` nativo de Node: ningun SDK ni cliente HTTP adicional.
 *
 * SOLO ENTREGA. Este adaptador no sabe nada de tokens, contrasenas, sesiones ni de
 * quien es la persona: recibe un mensaje ya armado, lo envia y comunica si salio.
 * El dominio decide que hacer con ese resultado (ver `PasswordResetService.deliver`).
 *
 * ---------------------------------------------------------------------------
 * CLASIFICACION DE RESULTADOS -- la parte que importa
 * ---------------------------------------------------------------------------
 *
 * Se clasifica por STATUS HTTP y no por el cuerpo del error. La documentacion de
 * Resend lista los nombres de error por status, pero NO documenta los nombres de
 * campo del JSON de error; apoyar la decision en un campo no documentado seria
 * suponer. El nombre del error se usa unicamente para el log, y solo si pertenece a
 * la lista documentada.
 *
 *   2xx + { id }                 aceptado por Resend.
 *   2xx sin un { id } legible    ambiguous: el status dice "aceptado" pero no hay un
 *                                id que lo confirme, asi que no se afirma el fallo
 *                                ni se afirma la entrega.
 *   400 401 403 404 405 422 429  rejected: status documentados con los que Resend NO
 *                                proceso la solicitud (validacion, autenticacion,
 *                                dominio sin verificar, formato, limite de tasa o de
 *                                cupo).
 *   409                          ambiguous: SIEMPRE implica que ya existe OTRA
 *                                solicitud con esta clave de idempotencia. Sea
 *                                `concurrent_idempotent_requests` (otra en curso) o
 *                                `invalid_idempotent_request` (la clave se uso con
 *                                otro contenido), un envio anterior pudo haberse
 *                                aceptado y haber llegado. Decir "no salio" invalidaria
 *                                un enlace que pudo ser recibido.
 *   5xx (500, 503, ...)          ambiguous: un error del servidor no garantiza que la
 *                                solicitud no se haya aceptado.
 *   cualquier otro status        ambiguous: 3xx, 408, 413, 451... no estan en el
 *                                contrato documentado. Sin respaldo, no se afirma nada.
 *   timeout propio               ambiguous: la solicitud pudo llegar y aceptarse.
 *   error de red                 not_sent SOLO si ocurrio ANTES de escribir el
 *                                request (no se resolvio el nombre, se nego la
 *                                conexion, fallo la validacion del certificado);
 *                                ambiguous en cualquier otro caso (p. ej. conexion
 *                                cortada a mitad).
 *   validacion local             not_sent: nunca llego a salir.
 *
 * "Aceptado por Resend" NO es "entregado": un 200 prueba que Resend recibio y encolo
 * la solicitud. No prueba que el servidor del destinatario la haya aceptado ni que la
 * persona la vea (spam, rebote, reescritura de enlaces por un filtro de seguridad).
 *
 * ---------------------------------------------------------------------------
 * SEGURIDAD
 * ---------------------------------------------------------------------------
 *
 *   * La API key solo viaja en el encabezado `Authorization`, nunca en la URL.
 *   * El endpoint es una CONSTANTE de este archivo: ninguna entrada (ni de la
 *     request, ni del entorno) puede redirigir el envio ni la clave a otro host.
 *   * `redirect: 'error'`: ante una redireccion no se sigue a ningun lado.
 *   * Nunca se loguea ni se propaga el cuerpo de la solicitud, los encabezados, la
 *     key, ni el texto de error del proveedor. Los errores de `fetch` se descartan y
 *     se reemplazan por un `MailDeliveryError` de mensaje fijo.
 *   * Sin SDK ni reintentos propios: un reintento es del dominio, y la clave de
 *     idempotencia lo hace seguro.
 */

/** Constante a proposito. NO configurable. */
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Tiempo maximo de la llamada completa. */
export const RESEND_TIMEOUT_MS = 10_000;

/** Limites documentados de la clave de idempotencia. */
const IDEMPOTENCY_KEY_MIN = 1;
const IDEMPOTENCY_KEY_MAX = 256;

/** Tope del cuerpo de respuesta que se acepta leer. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Nombres de error DOCUMENTADOS por Resend (pagina de errores). Un nombre fuera de
 * esta lista se registra como "unknown": nunca se copia texto externo al log.
 */
const DOCUMENTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'invalid_idempotency_key',
  'validation_error',
  'missing_api_key',
  'restricted_api_key',
  'email_above_quota',
  'invalid_permission',
  'suspended_api_key',
  'not_found',
  'method_not_allowed',
  'concurrent_idempotent_requests',
  'invalid_idempotent_request',
  'resource_locked',
  'invalid_attachment',
  'invalid_parameter',
  'missing_required_field',
  'missing_required_parameter',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'rate_limit_exceeded',
  'application_error',
  'service_unavailable'
]);

/** Status con los que Resend documenta que NO proceso la solicitud. */
const REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 405, 422, 429]);

/**
 * Codigos de error de red que ocurren ANTES de que se escriba el request: la
 * conexion nunca se establecio o el certificado no valido. Nada salio. Cualquier otro
 * codigo (ECONNRESET, EPIPE, un corte a mitad de respuesta) es ambiguo.
 */
const PRE_SEND_NETWORK_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);

export interface ResendMailTransportOptions {
  /** Secreto. Nunca se registra ni se incluye en un error. */
  apiKey: string;
  /** Remitente ya validado por `parseMailFrom`. */
  from: string;
  /** Inyectable para los tests; en produccion, el `fetch` global. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Reloj monotono para medir duracion. Inyectable para los tests. */
  now?: () => number;
}

export class ResendMailTransport implements MailTransport {
  readonly kind = 'resend';
  readonly operational = true;

  private readonly logger = new Logger('ResendMailTransport');

  // Campos privados de JAVASCRIPT (`#`), no el `private` de TypeScript: ese es solo
  // una convencion de compilacion y en ejecucion la propiedad es enumerable. Con `#`,
  // un `JSON.stringify(transport)`, un `util.inspect` o un spread accidental en un log
  // NO pueden volcar la API key.
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(options: ResendMailTransportOptions) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.#timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;
    this.#now = options.now ?? (() => performance.now());
  }

  async send(message: MailMessage): Promise<void> {
    // Todo lo que se puede comprobar ANTES de salir, se comprueba antes de salir:
    // un fallo aca es `not_sent` con certeza.
    const request = this.buildRequest(message);
    const correlation = message.idempotencyKey ?? 'no-key';
    const startedAt = this.#now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let response: Response;
    let bodyText: string;

    try {
      response = await this.#fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        // Una redireccion nunca se sigue: el Authorization no debe ir a otro lado.
        redirect: 'error'
      });
      bodyText = await readBounded(response);
    } catch (error) {
      const failure = classifyTransportFailure(error);
      this.logger.warn(
        `resend.${failure.kind} (${failure.reason}, ${this.elapsed(startedAt)}ms, key ${correlation})`
      );
      throw new MailDeliveryError(failure.kind, `resend ${failure.kind}: ${failure.reason}`);
    } finally {
      // Siempre: ni el timer ni el controlador sobreviven a la llamada.
      clearTimeout(timer);
    }

    this.settle(response.status, bodyText, correlation, this.elapsed(startedAt));
  }

  // -------------------------------------------------------------------------

  private buildRequest(message: MailMessage): {
    headers: Record<string, string>;
    body: string;
  } {
    const to = message.to;
    const key = message.idempotencyKey;

    // La configuracion ya se valida al elegir el transporte; esto es la ultima barrera
    // antes de armar un `Authorization` o un `from` vacios.
    if (!this.#apiKey || !this.#from) {
      throw new MailDeliveryError('not_sent', 'resend not_sent: transport not configured');
    }

    if (typeof to !== 'string' || !to.includes('@') || /[\s,;<>]/.test(to)) {
      throw new MailDeliveryError('not_sent', 'resend not_sent: invalid recipient');
    }

    if (
      typeof message.subject !== 'string' ||
      message.subject.length === 0 ||
      /[\r\n]/.test(message.subject)
    ) {
      throw new MailDeliveryError('not_sent', 'resend not_sent: invalid subject');
    }

    if (
      typeof message.html !== 'string' ||
      message.html.length === 0 ||
      typeof message.text !== 'string' ||
      message.text.length === 0
    ) {
      throw new MailDeliveryError('not_sent', 'resend not_sent: empty body');
    }

    if (
      key !== undefined &&
      (typeof key !== 'string' ||
        key.length < IDEMPOTENCY_KEY_MIN ||
        key.length > IDEMPOTENCY_KEY_MAX ||
        // Un valor de encabezado no puede llevar saltos de linea ni controles.
        /[\u0000-\u001f\u007f]/.test(key))
    ) {
      throw new MailDeliveryError('not_sent', 'resend not_sent: invalid idempotency key');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'scope-api'
    };

    if (key !== undefined) {
      headers['Idempotency-Key'] = key;
    }

    let body: string;

    try {
      // El orden de las claves es fijo: el MISMO mensaje produce el MISMO cuerpo,
      // byte a byte, que es lo que exige la idempotencia (misma clave con otro
      // cuerpo es un 409).
      body = JSON.stringify({
        from: this.#from,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text
      });
    } catch {
      throw new MailDeliveryError('not_sent', 'resend not_sent: unserializable message');
    }

    return { headers, body };
  }

  /** Convierte la respuesta HTTP en exito o en un `MailDeliveryError` clasificado. */
  private settle(status: number, bodyText: string, correlation: string, ms: number): void {
    if (status >= 200 && status < 300) {
      const providerId = readAcceptedId(bodyText);

      if (providerId === null) {
        this.logger.warn(`resend.ambiguous (accepted without id, ${status}, ${ms}ms, key ${correlation})`);
        throw new MailDeliveryError(
          'ambiguous',
          'resend ambiguous: success status without a readable id'
        );
      }

      // "Aceptado por Resend". NO es "entregado" ni "visible para la persona".
      this.logger.log(`resend.accepted (${status}, ${ms}ms, key ${correlation}, provider id ${providerId})`);
      return;
    }

    const errorName = readDocumentedErrorName(bodyText);

    if (REJECTED_STATUSES.has(status)) {
      this.logger.warn(`resend.rejected (${status} ${errorName}, ${ms}ms, key ${correlation})`);
      throw new MailDeliveryError('rejected', `resend rejected: ${status} ${errorName}`);
    }

    // 409, 5xx y todo status que el contrato documentado no cubre.
    this.logger.warn(`resend.ambiguous (${status} ${errorName}, ${ms}ms, key ${correlation})`);
    throw new MailDeliveryError('ambiguous', `resend ambiguous: ${status} ${errorName}`);
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, Math.round(this.#now() - startedAt));
  }
}

// ---------------------------------------------------------------------------
// Utilidades puras (exportadas para los tests)
// ---------------------------------------------------------------------------

async function readBounded(response: Response): Promise<string> {
  const text = await response.text();
  // Un cuerpo desmedido no se interpreta; se trata como ilegible.
  return text.length > MAX_RESPONSE_BYTES ? '' : text;
}

/** `{ id }` -> el id (solo si es un string corto y sin controles); si no, `null`. */
export function readAcceptedId(bodyText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const id = (parsed as { id?: unknown }).id;

    return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * El nombre del error SOLO si es uno de los documentados; si no, "unknown". Nunca se
 * copia un valor externo: ni el `message` del proveedor, ni un nombre inesperado.
 */
export function readDocumentedErrorName(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    const name =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { name?: unknown }).name
        : undefined;

    return typeof name === 'string' && DOCUMENTED_ERROR_NAMES.has(name) ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

interface TransportFailure {
  kind: 'not_sent' | 'ambiguous';
  /** Texto fijo, sin nada del error original. */
  reason: string;
}

export function classifyTransportFailure(error: unknown): TransportFailure {
  // Nuestro propio timeout (AbortController). El request pudo haber llegado.
  if (isAbort(error)) {
    return { kind: 'ambiguous', reason: 'timeout' };
  }

  const code = findErrorCode(error);

  if (code !== null && PRE_SEND_NETWORK_CODES.has(code)) {
    return { kind: 'not_sent', reason: `connect failed (${code})` };
  }

  return { kind: 'ambiguous', reason: 'network error' };
}

function isAbort(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.name === 'AbortError' || current.name === 'TimeoutError') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** Recorre la cadena `cause` (acotada) buscando un `code` de sistema. */
function findErrorCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}
