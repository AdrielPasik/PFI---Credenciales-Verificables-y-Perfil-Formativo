/**
 * Validador estricto del request de `/me/reasoning-runs` — slice F3.7.
 *
 * Escrito a mano, igual que `objective-request.validator.ts`: el repo no tiene
 * `ValidationPipe` global ni `class-validator`, y su convención real es rechazar
 * explícitamente lo que no pertenece al contrato.
 *
 * LA SUPERFICIE DE ENTRADA ES UN SOLO CAMPO, y eso es la mitad de la seguridad
 * de este slice. Todo lo que decide QUÉ se evalúa y CONTRA QUÉ evidencia lo
 * resuelve el servidor desde la identidad autenticada:
 *
 *     el Objective se lee acotado por `ownerUserId`
 *     el inventario lo congela F3.2 recorriendo las credenciales del holder
 *     el plan de ejecución lo congela F3.3 desde configuración de servidor
 *
 * Un cliente que pudiera aportar credenciales, fuentes o Requirements podría
 * hacer que el sistema razonara sobre un universo que él eligió, y el resultado
 * dejaría de ser una observación sobre la evidencia real del holder.
 */

import { BadRequestException } from '@nestjs/common';

import { type CreateReasoningRunRequestDto } from './dto/reasoning-run.dto';

const ROOT_KEYS = new Set(['objectiveId']);

/**
 * Campos que el SERVIDOR posee y el cliente no puede aportar.
 *
 * Se nombran para poder responder "esto lo pone el servidor" en vez del genérico
 * de campo desconocido: quien manda `ownerUserId` no escribió mal una clave, se
 * equivocó de modelo de autoridad.
 */
const SERVER_OWNED_KEYS = new Set([
  // Identidad: sale EXCLUSIVAMENTE del principal autenticado.
  'ownerUserId',
  'userId',
  'holderId',
  'holderUserId',
  'subjectUserId',
  // Universo de evidencia: lo congela F3.2, no el llamante.
  'credentialId',
  'credentialIds',
  'evidenceId',
  'evidenceIds',
  'sourceId',
  'sourceIds',
  'inventory',
  'evidenceUnits',
  // Autoridad del Objective: se lee de la fila, no se acepta.
  'objective',
  'objectiveDefinition',
  'objectiveDefinitionSnapshot',
  'objectiveTitleSnapshot',
  'requirements',
  'definition',
  // Ejecución y proveedor: no existen en esta frontera.
  'executionMetadata',
  'provider',
  'model',
  'promptVersion',
  'adapterVersion',
  'reasoningEffort',
  'deterministicPolicyVersion',
  // Lifecycle y artifacts: los escribe el dominio.
  'status',
  'failureCode',
  'resultArtifact',
  'objectiveAnalysisArtifact',
  'evidenceUnitsArtifact',
  'createdAt',
  'startedAt',
  'completedAt',
  'failedAt'
]);

function invalid(message: string): never {
  throw new BadRequestException(message);
}

export function mapCreateReasoningRunRequest(
  body: unknown
): CreateReasoningRunRequestDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('El body debe ser un objeto JSON.');
  }

  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (SERVER_OWNED_KEYS.has(key)) {
      invalid(`El campo "${key}" lo determina el servidor y no puede enviarse.`);
    }
    if (!ROOT_KEYS.has(key)) {
      invalid('El body contiene propiedades no permitidas.');
    }
  }

  const objectiveId = record.objectiveId;
  if (typeof objectiveId !== 'string') {
    invalid('objectiveId es obligatorio y debe ser un string.');
  }
  // No se normaliza: el id se usa tal cual para una consulta acotada por dueño.
  if (objectiveId.trim().length === 0) {
    invalid('objectiveId no puede estar vacio.');
  }

  return { objectiveId };
}
