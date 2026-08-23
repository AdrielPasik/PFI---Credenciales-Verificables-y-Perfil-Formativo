from __future__ import annotations

import re
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import build_evidence_units, exact_redundancy_and_lineage, validation
from .b21_versions import B21_VERSIONS

_WORD = re.compile(r"[a-záéíóúñü0-9]+", re.I)
_CORE_STOP = {"de", "del", "la", "el", "en", "y", "para", "con", "un", "una"}

def _tokens(text: str) -> set[str]:
    return {item.casefold() for item in _WORD.findall(text) if item.casefold() not in _CORE_STOP}

def _span(aligned: Any) -> dict[str, Any] | None:
    return {"charStart": aligned.char_start, "charEnd": aligned.char_end, "exactText": aligned.exact_text} if aligned.status in {"EXACT", "REPAIRED"} else None

def build_objective_analysis(proposal: dict[str, Any], objective: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    requirements, results, qualifier_counter = [], [], 0
    for index, item in enumerate(proposal["requirements"], 1):
        requirement_id = f"req_{index:02d}"
        req_alignment = align_quote(objective, item["requirementQuote"])
        trace_valid = req_alignment.status in {"EXACT", "REPAIRED"}
        results.append(validation("DETERMINISTIC_REPAIRABLE" if trace_valid else "HARD_FACTUAL_INVARIANT", "REQUIREMENT_TRACE_EXACT" if req_alignment.status == "EXACT" else "REQUIREMENT_QUOTE_INVALID", "PASS" if trace_valid else "FAIL", requirement_id, req_alignment.status, affects_epistemic_state=not trace_valid))
        core = item["continuityCore"]
        basis_spans = []
        for phrase in core["requirementBasisPhrases"]:
            aligned = align_quote(item["requirementQuote"], phrase)
            if aligned.status in {"EXACT", "REPAIRED"}:
                basis_spans.append({"phrase": phrase, "charStart": aligned.char_start, "charEnd": aligned.char_end, "exactText": aligned.exact_text})
        core_valid = trace_valid and len(basis_spans) == len(core["requirementBasisPhrases"]) and _tokens(core["statement"]) <= _tokens(item["requirementQuote"])
        results.append(validation("HARD_FACTUAL_INVARIANT", "CONTINUITY_CORE_REQUIREMENT_GROUNDED", "PASS" if core_valid else "FAIL", requirement_id, "basis phrases and statement reconstructibility", affects_epistemic_state=not core_valid))
        material, contextual, wrappers = [], [], []
        for qualifier in item["qualifiers"]:
            aligned = align_quote(objective, qualifier["sourcePhrase"])
            valid = aligned.status in {"EXACT", "REPAIRED"}
            record = {**qualifier, "sourceSpan": _span(aligned), "traceValid": valid}
            if qualifier["role"] == "MATERIAL_QUALIFIER":
                qualifier_counter += 1
                record["qualifierId"] = f"q_{qualifier_counter:02d}"
                material.append(record)
            elif qualifier["role"] == "CONTEXTUAL":
                contextual.append(record)
            else:
                wrappers.append(record)
            results.append(validation("DETERMINISTIC_REPAIRABLE" if valid else "HARD_FACTUAL_INVARIANT", "QUALIFIER_TRACE_EXACT" if valid else "QUALIFIER_QUOTE_INVALID", "PASS" if valid else "FAIL", record.get("qualifierId", requirement_id), aligned.status, affects_epistemic_state=not valid))
        requirements.append({"requirementId": requirement_id, "requirementQuote": item["requirementQuote"], "sourceSpan": _span(req_alignment), "traceValid": trace_valid, "normalizedRequirement": item["normalizedRequirement"], "evaluationRole": item["evaluationRole"], "atomicity": item["atomicity"], "evaluability": item["evaluability"], "continuityCore": {**core, "requirementBasisSpans": basis_spans, "traceValid": core_valid}, "materialQualifiers": material, "contextAnnotations": contextual, "structuralWrappers": wrappers})
    return {"schemaVersion": B21_VERSIONS["objectiveAnalysis"], "originalObjective": objective, "objectiveContext": proposal["objectiveContext"], "requirements": requirements}, results

def source_observability_facts(snapshots: list[dict[str, Any]], evidence_units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"sourceId": snap["source"]["sourceId"], "coverageStatus": snap["coverageStatus"], "observedEvidenceUnitIds": [eu["evidenceUnitId"] for eu in evidence_units if eu["sourceTrace"]["sourceId"] == snap["source"]["sourceId"]], "extractionDiagnostics": snap.get("diagnostics", [])} for snap in snapshots]

__all__ = ["build_evidence_units", "exact_redundancy_and_lineage", "validation", "build_objective_analysis", "source_observability_facts"]
