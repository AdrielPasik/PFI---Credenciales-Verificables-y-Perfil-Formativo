from __future__ import annotations

from collections import defaultdict
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import build_evidence_units, exact_redundancy_and_lineage, validation
from .b23_versions import B23_VERSIONS

def _span(text: str, phrase: str, *, start: int = 0, end: int | None = None) -> tuple[dict[str, Any] | None, str]:
    aligned = align_quote(text, phrase, scope_start=start, scope_end=end)
    if aligned.status not in {"EXACT", "REPAIRED"}: return None, aligned.status
    return {"charStart": int(aligned.char_start), "charEnd": int(aligned.char_end), "exactText": aligned.exact_text}, aligned.status

def build_b23_objective_analysis(proposal: dict[str, Any], objective: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []; segments: list[dict[str, Any]] = []
    for index, candidate in enumerate(proposal["candidateSegments"], 1):
        span, status = _span(objective, candidate["text"]); valid = span is not None
        results.append(validation("HARD_FACTUAL_INVARIANT", "OBJECTIVE_SEGMENT_TRACE_VALID", "PASS" if valid else "FAIL", f"segment_{index:02d}", status, affects_epistemic_state=False))
        segments.append({"segmentId": f"segment_{index:02d}", **candidate, "sourceSpan": span, "traceValid": valid})
    if proposal["decompositionStatus"] == "AMBIGUOUS":
        if proposal["requirements"]: results.append(validation("HARD_FACTUAL_INVARIANT", "AMBIGUOUS_DECOMPOSITION_MUST_NOT_SELECT_REQUIREMENT", "FAIL", "objective", "requirements_not_empty", affects_epistemic_state=False))
        return {"schemaVersion": B23_VERSIONS["objective"], "originalObjective": objective, "objectiveContext": proposal["objectiveContext"], "decompositionStatus": "AMBIGUOUS", "ambiguityRationale": proposal["ambiguityRationale"], "candidateSegments": segments, "requirements": []}, results
    evaluable = {item["text"] for item in segments if item["segmentRole"] == "EVALUABLE_REQUIREMENT" and item["traceValid"]}
    requirements: list[dict[str, Any]] = []; qcount = 0
    if not proposal["requirements"]: results.append(validation("HARD_FACTUAL_INVARIANT", "RESOLVED_DECOMPOSITION_NEEDS_REQUIREMENT", "FAIL", "objective", "empty", affects_epistemic_state=False))
    context_or_wrapper = {item["text"] for item in segments if item["segmentRole"] in {"OBJECTIVE_CONTEXT", "STRUCTURAL_WRAPPER"}}
    for index, item in enumerate(proposal["requirements"], 1):
        req_id = f"req_{index:02d}"; req_span, status = _span(objective, item["requirementQuote"]); trace_valid = req_span is not None
        results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_QUOTE_INVALID", "PASS" if trace_valid else "FAIL", req_id, status, affects_epistemic_state=not trace_valid))
        selected = item["requirementQuote"] in evaluable
        results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_SELECTED_FROM_EVALUABLE_SEGMENT", "PASS" if selected else "FAIL", req_id, item["requirementQuote"], affects_epistemic_state=not selected))
        qualifiers = []
        for raw in item["qualifiers"]:
            qcount += 1; scoped, qstatus = _span(objective, raw["sourcePhrase"], start=req_span["charStart"] if req_span else 0, end=req_span["charEnd"] if req_span else None)
            if scoped is None and req_span is not None: scoped, qstatus = _span(objective, raw["sourcePhrase"])
            valid = scoped is not None; qid = f"q_{qcount:02d}" if raw["role"] == "MATERIAL_QUALIFIER" else None
            overlap = raw["role"] == "MATERIAL_QUALIFIER" and raw["sourcePhrase"] in context_or_wrapper
            results.append(validation("HARD_FACTUAL_INVARIANT", "QUALIFIER_SCOPED_TRACE_VALID", "PASS" if valid else "FAIL", qid or f"trace_q_{qcount:02d}", qstatus, affects_epistemic_state=not valid))
            results.append(validation("HARD_FACTUAL_INVARIANT", "SEGMENTED_CONTEXT_WRAPPER_NOT_MATERIAL_QUALIFIER", "PASS" if not overlap else "FAIL", qid or f"trace_q_{qcount:02d}", raw["sourcePhrase"], affects_epistemic_state=overlap))
            qualifiers.append({**raw, "qualifierId": qid, "traceId": f"trace_q_{qcount:02d}", "sourceSpan": scoped, "traceValid": valid})
        requirements.append({"requirementId": req_id, "requirementQuote": item["requirementQuote"], "normalizedRequirement": item["normalizedRequirement"], "sourceSpan": req_span, "traceValid": trace_valid, "atomicity": item["atomicity"], "evaluability": item["evaluability"], "qualifiers": qualifiers, "materialQualifiers": [q for q in qualifiers if q["role"] == "MATERIAL_QUALIFIER"], "contextAnnotations": [q for q in qualifiers if q["role"] == "CONTEXTUAL"], "structuralWrappers": [q for q in qualifiers if q["role"] == "STRUCTURAL_WRAPPER"]})
    return {"schemaVersion": B23_VERSIONS["objective"], "originalObjective": objective, "objectiveContext": proposal["objectiveContext"], "decompositionStatus": "RESOLVED", "ambiguityRationale": proposal["ambiguityRationale"], "candidateSegments": segments, "requirements": requirements}, results

def source_observability_facts(snapshots: list[dict[str, Any]], evidence_units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observed: dict[str, list[str]] = defaultdict(list)
    for eu in evidence_units: observed[eu["sourceTrace"]["sourceId"]].append(eu["evidenceUnitId"])
    return [{"sourceId": snapshot["source"]["sourceId"], "coverageStatus": snapshot["coverageStatus"], "observedEvidenceUnitIds": observed[snapshot["source"]["sourceId"]], "extractionDiagnostics": snapshot.get("diagnostics", [])} for snapshot in snapshots]
