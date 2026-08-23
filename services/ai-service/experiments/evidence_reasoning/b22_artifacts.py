from __future__ import annotations

from collections import defaultdict
from typing import Any

from .b2_aligner import align_quote
from .b2_artifacts import build_evidence_units, exact_redundancy_and_lineage, validation
from .b22_versions import B22_VERSIONS


def _span(text: str, phrase: str, *, start: int = 0, end: int | None = None) -> tuple[dict[str, Any] | None, str]:
    aligned = align_quote(text, phrase, scope_start=start, scope_end=end)
    if aligned.status not in {"EXACT", "REPAIRED"}:
        return None, aligned.status
    return {"charStart": int(aligned.char_start), "charEnd": int(aligned.char_end), "exactText": aligned.exact_text}, aligned.status


def _scoped_spans(objective: str, requirement_span: dict[str, Any] | None, phrases: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    spans: list[dict[str, Any]] = []; failures: list[str] = []
    if requirement_span is None:
        return spans, list(phrases)
    for phrase in phrases:
        span, status = _span(objective, phrase, start=requirement_span["charStart"], end=requirement_span["charEnd"])
        if span is None:
            failures.append(f"{phrase}:{status}")
        else:
            spans.append(span)
    return spans, failures


def build_b22_objective_analysis(proposal: dict[str, Any], objective: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    for index, candidate in enumerate(proposal["candidateSegments"], start=1):
        span, status = _span(objective, candidate["text"])
        valid = span is not None
        results.append(validation("HARD_FACTUAL_INVARIANT", "OBJECTIVE_SEGMENT_TRACE_VALID", "PASS" if valid else "FAIL", f"segment_{index:02d}", status, affects_epistemic_state=False))
        segments.append({"segmentId": f"segment_{index:02d}", **candidate, "sourceSpan": span, "traceValid": valid})

    status = proposal["decompositionStatus"]
    if status == "AMBIGUOUS":
        if proposal["requirements"]:
            results.append(validation("HARD_FACTUAL_INVARIANT", "AMBIGUOUS_DECOMPOSITION_MUST_NOT_SELECT_REQUIREMENT", "FAIL", "objective", "requirements_not_empty", affects_epistemic_state=False))
        return {
            "schemaVersion": B22_VERSIONS["objective"], "originalObjective": objective, "objectiveContext": proposal["objectiveContext"],
            "decompositionStatus": status, "ambiguityRationale": proposal["ambiguityRationale"], "candidateSegments": segments, "requirements": [],
        }, results

    if not proposal["requirements"]:
        results.append(validation("HARD_FACTUAL_INVARIANT", "RESOLVED_DECOMPOSITION_NEEDS_REQUIREMENT", "FAIL", "objective", "empty", affects_epistemic_state=False))

    requirements: list[dict[str, Any]] = []; qualifier_counter = 0
    evaluable_quotes = {segment["text"] for segment in segments if segment["segmentRole"] == "EVALUABLE_REQUIREMENT" and segment["traceValid"]}
    for req_index, item in enumerate(proposal["requirements"], start=1):
        requirement_id = f"req_{req_index:02d}"
        req_span, req_status = _span(objective, item["requirementQuote"])
        trace_valid = req_span is not None
        results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_QUOTE_INVALID", "PASS" if trace_valid else "FAIL", requirement_id, req_status, affects_epistemic_state=not trace_valid))
        segment_ok = item["requirementQuote"] in evaluable_quotes
        results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_SELECTED_FROM_EVALUABLE_SEGMENT", "PASS" if segment_ok else "FAIL", requirement_id, item["requirementQuote"], affects_epistemic_state=not segment_ok))

        qualifiers: list[dict[str, Any]] = []; material_by_phrase: dict[str, str] = {}
        for raw in item["qualifiers"]:
            qualifier_counter += 1
            scoped, scoped_status = _span(objective, raw["sourcePhrase"], start=req_span["charStart"] if req_span else 0, end=req_span["charEnd"] if req_span else None)
            if scoped is None and req_span is not None:
                scoped, scoped_status = _span(objective, raw["sourcePhrase"])
            valid = scoped is not None
            trace_id = f"trace_q_{qualifier_counter:02d}"
            qualifier_id = f"q_{qualifier_counter:02d}" if raw["role"] == "MATERIAL_QUALIFIER" else None
            if qualifier_id:
                material_by_phrase[raw["sourcePhrase"]] = qualifier_id
            results.append(validation("HARD_FACTUAL_INVARIANT", "QUALIFIER_SCOPED_TRACE_VALID", "PASS" if valid else "FAIL", qualifier_id or trace_id, scoped_status, affects_epistemic_state=not valid))
            qualifiers.append({**raw, "qualifierId": qualifier_id, "traceId": trace_id, "sourceSpan": scoped, "traceValid": valid})

        frame_raw = item["identityFrame"]; elements: list[dict[str, Any]] = []
        for element_index, raw_element in enumerate(frame_raw["identityElements"], start=1):
            element_id = f"{requirement_id}_identity_{element_index:02d}"
            basis_spans, failed_phrases = _scoped_spans(objective, req_span, raw_element["basisPhrases"])
            valid = not failed_phrases and bool(basis_spans)
            results.append(validation("HARD_FACTUAL_INVARIANT", "IDENTITY_BASIS_WITHIN_REQUIREMENT", "PASS" if valid else "FAIL", element_id, str(failed_phrases), affects_epistemic_state=not valid))
            material_ids = [material_by_phrase[phrase] for phrase in raw_element["materialQualifierPhrases"] if phrase in material_by_phrase]
            unbound_phrases = sorted(set(raw_element["materialQualifierPhrases"]) - set(material_by_phrase))
            results.append(validation("HARD_FACTUAL_INVARIANT", "IDENTITY_MATERIAL_QUALIFIER_IDS_EXIST", "PASS", element_id, str(material_ids), affects_epistemic_state=False))
            if unbound_phrases:
                results.append(validation("SEMANTIC_CONSISTENCY", "IDENTITY_QUALIFIER_BINDING_UNRESOLVED", "MANUAL_ADJUDICATION_REQUIRED", element_id, str(unbound_phrases), affects_epistemic_state=False))
            elements.append({"elementId": element_id, "role": raw_element["role"], "basisSpans": basis_spans, "normalizedMeaning": raw_element["normalizedMeaning"], "materialQualifierIds": material_ids, "unboundMaterialQualifierPhrases": unbound_phrases})
        bindings: list[dict[str, Any]] = []
        for binding_index, raw_binding in enumerate(frame_raw["bindings"], start=1):
            from_index, to_index = raw_binding["fromElementIndex"], raw_binding["toElementIndex"]
            valid = 0 <= from_index < len(elements) and 0 <= to_index < len(elements)
            results.append(validation("HARD_FACTUAL_INVARIANT", "IDENTITY_BINDING_REFERENCES_EXIST", "PASS" if valid else "FAIL", f"{requirement_id}_binding_{binding_index:02d}", f"{from_index}->{to_index}", affects_epistemic_state=not valid))
            if valid:
                bindings.append({"bindingId": f"{requirement_id}_binding_{binding_index:02d}", "fromElementId": elements[from_index]["elementId"], "relation": raw_binding["relation"], "toElementId": elements[to_index]["elementId"]})
        requirements.append({
            "requirementId": requirement_id, "requirementQuote": item["requirementQuote"], "normalizedRequirement": item["normalizedRequirement"],
            "sourceSpan": req_span, "traceValid": trace_valid, "atomicity": item["atomicity"], "evaluability": item["evaluability"],
            "qualifiers": qualifiers, "materialQualifiers": [item for item in qualifiers if item["role"] == "MATERIAL_QUALIFIER"],
            "contextAnnotations": [item for item in qualifiers if item["role"] == "CONTEXTUAL"], "structuralWrappers": [item for item in qualifiers if item["role"] == "STRUCTURAL_WRAPPER"],
            "requirementIdentityFrame": {"identityElements": elements, "bindings": bindings},
        })
    return {
        "schemaVersion": B22_VERSIONS["objective"], "originalObjective": objective, "objectiveContext": proposal["objectiveContext"],
        "decompositionStatus": status, "ambiguityRationale": proposal["ambiguityRationale"], "candidateSegments": segments, "requirements": requirements,
    }, results


def source_observability_facts(snapshots: list[dict[str, Any]], evidence_units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observed: dict[str, list[str]] = defaultdict(list)
    for eu in evidence_units:
        observed[eu["sourceTrace"]["sourceId"]].append(eu["evidenceUnitId"])
    return [{"sourceId": snapshot["source"]["sourceId"], "coverageStatus": snapshot["coverageStatus"], "observedEvidenceUnitIds": observed[snapshot["source"]["sourceId"]], "extractionDiagnostics": snapshot.get("diagnostics", [])} for snapshot in snapshots]
