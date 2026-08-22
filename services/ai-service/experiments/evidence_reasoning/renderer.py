from __future__ import annotations

from typing import Any


def render_explanation(requirement: dict[str, Any], ceiling: dict[str, Any], final_state: str,
                       evidence_units: dict[str, dict[str, Any]]) -> str:
    parts = [f"Requirement: {requirement['normalizedRequirement']}.", f"Estado: {final_state}."]
    if ceiling.get("claimCeiling"):
        parts.append(f"Claim ceiling: {ceiling['claimCeiling']}.")
    used = [evidence_units[item] for item in ceiling.get("supportingEvidenceUnitIds", []) if item in evidence_units]
    if used:
        refs = "; ".join(
            f"{item['sourceTrace']['credentialId']} / {item['sourceTrace']['sourceId']}: “{item['sourceTrace']['exactExcerpt']}”"
            for item in used
        )
        parts.append(f"Evidencia: {refs}.")
    if ceiling.get("missingQualifiers"):
        parts.append("Qualifiers no respaldados: " + ", ".join(ceiling["missingQualifiers"]) + ".")
    if ceiling.get("missingFacetIds"):
        parts.append("Facets no cubiertas: " + ", ".join(ceiling["missingFacetIds"]) + ".")
    if ceiling.get("semanticRationale"):
        parts.append(ceiling["semanticRationale"].strip())
    return " ".join(parts)

