from __future__ import annotations

from typing import Any


def render_b22_explanation(requirement: dict[str, Any], reasoning: dict[str, Any], final_state: str, evidence: dict[str, dict[str, Any]]) -> str:
    parts = [f"Requirement: {requirement['normalizedRequirement']}.", f"Estado: {final_state}."]
    ceiling = reasoning["jointClaimCeiling"]
    if ceiling["text"]: parts.append(f"Claim ceiling: {ceiling['text']}.")
    ids = list(ceiling["supportingEvidenceUnitIds"]) + list((reasoning["weakerClaimCandidate"] or {}).get("supportingEvidenceUnitIds", []))
    quotes = [f"{evidence[item]['sourceTrace']['credentialId']} / {evidence[item]['sourceTrace']['sourceId']}: “{evidence[item]['sourceTrace']['exactExcerpt']}”" for item in dict.fromkeys(ids) if item in evidence]
    if quotes: parts.append("Evidencia: " + "; ".join(quotes) + ".")
    if reasoning["observabilityAssessment"]["observabilityStatus"] != "SUFFICIENT": parts.append("Observabilidad: " + reasoning["observabilityAssessment"]["rationale"].strip())
    return " ".join(parts)
