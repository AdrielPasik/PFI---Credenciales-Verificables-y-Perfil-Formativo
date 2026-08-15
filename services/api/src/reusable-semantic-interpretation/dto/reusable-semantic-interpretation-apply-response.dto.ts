import { ReusableSemanticInterpretationAppliedSummaryDto } from './reusable-semantic-interpretation-applied-summary.dto';

// C4b.1b: respuesta de POST .../reusable-semantic-interpretation/apply.
// changed=false + supersededPreviousApplication=false significa
// idempotente: la misma aprobacion ya estaba aplicada, no se escribio
// nada nuevo (appliedAt/appliedByDisplayLabel corresponden a la
// aplicacion original, no a este request).
export class ReusableSemanticInterpretationApplyResponseDto {
  changed!: boolean;
  supersededPreviousApplication!: boolean;
  application!: ReusableSemanticInterpretationAppliedSummaryDto;
}
