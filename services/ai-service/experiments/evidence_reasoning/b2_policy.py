from __future__ import annotations

from typing import Any

from .policy import final_state


def b2_final_state(
    requirement: dict[str, Any],
    reasoning: dict[str, Any],
    *,
    hard_factual_failure: bool,
) -> tuple[str, dict[str, Any]]:
    full = reasoning["fullClaimAssessment"]
    weaker = reasoning["weakerClaimCandidate"]
    observability = reasoning["observabilityAssessment"]
    weaker_unresolved = bool(
        weaker
        and (
            weaker["sameRequirementContinuity"] == "UNRESOLVED"
            or weaker["materialUsefulness"] == "UNRESOLVED"
        )
    )
    unresolved = any(
        [
            reasoning["semanticUnresolved"],
            reasoning["compositionAssessment"]["unresolved"],
            full["status"] == "UNRESOLVED",
            observability["status"] in {"MATERIAL_GAP", "UNRESOLVED"},
            weaker_unresolved,
        ]
    )
    reaches_full = full["status"] == "REACHED"
    useful = bool(weaker and weaker["materialUsefulness"] == "YES")
    continuity = bool(weaker and weaker["sameRequirementContinuity"] == "YES")
    state = final_state(
        formative_evidence_capable=requirement["evaluability"]["formativeEvidenceCapable"],
        unresolved=unresolved,
        critical_guard_failure=hard_factual_failure,
        reaches_full_requirement=reaches_full,
        has_materially_useful_weaker_claim=useful,
        weaker_claim_still_belongs_to_requirement=continuity,
    )
    return state, {
        "formativeEvidenceCapable": requirement["evaluability"]["formativeEvidenceCapable"],
        "unresolved": unresolved,
        "hardFactualFailure": hard_factual_failure,
        "reachesFullRequirement": reaches_full,
        "hasMateriallyUsefulWeakerClaim": useful,
        "weakerClaimStillBelongsToRequirement": continuity,
    }
