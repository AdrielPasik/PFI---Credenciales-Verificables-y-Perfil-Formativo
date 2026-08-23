from __future__ import annotations

from typing import Any


def render_b2_explanation(
    requirement: dict[str, Any],
    reasoning: dict[str, Any],
    final_state: str,
    evidence_units: dict[str, dict[str, Any]],
) -> str:
    parts = [
        f"Requirement: {requirement['normalizedRequirement']}.",
        f"Estado: {final_state}.",
    ]
    ceiling = reasoning["jointClaimCeiling"]
    if ceiling["text"]:
        parts.append(f"Claim ceiling: {ceiling['text']}.")
    used_ids = list(ceiling["supportingEvidenceUnitIds"])
    weaker = reasoning["weakerClaimCandidate"]
    if weaker:
        used_ids.extend(weaker["supportingEvidenceUnitIds"])
    used = [evidence_units[item] for item in dict.fromkeys(used_ids) if item in evidence_units]
    if used:
        refs = "; ".join(
            f"{item['sourceTrace']['credentialId']} / {item['sourceTrace']['sourceId']}: “{item['sourceTrace']['exactExcerpt']}”"
            for item in used
        )
        parts.append(f"Evidencia: {refs}.")
    missing = reasoning["fullClaimAssessment"]["missingQualifierIds"]
    if missing:
        qualifier_by_id = {item["qualifierId"]: item["value"] for item in requirement["materialQualifiers"]}
        parts.append("Qualifiers no respaldados: " + ", ".join(qualifier_by_id.get(item, item) for item in missing) + ".")
    if weaker:
        parts.append(f"Claim más débil: {weaker['text']}.")
    if reasoning["observabilityAssessment"]["status"] != "SUFFICIENT":
        parts.append("Observabilidad: " + reasoning["observabilityAssessment"]["rationale"].strip())
    if reasoning["semanticUnresolved"] and reasoning["unresolvedReason"]:
        parts.append("No resuelto: " + reasoning["unresolvedReason"].strip())
    return " ".join(parts)
