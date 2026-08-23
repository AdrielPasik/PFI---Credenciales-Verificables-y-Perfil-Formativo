from __future__ import annotations

from typing import Any

def render_b21_explanation(requirement: dict[str, Any], reasoning: dict[str, Any], state: str, evidence_units: dict[str, dict[str, Any]]) -> str:
    ceiling = reasoning["jointClaimCeiling"]
    refs = "; ".join(f"{evidence_units[item]['sourceTrace']['credentialId']} / {evidence_units[item]['sourceTrace']['sourceId']}: “{evidence_units[item]['sourceTrace']['exactExcerpt']}”" for item in ceiling["supportingEvidenceUnitIds"] if item in evidence_units)
    text = f"Requirement: {requirement['normalizedRequirement']}. Estado: {state}. Claim ceiling: {ceiling['text']}."
    if refs: text += f" Evidencia: {refs}."
    if reasoning["weakerClaimCandidate"]: text += f" Claim más débil: {reasoning['weakerClaimCandidate']['text']}."
    return text
