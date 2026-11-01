/**
 * Servicio de propuesta de Requirements — slice P2.2.
 *
 * SIN PRISMA. Ni inyectado, ni importado, ni alcanzable: la ausencia es el
 * contrato. Esta etapa produce una respuesta TRANSITORIA y
 *
 *     DB_WRITES = 0
 *
 * no es una promesa de prosa — no hay ninguna dependencia por la que escribir.
 *
 * NO CREA EL OBJECTIVE. `ObjectivesService` no se inyecta acá a propósito: si
 * estuviera disponible, alguien terminaría llamándolo "para ahorrar un paso", y
 * ese paso es justamente la confirmación humana que P2.0 §17 hizo obligatoria.
 *
 * ORDEN CAUSAL:
 *
 *     validar entrada           (antes de la red)
 *         v
 *     UNA llamada al AI service
 *         v
 *     verificación INDEPENDIENTE del artefacto contra el texto enviado
 *         v
 *     mapeo a DTO privado por allowlist
 *
 * REINTENTOS. No hay. Como nada se persiste, un fallo transitorio se resuelve
 * repitiendo el pedido desde el cliente, y eso produce una observación NUEVA del
 * proveedor. A diferencia de un ReasoningRun, no existe una fila congelada que
 * continuar: no hay `ProposalRun` en V1 y esa diferencia es deliberada.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AiServiceClient } from '../ai/ai-service.client';
import { ObjectiveProposalTransportError } from '../ai/ai-service.types';
import {
  type ObjectiveRequirementProposalResponseDto
} from './dto/objective-requirement-proposal.dto';
import {
  OBJECTIVE_REQUIREMENT_PROPOSAL_REQUEST_SCHEMA_VERSION
} from './objective-requirement-proposal.contract';
import {
  ObjectiveProposalArtifactInvariantError,
  ObjectiveRequirementProposalError
} from './objective-requirement-proposal.errors';
import { mapObjectiveRequirementProposal } from './objective-requirement-proposal.mapper';
import {
  type ObjectiveRequirementProposalInput
} from './objective-requirement-proposal.request.validator';
import { verifyObjectiveProposalResponse } from './objective-requirement-proposal.verifier';

/** Nombre estable del evento de duracion de una propuesta. */
export const OBJECTIVE_PROPOSAL_TIMING_EVENT = 'objective_requirement_proposal_timing';

@Injectable()
export class ObjectiveRequirementProposalService {
  private readonly logger = new Logger(ObjectiveRequirementProposalService.name);

  public constructor(private readonly aiServiceClient: AiServiceClient) {}

  /**
   * `maxRequirements` es el presupuesto de selección del llamante.
   *
   * Los dos llamantes lo mandan: el titular (15, `MAX_OBJECTIVE_REQUIREMENTS`) y
   * el verificador público (12). Sin presupuesto, un aviso largo producía decenas
   * de candidatos —actividades y actitudes incluidas— y después un razonamiento
   * de una llamada al modelo por Requirement. El parámetro sigue siendo opcional
   * para no cambiar el contrato del servicio.
   *
   * Cuando hay presupuesto, el AI service extrae sin cupo y, si sobran, una etapa
   * de selección elige por relevancia; lo que queda afuera vuelve como
   * `omittedCandidates`. Acá no se recorta nada: una propuesta que igual excede
   * el tope se trata como salida inutilizable, como cualquier otra violación del
   * contrato.
   */
  public async propose(
    input: ObjectiveRequirementProposalInput,
    maxRequirements?: number
  ): Promise<ObjectiveRequirementProposalResponseDto> {
    const startedAt = Date.now();
    try {
      const proposal = await this.proposeOnce(input, maxRequirements);
      this.logTiming(startedAt, maxRequirements, 'proposed', null, proposal);
      return proposal;
    } catch (error: unknown) {
      const code =
        error instanceof ObjectiveRequirementProposalError ? error.code : 'UNEXPECTED';
      this.logTiming(startedAt, maxRequirements, 'failed', code, null);
      throw error;
    }
  }

