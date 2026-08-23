from __future__ import annotations

from typing import Any

from .policy import final_state


def derive_resolution_closure(observable_support: dict[str, Any]) -> str:
    """Versioned deterministic truth table; semantic judgments remain model output."""
    full = observable_support["fullRequirementIndependentlyEstablished"]
    weaker = observable_support["weakerClaimIndependentlyEstablished"]
    missing = observable_support["missingMaterialCouldChangeFinalState"]
    if full == "YES":
        return "CLOSED"
    if missing == "UNRESOLVED" or weaker == "UNRESOLVED":
        return "UNRESOLVED"
    if missing == "YES":
        return "OPEN"
    return "CLOSED"  # missing=NO: an insufficient conclusion may also be closed.


def b21_states(requirement: dict[str, Any], reasoning: dict[str, Any], *, hard_factual_failure: bool) -> tuple[str, str, dict[str, Any]]:
    closure = reasoning["resolutionClosure"]
    full = reasoning["fullClaimAssessment"]
    weaker = reasoning["weakerClaimCandidate"]
    weaker_unresolved = bool(weaker and (weaker["corePreservation"] == "UNRESOLVED" or weaker["materialUsefulness"] == "UNRESOLVED"))
    unresolved = any((reasoning["semanticUnresolved"], reasoning["compositionAssessment"]["unresolved"], full["status"] == "UNRESOLVED", closure != "CLOSED", weaker_unresolved))
    reaches_full = full["status"] == "REACHED" and closure == "CLOSED"
    core = bool(weaker and weaker["corePreservation"] == "YES")
    useful = bool(weaker and weaker["materialUsefulness"] == "YES")
    kwargs = dict(formative_evidence_capable=requirement["evaluability"]["formativeEvidenceCapable"], unresolved=unresolved, reaches_full_requirement=reaches_full, has_materially_useful_weaker_claim=useful, weaker_claim_still_belongs_to_requirement=core)
    pre_guard = final_state(critical_guard_failure=False, **kwargs)
    final = final_state(critical_guard_failure=hard_factual_failure, **kwargs)
    return pre_guard, final, {"formativeEvidenceCapable": kwargs["formative_evidence_capable"], "semanticOrObservabilityUnresolved": unresolved, "hardFactualFailure": hard_factual_failure, "resolutionClosure": closure, "reachesFullRequirement": reaches_full, "corePreservation": core, "materialUsefulness": useful}
