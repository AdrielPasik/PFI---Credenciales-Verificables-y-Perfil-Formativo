import { DisabledMailTransport } from './disabled-mail-transport';
import { LogMailTransport } from './log-mail-transport';
import type { MailTransport } from './mail-transport';
import { ResendMailTransport } from './resend-mail-transport';

/**
 * Seleccion del transporte de correo a partir del entorno.
 *
 * REGLA: ante CUALQUIER duda, el transporte es `disabled`. Un valor ausente, un
 * valor desconocido, el transporte de desarrollo pedido en produccion y un Resend
 * mal configurado resuelven todos a "no enviar nada": la recuperacion de contrasena
 * queda inequivocamente apagada (503) en vez de enviar por un camino que nadie eligio.
 *
 * Nunca lanza: una configuracion de correo invalida NO tumba el arranque, porque el
 * login, el registro y `/auth/me` no pueden depender de una funcion opcional.
 *
 *   MAIL_TRANSPORT   disabled (default) | log | resend
 *   MAIL_FROM        remitente de Resend. Configuracion, NO secreto.
 *   RESEND_API_KEY   SECRETO. Solo se lee del entorno del servidor y solo aca.
 *
 * `log` es solo para desarrollo (imprime el enlace de recuperacion) y `resend` es el
 * transporte real. `resend` se acepta tambien fuera de produccion si quien desarrolla
 * aporta una key real: la decision es de la configuracion, no del codigo.
 */

export type MailTransportKind = 'log' | 'disabled' | 'resend';

export type MailDowngradeReason =
  | 'production_forbids_log'
  | 'unsupported_value'
  | 'resend_missing_api_key'
  | 'resend_invalid_api_key'
  | 'resend_missing_from'
  | 'resend_invalid_from';

export interface MailTransportSelection {
  kind: MailTransportKind;
  /**
   * Por que se cayo a `disabled` cuando el valor pedido era otro. Texto fijo, sin el
   * valor recibido: un valor mal escrito de la variable podria ser un secreto pegado
   * en el campo equivocado.
   */
  downgradeReason?: MailDowngradeReason;
}

type Env = Record<string, string | undefined>;

export function isProductionEnvironment(env: Env = process.env): boolean {
  return env.NODE_ENV?.trim().toLowerCase() === 'production';
}

// ---------------------------------------------------------------------------
// Configuracion de Resend
// ---------------------------------------------------------------------------

export type ResendConfigResult =
  | { ok: true; apiKey: string; from: string }
  | { ok: false; reason: 'missing_api_key' | 'invalid_api_key' | 'missing_from' | 'invalid_from' };

/**
 * ASCII imprimible sin espacios: un valor de encabezado `Authorization` no puede
 * llevar saltos de linea ni controles (inyeccion de encabezados). No se exige un
 * prefijo: la documentacion de Resend lo muestra solo como ejemplo, no como regla.
 */
const API_KEY_PATTERN = /^[\x21-\x7e]{8,256}$/;

const ADDRESS_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Letras (con acentos), numeros, espacio y . _ ' - ; sin comillas, comas ni <>. */
const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} ._'-]{1,64}$/u;

/**
 * Acepta `Nombre <usuario@dominio>` o `usuario@dominio` y devuelve el remitente
 * normalizado, o `null`. Una sola direccion; sin saltos de linea.
 */
export function parseMailFrom(raw: string): string | null {
  // Los saltos de linea se rechazan ANTES de recortar: `trim()` los eliminaria en los
  // extremos y dejaria pasar un valor que traia una inyeccion de encabezados.
  if (raw.length === 0 || raw.length > 200 || /[\r\n\0]/.test(raw)) {
    return null;
  }

  const value = raw.trim();

  if (value.length === 0) {
    return null;
  }

  const bracketed = /^(?<name>[^<>]*)<(?<address>[^<>]*)>$/.exec(value);
  const address = (bracketed?.groups?.address ?? value).trim();
  const name = bracketed ? bracketed.groups!.name.trim() : '';

  if (!ADDRESS_PATTERN.test(address)) {
    return null;
  }

  const [local, domain] = address.split('@');
  const normalized = `${local}@${domain.toLowerCase()}`;

  if (!bracketed) {
    return normalized;
  }

  if (name.length > 0 && !DISPLAY_NAME_PATTERN.test(name)) {
    return null;
  }

  return name.length > 0 ? `${name} <${normalized}>` : normalized;
}

export function readResendConfig(env: Env = process.env): ResendConfigResult {
  const apiKey = env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' };
  }

  if (!API_KEY_PATTERN.test(apiKey)) {
    return { ok: false, reason: 'invalid_api_key' };
  }

  const rawFrom = env.MAIL_FROM?.trim();

  if (!rawFrom) {
    return { ok: false, reason: 'missing_from' };
  }

  const from = parseMailFrom(rawFrom);

  return from === null
    ? { ok: false, reason: 'invalid_from' }
    : { ok: true, apiKey, from };
}

// ---------------------------------------------------------------------------
// Seleccion
// ---------------------------------------------------------------------------

export function selectMailTransportKind(
  env: Env = process.env
): MailTransportSelection {
  const requested = env.MAIL_TRANSPORT?.trim().toLowerCase();

  if (!requested || requested === 'disabled') {
    return { kind: 'disabled' };
  }

  if (requested === 'log') {
    // El transporte de desarrollo imprime el enlace de recuperacion. En
    // produccion eso entrega la cuenta a quien lea los logs.
    return isProductionEnvironment(env)
      ? { kind: 'disabled', downgradeReason: 'production_forbids_log' }
      : { kind: 'log' };
  }

  if (requested === 'resend') {
    const config = readResendConfig(env);

    return config.ok
      ? { kind: 'resend' }
      : { kind: 'disabled', downgradeReason: `resend_${config.reason}` };
  }

  return { kind: 'disabled', downgradeReason: 'unsupported_value' };
}

export interface CreateMailTransportDeps {
  /** Para los tests: ninguna prueba debe llegar a la red real. */
  fetchImpl?: typeof fetch;
}

export function createMailTransport(
  env: Env = process.env,
  onDowngrade?: (reason: MailDowngradeReason) => void,
  deps: CreateMailTransportDeps = {}
): MailTransport {
  const selection = selectMailTransportKind(env);

  if (selection.downgradeReason) {
    onDowngrade?.(selection.downgradeReason);
  }

  if (selection.kind === 'log') {
    return new LogMailTransport();
  }

  if (selection.kind === 'resend') {
    const config = readResendConfig(env);

    // `selectMailTransportKind` ya lo valido; esto es solo para el sistema de tipos.
    if (config.ok) {
      return new ResendMailTransport({
        apiKey: config.apiKey,
        from: config.from,
        fetchImpl: deps.fetchImpl
      });
    }
  }

  return new DisabledMailTransport();
}
