import type { ApprovedSemanticSnapshotSummary } from '../../issuer-course-templates/issuer-course-templates.helpers';
import type {
  ApprovalDriftStatus,
  ComparableField,
  ContentDriftStatus,
  DestinationCompatibility
} from '../reusable-semantic-interpretation.helpers';
import { ReusableSemanticInterpretationAppliedSummaryDto } from './reusable-semantic-interpretation-applied-summary.dto';

// C4b.1b: GET .../reusable-semantic-interpretation/candidate. Solo lectura
// -- nunca escribe nada. Contiene unicamente lo necesario para que el
// emisor decida si aplicar, nunca approvedSnapshot crudo ni ids internos
// mas alla de templateId (necesario para la accion de apply).
export class ReusableSemanticInterpretationCandidateResponseDto {
  templateId!: string;
  templateTitle!: string;
  snapshotSummary!: ApprovedSemanticSnapshotSummary;
  approvedAt!: string;
  approvedByDisplayLabel!: string;
  // Precondicion opaca para apply (proteccion TOCTOU) -- ver
  // toApprovalRevision en reusable-semantic-interpretation.helpers.ts.
  // Nunca sourceSemanticAnalysisId.
  approvalRevision!: string;
  approvalDriftStatus!: ApprovalDriftStatus;
  templateContentStatus!: ContentDriftStatus;
  destinationCompatibility!: DestinationCompatibility;
  changedFields!: ComparableField[];
  // Resumen de la interpretacion `active` actual para esta credencial, si
  // existe -- puede pertenecer a un template distinto al consultado aca.
  currentApplication!: ReusableSemanticInterpretationAppliedSummaryDto | null;
}
