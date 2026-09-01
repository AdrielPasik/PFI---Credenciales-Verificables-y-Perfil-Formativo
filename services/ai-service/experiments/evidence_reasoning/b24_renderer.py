from __future__ import annotations

from typing import Any


def render_b24_explanation(
    requirement: dict[str, Any],
    reasoning: dict[str, Any],
    final_state: str,
    evidence: dict[str, dict[str, Any]],
) -> str:
    """Deterministic faithful explanation. No new semantic decision is taken here."""
    parts = [
        f"Requirement: {requirement['requirementQuote']}.",
        f"Objetivo epistemológico: {requirement['epistemicTarget']}.",
        f"Estado: {final_state}.",
    ]

    ceiling = reasoning["jointClaimCeiling"]
    if ceiling["text"]:
        parts.append(f"Claim ceiling: {ceiling['text']}.")

    search = reasoning["weakerClaimSearch"]
    candidate = search["candidate"]
    if search["status"] == "FOUND" and candidate:
        continuity = candidate["continuityAssessment"]
        parts.append(f"Claim más débil considerado: {candidate['text']}.")
        if continuity["status"] == "YES":
            parts.append(f"Continuidad: reducción constitutiva del mismo Requirement ({continuity['rationale'].strip()}).")
            if continuity["explicitlyRelaxed"]:
                parts.append("Se relaja explícitamente: " + "; ".join(continuity["explicitlyRelaxed"]) + ".")
        elif continuity["status"] == "NO":
            parts.append(f"Continuidad: no constitutiva ({continuity['shiftReason']}). {continuity['rationale'].strip()}")
        else:
            parts.append("Continuidad: no resoluble responsablemente.")
    elif search["status"] == "NONE":
        parts.append(f"Búsqueda de claim más débil: no se identificó una versión defendible. {search['rationale'].strip()}")
    elif search["status"] == "UNRESOLVED":
        parts.append(f"Búsqueda de claim más débil: no resoluble responsablemente. {search['rationale'].strip()}")

    ids = list(ceiling["supportingEvidenceUnitIds"]) + list((candidate or {}).get("supportingEvidenceUnitIds", []))
    quotes = [
        f"{evidence[item]['sourceTrace']['credentialId']} / {evidence[item]['sourceTrace']['sourceId']}: “{evidence[item]['sourceTrace']['exactExcerpt']}”"
        for item in dict.fromkeys(ids)
        if item in evidence
    ]
    if quotes:
        parts.append("Evidencia: " + "; ".join(quotes) + ".")

    if reasoning["observabilityAssessment"]["observabilityStatus"] != "SUFFICIENT":
        parts.append("Observabilidad: " + reasoning["observabilityAssessment"]["rationale"].strip())

    return " ".join(parts)
