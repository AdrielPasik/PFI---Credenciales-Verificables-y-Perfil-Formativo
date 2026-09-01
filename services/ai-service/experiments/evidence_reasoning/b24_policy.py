from __future__ import annotations

from typing import Any

from .policy import final_state


def b24_final_state(
    requirement: dict[str, Any],
    reasoning: dict[str, Any],
    *,
    hard_factual_failure: bool,
) -> tuple[str, dict[str, Any]]:
    """Deterministic adapter over B2.4 semantic judgments.

    Unchanged in shape from B2: the frozen `final_state` mapping is reused. Only
    the inputs are adapted for the explicit search and the ordering rule.

    Ordering rule (specialist): `materialUsefulness` can only contribute after
    `continuityAssessment.status == YES`. Usefulness never rescues a semantic
    shift, so `continuity NO + usefulness YES` can never yield PARTIALLY_SUPPORTED.
    """
    full = reasoning["fullClaimAssessment"]
    search = reasoning["weakerClaimSearch"]
    candidate = search["candidate"]
    observability = reasoning["observabilityAssessment"]

    continuity_status = candidate["continuityAssessment"]["status"] if candidate else None
    usefulness = candidate["materialUsefulness"] if candidate else None

    continuity = continuity_status == "YES"
    # Usefulness only counts once continuity is YES.
    useful = bool(continuity and usefulness == "YES")

    search_unresolved = search["status"] == "UNRESOLVED"
    continuity_unresolved = continuity_status == "UNRESOLVED"
    usefulness_unresolved = bool(continuity and usefulness == "UNRESOLVED")
    # DELTA_C: an unresolved epistemic target uses the existing semantic-unresolved
    # mechanism. It never introduces a new final state and never guesses a
    # stronger target.
    target_unresolved = requirement["epistemicTarget"] == "UNRESOLVED"

    unresolved = any(
        [
            reasoning["semanticUnresolved"],
            reasoning["compositionAssessment"]["unresolved"],
            full["status"] == "UNRESOLVED",
            observability["observabilityStatus"] in {"MATERIAL_GAP", "UNRESOLVED"},
            search_unresolved,
            continuity_unresolved,
            usefulness_unresolved,
            target_unresolved,
        ]
    )

    reaches_full = full["status"] == "REACHED"
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
        "epistemicTarget": requirement["epistemicTarget"],
        "unresolved": unresolved,
        "hardFactualFailure": hard_factual_failure,
        "reachesFullRequirement": reaches_full,
        "weakerSearchStatus": search["status"],
        "weakerSearchRequired": search.get("searchRequired"),
        "continuityStatus": continuity_status,
        "materialUsefulness": usefulness,
        "hasMateriallyUsefulWeakerClaim": useful,
        "weakerClaimStillBelongsToRequirement": continuity,
        "observabilityStatus": observability["observabilityStatus"],
        "unresolvedContributors": {
            "semanticUnresolved": reasoning["semanticUnresolved"],
            "compositionUnresolved": reasoning["compositionAssessment"]["unresolved"],
            "fullClaimUnresolved": full["status"] == "UNRESOLVED",
            "observability": observability["observabilityStatus"] in {"MATERIAL_GAP", "UNRESOLVED"},
            "weakerSearchUnresolved": search_unresolved,
            "continuityUnresolved": continuity_unresolved,
            "usefulnessUnresolved": usefulness_unresolved,
            "epistemicTargetUnresolved": target_unresolved,
        },
    }
