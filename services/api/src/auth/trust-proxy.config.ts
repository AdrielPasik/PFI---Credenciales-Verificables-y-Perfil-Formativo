/**
 * Politica de proxy confiable.
 *
 * Los limites por IP solo sirven si la IP es la del cliente. Detras del Application
 * Load Balancer, la IP del socket es la del ALB, asi que sin esta politica TODOS los
 * clientes compartirian un contador. Y confiar en `X-Forwarded-For` sin condiciones
 * es peor: cualquiera podria elegir su propia IP.
 *
 * `TRUST_PROXY_HOPS` es la cantidad EXACTA de proxies de confianza entre el cliente
 * y este proceso:
 *
 *   0 (por defecto)   no se confia en ningun encabezado. `req.ip` es la direccion
 *                     del socket. Es lo correcto en desarrollo local, donde nadie
 *                     pone un proxy delante: un cliente que mande
 *                     `X-Forwarded-For` NO puede cambiar de contador.
 *   1                 un proxy de confianza (el ALB de produccion). Express toma la
 *                     entrada de `X-Forwarded-For` que ese proxy agrego, contando
 *                     desde la DERECHA; lo que el cliente haya escrito a la
 *                     izquierda se ignora.
 *
 * Un numero equivocado falla en uno de los dos sentidos (todos comparten IP, o la IP
 * es falsificable), por eso es explicito y no se infiere.
 *
 * El contador de limites es EN MEMORIA, por proceso. Con mas de una task de ECS cada
 * una cuenta por su cuenta: el limite efectivo por IP es de hasta N veces el
 * configurado, con N tasks. No es un limite distribuido.
 */

type Env = Record<string, string | undefined>;

/** Mas que esto es casi seguro un error de tipeo, no una topologia real. */
const MAX_TRUST_PROXY_HOPS = 10;

/**
 * Lanza ante un valor invalido, igual que `resolveWebCorsOptions` con `WEB_ORIGIN`:
 * una politica de proxy mal escrita no puede degradar en silencio a "confiar en
 * todo" ni a "no confiar en nada", asi que el arranque falla en voz alta.
 */
export function resolveTrustProxyHops(env: Env = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();

  if (!raw) {
    return 0;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error('TRUST_PROXY_HOPS debe ser un entero no negativo.');
  }

  const hops = Number(raw);

  if (!Number.isSafeInteger(hops) || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS debe estar entre 0 y ${MAX_TRUST_PROXY_HOPS}.`
    );
  }

  return hops;
}

interface TrustProxyTarget {
  set(setting: string, value: unknown): unknown;
}

/** 0 = no se toca la configuracion de Express (su default es `false`). */
export function applyTrustProxy(app: TrustProxyTarget, hops: number): void {
  if (hops > 0) {
    app.set('trust proxy', hops);
  }
}
