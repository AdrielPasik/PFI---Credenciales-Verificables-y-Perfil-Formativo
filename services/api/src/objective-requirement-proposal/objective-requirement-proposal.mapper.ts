/**
 * Mapeo del artefacto verificado al DTO privado — slice P2.2.
 *
 * Construye el objeto campo por campo, nunca por spread del artefacto: un spread
 * dejaría pasar automáticamente cualquier campo nuevo que el AI service agregara,
 * y la allowlist dejaría de ser una allowlist sin que nadie lo notara.
 */

import {
  OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION
} from './objective-requirement-proposal.contract';
import {
  type ObjectiveProposalCandidateDto,
  type ObjectiveProposalSourceReferenceDto,
  type ObjectiveProposalUnresolvedPassageDto,
  type ObjectiveRequirementProposalResponseDto
} from './dto/objective-requirement-proposal.dto';
import {
  type VerifiedProposalArtifact,
  type VerifiedSourceReference
} from './objective-requirement-proposal.verifier';

function mapReference(
  reference: VerifiedSourceReference
): ObjectiveProposalSourceReferenceDto {
  return {
    exactExcerpt: reference.exactExcerpt,
    charStart: reference.charStart,
    charEnd: reference.charEnd,
    offsetUnit: 'UNICODE_CODE_POINT'
  };
}

export function mapObjectiveRequirementProposal(
  artifact: VerifiedProposalArtifact
): ObjectiveRequirementProposalResponseDto {
  const candidates: ObjectiveProposalCandidateDto[] = artifact.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    order: candidate.order,
    proposedRequirementText: candidate.proposedRequirementText,
    primarySourceReference:
      candidate.primarySourceReference === null
        ? null
        : mapReference(candidate.primarySourceReference),
    primarySourceGrounding: candidate.primarySourceGrounding,
    auxiliarySourceReferences: candidate.auxiliarySourceReferences.map(mapReference),
    ambiguousReferences: candidate.ambiguousReferences.map((reference) => ({
      exactExcerpt: reference.exactExcerpt,
      occurrences: reference.occurrences
    })),
    unmatchedReferences: [...candidate.unmatchedReferences],
    sourceSectionLabel: candidate.sourceSectionLabel,
    exactDuplicateOfEarlier: candidate.exactDuplicateOfEarlier,
    confirmableAsSourceDerived: candidate.confirmableAsSourceDerived
  }));

  const unresolvedPassages: ObjectiveProposalUnresolvedPassageDto[] =
    artifact.unresolvedPassages.map((passage) => ({
      exactExcerpt: passage.exactExcerpt,
      reason: passage.reason,
      grounding: passage.grounding,
      charStart: passage.charStart,
      charEnd: passage.charEnd
    }));

  return {
    schemaVersion: OBJECTIVE_REQUIREMENT_PROPOSAL_ARTIFACT_SCHEMA_VERSION,
    authority: 'PROPOSAL_ONLY',
    humanConfirmationRequired: true,
    candidates,
    unresolvedPassages
  };
}
