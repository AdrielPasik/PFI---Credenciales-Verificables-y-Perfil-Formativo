from __future__ import annotations

from .models import FinalState


def final_state(*, formative_evidence_capable: bool, unresolved: bool, critical_guard_failure: bool,
                reaches_full_requirement: bool, has_materially_useful_weaker_claim: bool,
                weaker_claim_still_belongs_to_requirement: bool) -> str:
    if not formative_evidence_capable:
        return FinalState.NOT_ASSESSABLE.value
    if unresolved or critical_guard_failure:
        return FinalState.ABSTAIN.value
    if reaches_full_requirement:
        return FinalState.SUPPORTED.value
    if has_materially_useful_weaker_claim and weaker_claim_still_belongs_to_requirement:
        return FinalState.PARTIALLY_SUPPORTED.value
    return FinalState.INSUFFICIENT_EVIDENCE.value

