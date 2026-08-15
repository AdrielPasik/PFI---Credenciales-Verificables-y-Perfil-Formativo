import { BadRequestException } from '@nestjs/common';

const INVALID_BODY_MESSAGE =
  'El cuerpo de la solicitud no tiene un formato válido.';

export interface ValidatedApplyInput {
  templateId: string;
  approvalRevision: string;
  acknowledgeDestinationDrift: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// approvalRevision es siempre un ISO 8601 (toApprovalRevision en
// reusable-semantic-interpretation.helpers.ts) -- se valida que sea
// parseable, nunca se confia en su contenido mas alla de eso: la
// comparacion real ocurre server-side contra el template actual.
function isParseableIsoDate(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateApplyReusableSemanticInterpretationPayload(
  body: unknown
): ValidatedApplyInput {
  if (!isRecord(body)) {
    throw new BadRequestException(INVALID_BODY_MESSAGE);
  }

  const { templateId, approvalRevision, acknowledgeDestinationDrift } = body;

  if (typeof templateId !== 'string' || templateId.trim().length === 0) {
    throw new BadRequestException('templateId es requerido.');
  }

  if (
    typeof approvalRevision !== 'string' ||
    !isParseableIsoDate(approvalRevision)
  ) {
    throw new BadRequestException('approvalRevision es requerido.');
  }

  if (
    acknowledgeDestinationDrift !== undefined &&
    typeof acknowledgeDestinationDrift !== 'boolean'
  ) {
    throw new BadRequestException(
      'acknowledgeDestinationDrift debe ser booleano.'
    );
  }

  return {
    templateId: templateId.trim(),
    approvalRevision,
    acknowledgeDestinationDrift: acknowledgeDestinationDrift === true
  };
}
