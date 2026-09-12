/**
 * Evento de diagnostico INTERNO de fallos del ai-service — slice P2.4 OBS.
 *
 * EFECTO LATERAL PURO. No decide nada, no persiste nada y no cambia el
 * desenlace de ningun run. Si esta funcion desapareciera, el comportamiento del
 * producto seria identico — lo unico que se perderia es poder responder, sin
 * reproducir el fallo:
 *
 *     ¿que etapa fallo?  ¿que desenlace operativo produjo?
 *     ¿que parte exacta del contrato incumplio la salida del modelo?
 *
 * CAMPOS ALLOWLISTED, UNO POR UNO. No se acepta un objeto abierto y no se
 * serializa nada del otro lado: la firma solo admite tokens cerrados y
 * referencias opacas. Nada de texto del Requirement, del Objective, de la
 * evidencia, del prompt ni de la respuesta del proveedor.
 */

import { type Logger } from '@nestjs/common';

/** Nombre estable del evento, para poder filtrarlo en un log. */
export const REASONING_AI_SERVICE_FAILURE_EVENT = 'reasoning_ai_service_failure';

export interface ReasoningAiServiceFailureEvent {
  /** `objective_analysis` · `evidence_units` · `contextual_reasoning`. */
  readonly stage: string;
  /** El codigo cerrado que persiste el run. */
  readonly operationalCode: string;
  /** Categoria del envelope `ai_service_error_v1`. */
  readonly upstreamCode: string;
  /** Token del vocabulario cerrado del ai-service, o el centinela. */
  readonly upstreamSubcode: string;
  /** Referencia opaca. No es contenido del holder. */
  readonly reasoningRunReference: string;
  /** `req_NN`. Solo en razonamiento contextual, que evalua de a un Requirement. */
  readonly requirementReference?: string;
}

/**
 * Emite el evento por el `Logger` de Nest, que es la infraestructura que el repo
 * ya usa —`AnalysisRunExecutionService` y compania—. Sin dependencias nuevas,
 * sin transporte remoto y sin `await`: un fallo del log no puede alterar el
 * lifecycle del run.
 */
export function logReasoningAiServiceFailure(
  logger: Logger,
  event: ReasoningAiServiceFailureEvent
): void {
  logger.error({
    event: REASONING_AI_SERVICE_FAILURE_EVENT,
    stage: event.stage,
    operationalCode: event.operationalCode,
    upstreamCode: event.upstreamCode,
    upstreamSubcode: event.upstreamSubcode,
    reasoningRunReference: event.reasoningRunReference,
    ...(event.requirementReference === undefined
      ? {}
      : { requirementReference: event.requirementReference })
  });
}
