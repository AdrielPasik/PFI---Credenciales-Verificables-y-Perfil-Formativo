from __future__ import annotations
from typing import Any
from .policy import final_state

def b23_final_state(requirement: dict[str, Any], reasoning: dict[str, Any], *, hard_factual_failure: bool) -> tuple[str, dict[str, Any]]:
    full = reasoning["fullClaimAssessment"]; weak = reasoning["weakerClaimCandidate"]; obs = reasoning["observabilityAssessment"]
    continuity = bool(weak and weak["continuityAssessment"]["status"] == "YES")
    weak_unresolved = bool(weak and (weak["continuityAssessment"]["status"] == "UNRESOLVED" or weak["materialUsefulness"] == "UNRESOLVED"))
    unresolved = any((reasoning["semanticUnresolved"], reasoning["compositionAssessment"]["unresolved"], full["status"] == "UNRESOLVED", obs["observabilityStatus"] in {"MATERIAL_GAP", "UNRESOLVED"}, weak_unresolved))
    state = final_state(formative_evidence_capable=requirement["evaluability"]["formativeEvidenceCapable"], unresolved=unresolved, critical_guard_failure=hard_factual_failure, reaches_full_requirement=full["status"] == "REACHED", has_materially_useful_weaker_claim=bool(weak and weak["materialUsefulness"] == "YES"), weaker_claim_still_belongs_to_requirement=continuity)
    return state, {"formativeEvidenceCapable": requirement["evaluability"]["formativeEvidenceCapable"], "unresolved": unresolved, "hardFactualFailure": hard_factual_failure, "reachesFullRequirement": full["status"] == "REACHED", "hasMateriallyUsefulWeakerClaim": bool(weak and weak["materialUsefulness"] == "YES"), "weakerClaimStillBelongsToRequirement": continuity, "continuityStatus": weak["continuityAssessment"]["status"] if weak else None, "observabilityStatus": obs["observabilityStatus"]}
