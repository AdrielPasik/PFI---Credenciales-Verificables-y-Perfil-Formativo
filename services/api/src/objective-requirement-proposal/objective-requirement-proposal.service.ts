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

import { Injectable } from '@nestjs/common';

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

@Injectable()
export class ObjectiveRequirementProposalService {
  public constructor(private readonly aiServiceClient: AiServiceClient) {}

  public async propose(
    input: ObjectiveRequirementProposalInput
  ): Promise<ObjectiveRequirementProposalResponseDto> {
    let response: unknown;
    try {
      response = await this.aiServiceClient.proposeObjectiveRequirements({
        schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_REQUEST_SCHEMA_VERSION,
        objectiveType: input.objectiveType,
        title: input.title,
        rawObjectiveText: input.rawObjectiveText
      });
    } catch (error: unknown) {
      throw this.toStageError(error);
    }

    let verified;
    try {
      // El texto contra el que se verifica es el que ESTE proceso envió, no uno
      // que venga en la respuesta: verificar contra el eco del servicio remoto no
      // verificaría nada.
      verified = verifyObjectiveProposalResponse(response, input.rawObjectiveText);
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