  /**
   * Duracion y volumen de una propuesta, sin texto: solo numeros y un codigo
   * cerrado. Sirve para separar, con datos, cuanto de la latencia de un analisis
   * es la propuesta y cuanto el razonamiento posterior.
   */
  private logTiming(
    startedAt: number,
    maxRequirements: number | undefined,
    outcome: 'proposed' | 'failed',
    errorCode: string | null,
    proposal: ObjectiveRequirementProposalResponseDto | null
  ): void {
    this.logger.log({
      event: OBJECTIVE_PROPOSAL_TIMING_EVENT,
      outcome,
      errorCode,
      maxRequirements: maxRequirements ?? null,
      candidateCount: proposal === null ? null : proposal.candidates.length,
      // > 0 solo cuando hubo seleccion: la propuesta costo dos llamadas al modelo.
      omittedCandidateCount: proposal === null ? null : proposal.omittedCandidates.length,
      unresolvedPassageCount:
        proposal === null ? null : proposal.unresolvedPassages.length,
      durationMs: Date.now() - startedAt
    });
  }

  private async proposeOnce(
    input: ObjectiveRequirementProposalInput,
    maxRequirements: number | undefined
  ): Promise<ObjectiveRequirementProposalResponseDto> {
    let response: unknown;
    try {
      response = await this.aiServiceClient.proposeObjectiveRequirements({
        schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_REQUEST_SCHEMA_VERSION,
        objectiveType: input.objectiveType,
        title: input.title,
        rawObjectiveText: input.rawObjectiveText,
        maxProposedRequirements: maxRequirements ?? null
      });
    } catch (error: unknown) {
      throw this.toStageError(error);
    }

    let verified;
    try {
      // El texto contra el que se verifica es el que ESTE proceso envió, no uno
      // que venga en la respuesta: verificar contra el eco del servicio remoto no
      // verificaría nada.
      verified = verifyObjectiveProposalResponse(response, input.rawObjectiveText, {
        maxCandidates: maxRequirements
      });
    } catch (error: unknown) {
      if (error instanceof ObjectiveProposalArtifactInvariantError) {
        // El AI service afirmó éxito y su artefacto no cumple el contrato
        // estructural. Repetir el mismo pedido no puede arreglarlo.
        throw new ObjectiveRequirementProposalError(
          'UNABLE_TO_PRODUCE_PROPOSAL',
          error.detail
        );
      }
      throw error;
    }

    return mapObjectiveRequirementProposal(verified);
  }

  /** Traduce el fallo de transporte a la taxonomía orientada al holder. */
  private toStageError(error: unknown): ObjectiveRequirementProposalError {
    if (!(error instanceof ObjectiveProposalTransportError)) {
      return new ObjectiveRequirementProposalError(
        'TEMPORARILY_UNAVAILABLE',
        'unexpected_transport_failure'
      );
    }

    switch (error.code) {
      case 'OBJECTIVE_TOO_LARGE':
        return new ObjectiveRequirementProposalError(
          'OBJECTIVE_TOO_LARGE',
          'ai_service_reported_objective_too_large'
        );
      case 'PROVIDER_INVALID_OUTPUT':
      case 'PROVIDER_CONFIGURATION_FAILURE':
        // Se obtuvo una respuesta y no sirve, o la petición fue rechazada de
        // forma determinista. Repetir lo mismo no puede cambiar el resultado.
        return new ObjectiveRequirementProposalError(
          'UNABLE_TO_PRODUCE_PROPOSAL',
          `ai_service_${error.code.toLowerCase()}`
        );
      case 'PROVIDER_TRANSPORT_FAILURE':
      case 'INTERNAL_AI_SERVICE_FAILURE':
        return new ObjectiveRequirementProposalError(
          'TEMPORARILY_UNAVAILABLE',
          `ai_service_${error.code.toLowerCase()}`
        );
    }
  }
}
