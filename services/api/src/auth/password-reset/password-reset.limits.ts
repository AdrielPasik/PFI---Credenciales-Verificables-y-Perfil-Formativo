/**
 * Limites de la recuperacion de contrasena.
 *
 * Son CONSTANTES y no variables de entorno a proposito (mismo criterio que
 * `public-verification.limits.ts`): son decisiones de seguridad, revisables en un
 * diff, no perillas operativas que alguien afloje en un panel sin que quede
 * rastro.
 *
 * TRES FRONTERAS, y cada una protege algo distinto:
 *
 *   POR IP      el throttler (en memoria, POR INSTANCIA). Frena a un cliente.
 *   POR CUENTA  cooldown + cuota, en PostgreSQL. Frena el bombardeo de correos a
 *               UNA persona, venga de las IPs que venga.
 *   GLOBAL      tope diario, en PostgreSQL. Reserva margen frente al limite del
 *               proveedor de correo: un atacante que rote IPs no puede agotar el
 *               cupo diario de todos.
 *
 * Solo la por-IP es del proceso: las otras dos viven en la base y valen entre
 * instancias.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/**
 * 30 minutos. Cubre una demora normal de entrega y el tiempo de abrir el correo,
 * y es lo bastante corto como para que un enlace olvidado en un buzon ajeno no
 * sirva al dia siguiente.
 */
export const PASSWORD_RESET_TTL_MS = 30 * MINUTE_MS;
export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MS / MINUTE_MS;

/** Los tokens de mas de 7 dias de UNA cuenta se borran al emitirle uno nuevo. */
export const PASSWORD_RESET_RETENTION_MS = 7 * DAY_MS;

// ---------------------------------------------------------------------------
// Por cuenta
// ---------------------------------------------------------------------------

/** Entre dos emisiones de la MISMA cuenta. */
export const ACCOUNT_COOLDOWN_MS = MINUTE_MS;

/** Emisiones por cuenta en una ventana movil. */
export const ACCOUNT_QUOTA_MAX = 3;
export const ACCOUNT_QUOTA_WINDOW_MS = HOUR_MS;

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

/**
 * Reservas de envio por ventana movil de 24 h, sumadas entre TODAS las cuentas.
 *
 * Se cuentan FILAS EMITIDAS, no correos entregados: una reserva consume cupo aunque
 * el envio despues falle, expire o sea ambiguo. Es la politica conservadora a
 * proposito -- si los fallos de entrega devolvieran cupo, provocar errores seria
 * una forma de eludir el tope. 80 deja margen bajo el plan gratuito del proveedor
 * previsto (100 por dia).
 */
export const GLOBAL_QUOTA_MAX = 80;
export const GLOBAL_QUOTA_WINDOW_MS = DAY_MS;

// ---------------------------------------------------------------------------
// Por IP (throttler)
// ---------------------------------------------------------------------------

export const THROTTLE_WINDOW_MS = 15 * MINUTE_MS;

/** POST /auth/password-reset/request. */
export const REQUEST_THROTTLE_LIMIT = 5;

/** POST /auth/password-reset/verify Y /confirm: UN solo contador compartido. */
export const TOKEN_THROTTLE_LIMIT = 20;

// ---------------------------------------------------------------------------
// Procesamiento en segundo plano
// ---------------------------------------------------------------------------

/**
 * Techo de trabajos desprendidos en vuelo por proceso. Sin un techo, una rafaga
 * desde muchas IPs acumularia promesas sin limite en memoria. Superado, el trabajo
 * se descarta (con log) y la respuesta publica sigue siendo 202: igual que un
 * cooldown, no se distingue desde afuera.
 */
export const MAX_BACKGROUND_TASKS_IN_FLIGHT = 50;

/** Espera maxima de trabajos en vuelo al cerrar el modulo. */
export const BACKGROUND_DRAIN_TIMEOUT_MS = 10 * 1000;

// ---------------------------------------------------------------------------
// Serializacion de la emision
// ---------------------------------------------------------------------------

/**
 * Clave del advisory lock transaccional que serializa TODAS las emisiones.
 *
 * Es el ASCII de "SCOPEPWR" (53 43 4F 50 45 50 57 52): positivo en int8, reservado
 * para esta unica responsabilidad. Se verifico que ningun otro codigo del repo usa
 * advisory locks, asi que no hay colision interna; el espacio de claves es por
 * base de datos, no por tabla, por lo que cualquier uso futuro debe elegir otro
 * valor.
 *
 * `pg_advisory_xact_lock` se libera SOLO al terminar la transaccion (commit o
 * rollback): no hay unlock que olvidar ni lock que sobreviva a una excepcion.
 */
export const PASSWORD_RESET_ISSUE_LOCK_KEY = 0x53434f5045505752n;

/** Una emision es 6 sentencias cortas; esto cubre la espera por el lock. */
export const ISSUE_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 10_000
} as const;

export const CONFIRM_TRANSACTION_OPTIONS = {
  maxWait: 5_000,
  timeout: 10_000
} as const;
