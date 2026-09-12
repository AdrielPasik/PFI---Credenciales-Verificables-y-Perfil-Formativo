/**
 * Cliente de Analisis de trayectoria — P2.4B.
 *
 * Misma convencion que `objectives-api.ts`: funciones sueltas que reciben
 * `AuthenticatedApiRequest` y devuelven el resultado de un adapter.
 *
 * El navegador habla SOLO con NestJS. No existe acceso directo al servicio de
 * IA, y ningun artifact crudo se pide desde aca: la resolucion de `src_NN` a
 * credencial ya la hizo el servidor.
 *
 * NO HAY `/retry`, `/cancel` ni `/reset`, y no se inventan: reintentar es
 * volver a llamar a `execute` sobre un run propio que quedo `pending`, y un run
 * que quedo `running` no se rescata —se crea uno nuevo—.
 */

import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import {
  adaptReasoningRunDetail,
  adaptReasoningRunSummaries
} from '@/lib/adapters/reasoning-runs.adapter';

export async function listMyReasoningRunsRequest(request: AuthenticatedApiRequest) {
  return adaptReasoningRunSummaries(await request('/me/reasoning-runs'));
}

export async function getMyReasoningRunRequest(
  request: AuthenticatedApiRequest,
  reasoningRunReference: string
) {
  return adaptReasoningRunDetail(
    await request(`/me/reasoning-runs/${encodeURIComponent(reasoningRunReference)}`)
  );
}

/**
 * Congela el universo de evidencia y crea el run. NO ejecuta.
 *
 * Puede devolver un run que ya nace `failed` —si el inventario quedo
 * bloqueado—; eso no es un fallo de la peticion, el recurso existe.
 */
export async function createMyReasoningRunRequest(
  request: AuthenticatedApiRequest,
  objectiveReference: string
) {
  return adaptReasoningRunDetail(
    await request('/me/reasoning-runs', {
      method: 'POST',
      body: { objectiveId: objectiveReference }
    })
  );
}

/**
 * Ejecuta. SINCRONO: la respuesta llega cuando el desenlace ya ocurrio, y puede
 * tardar —el razonamiento contextual hace una llamada por requisito—.
 *
 * Devuelve el detalle completo, asi que no hace falta un `GET` posterior.
 */
export async function executeMyReasoningRunRequest(
  request: AuthenticatedApiRequest,
  reasoningRunReference: string,
  signal?: AbortSignal
) {
  return adaptReasoningRunDetail(
    await request(
      `/me/reasoning-runs/${encodeURIComponent(reasoningRunReference)}/execute`,
      { method: 'POST', signal }
    )
  );
}
