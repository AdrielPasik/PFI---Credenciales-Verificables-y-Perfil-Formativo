import type { ApprovedSemanticSnapshotSummary } from '../../issuer-course-templates/issuer-course-templates.helpers';
import type {
  ApprovalDriftStatus,
  ComparableField,
  ContentDriftStatus,
  DestinationCompatibility
} from '../reusable-semantic-interpretation.helpers';

// C4b.1b: resumen allowlisted de la interpretacion actualmente `active`
// para una credencial (o de la que se acaba de aplicar/reaplicar).
// Reutilizado por GET .../reusable-semantic-interpretation (read) y por
// GET .../candidate (currentApplication) y por la respuesta de apply.
//
// Nunca expone: sourceCredentialId, sourceSemanticAnalysisId,
// sourceApprovedByUserId, appliedByUserId (id crudo), approvedSnapshot
// completo, pipelineVersion, taxonomyVersion, analysisJson, evidenceMap,
// textForEmbedding, storage, ni ningun dato privado del holder.
export class ReusableSemanticInterpretationAppliedSummaryDto {
  templateId!: string;
  templateTitle!: string;
  snapshotSummary!: ApprovedSemanticSnapshotSummary | null;
  appliedAt!: string;
  appliedByDisplayLabel!: string;
  // Recalculados siempre en vivo contra el estado actual del template y de
  // la credencial destino -- nunca persistidos, nunca cacheados.
  approvalDriftStatus!: ApprovalDriftStatus;
  templateContentStatus!: ContentDriftStatus;
  destinationCompatibility!: DestinationCompatibility;
  changedFields!: ComparableField[];
}
