/**
 * Limites de la verificacion contextual publica.
 *
 * DOS FRONTERAS DISTINTAS, y no se consumen una a la otra:
 *
 *   ALMACENAMIENTO   cuantas sesiones abiertas puede acumular un enlace filtrado.
 *                    Protege la base. No cuesta dinero de proveedor.
 *   PROVEEDOR        cuantos arranques de trabajo de modelo puede disparar un
 *                    enlace. Protege el costo. Crear un borrador no la consume.
 *
 * El token opaco del enlace es inadivinable, pero NO es un limite de costo: una
 * vez filtrado, cualquiera lo tiene.
 */

/** 24 h. Solo limita la etapa PREVIA al run. */
export const VERIFICATION_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Techo de un endpoint ANONIMO. El intake del holder admite 60.000 code points;
 * no se hereda: aca cada caracter es costo de proveedor que el holder no pidio.
 */
export const MAX_VERIFIER_OBJECTIVE_CODE_POINTS = 8_000;
export const MAX_VERIFIER_OBJECTIVE_TITLE_LENGTH = 200;

/** `objective_definition_v1` exige al menos 1 y no fija maximo; V1 publica fija 12. */
export const MIN_VERIFIER_REQUIREMENTS = 1;
export const MAX_VERIFIER_REQUIREMENTS = 12;

// ---------------------------------------------------------------------------
// Almacenamiento
// ---------------------------------------------------------------------------

/** Sesiones VIGENTES y SIN consumir por enlace. Vencidas o consumidas no cuentan. */
export const MAX_ACTIVE_REQUESTS_PER_SHARE = 10;

// ---------------------------------------------------------------------------
// Proveedor
// ---------------------------------------------------------------------------

/** Arranques de proveedor por enlace en una ventana movil de 24 h. */
export const PROPOSAL_STARTS_PER_SHARE_WINDOW = 5;
export const PROPOSAL_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Entre dos arranques de proveedor del MISMO enlace. */
export const PROPOSAL_COOLDOWN_MS = 60 * 1000;

/**
 * 10 minutos.
 *
 * NO se dimensiona contra el timeout de NestJS (60 s, `AI_SERVICE_TIMEOUT_MS`),
 * sino contra el del PROVEEDOR dentro del ai-service: 300 s por defecto
 * (`OBJECTIVE_UNDERSTANDING_PROVIDER_TIMEOUT_SECONDS`), sin reintentos.
 *
 * Por que: cuando NestJS aborta a los 60 s, la llamada al proveedor puede seguir
 * corriendo -- y facturando -- en el ai-service hasta 300 s. Un lease de 60 s
 * habilitaria exactamente el paralelismo que el claim existe para impedir. 600 s
 * es el doble del timeout del proveedor.
 *
 * ACOPLAMIENTO ENTRE SERVICIOS: si se sube el timeout del proveedor por encima de
 * ~9 minutos, este lease tiene que crecer con el. NestJS no puede leer esa
 * variable del ai-service.
 */
export const PROPOSAL_LEASE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Ejecucion F3
// ---------------------------------------------------------------------------

/**
 * VerificationRun INICIADOS (congelados) por enlace en una ventana movil de 24 h.
 * Cuenta runs, no intentos: un reintento del mismo run no consume otra unidad.
 */
export const RUN_STARTS_PER_SHARE_WINDOW = 3;
export const RUN_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Primer intento + 2 reintentos por fallos TRANSITORIOS de etapa. */
export const MAX_EXECUTION_ATTEMPTS_PER_RUN = 3;

/** Techo de llamadas logicas de NestJS en un intento: OA + EU + 1 contextual por requisito. */
const MAX_LOGICAL_CALLS_PER_ATTEMPT = 2 + MAX_VERIFIER_REQUIREMENTS;
const DEFAULT_AI_SERVICE_TIMEOUT_MS = 60_000;
const LEASE_MARGIN_MS = 4 * 60 * 1000;
const MIN_EXECUTION_LEASE_MS = 30 * 60 * 1000;

/**
 * Duracion del lease de ejecucion por enlace.
 *
 * El intento es SECUENCIAL: cada llamada logica espera a la anterior y cada una
 * esta acotada por `AI_SERVICE_TIMEOUT_MS`. El peor caso de un intento vivo es
 * entonces `(2 + 12) * timeout`; se suma un margen para persistencia y policy, y
 * se fija un piso de 30 minutos.
 *
 * El lease no es la exclusion del RUN (esa es el CAS `pending -> running` del
 * motor): es la exclusion por ENLACE, y su unico trabajo al vencer es no dejar un
 * enlace bloqueado para siempre si el proceso murio.
 *
 * LIMITACION ACEPTADA. Cuando NestJS aborta una llamada, el proveedor dentro del
 * ai-service puede seguir hasta 180 s. Si el intento termina (y suelta el lease)
 * justo despues de un abort, una ejecucion nueva del mismo enlace puede solaparse
 * con esa cola. La cuota de runs acota ese costo.
 */
export function executionLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.AI_SERVICE_TIMEOUT_MS?.trim());
  const timeout =
    Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_AI_SERVICE_TIMEOUT_MS;
  return Math.max(MIN_EXECUTION_LEASE_MS, MAX_LOGICAL_CALLS_PER_ATTEMPT * timeout + LEASE_MARGIN_MS);
}
