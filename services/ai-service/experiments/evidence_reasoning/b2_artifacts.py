from __future__ import annotations

from collections import defaultdict
from typing import Any

from .b2_aligner import AlignmentResult, align_quote
from .b2_versions import B2_VERSIONS


def validation(
    taxonomy: str,
    code: str,
    status: str,
    artifact_ref: str,
    detail: str,
    *,
    affects_epistemic_state: bool,
) -> dict[str, Any]:
    return {
        "taxonomy": taxonomy,
        "code": code,
        "status": status,
        "artifactRef": artifact_ref,
        "detail": detail,
        "affectsEpistemicState": affects_epistemic_state,
    }


def _segment_for_offset(snapshot: dict[str, Any], offset: int) -> dict[str, Any] | None:
    for segment in snapshot.get("segments", []):
        if segment["charStart"] <= offset < segment["charEnd"]:
            return segment
    return None


def _page_for_offset(snapshot: dict[str, Any], offset: int) -> int | None:
    for page in snapshot.get("pages", []):
        if page["pageOffsetStart"] <= offset <= page["pageOffsetEnd"]:
            return page["pageNumber"]
    return None


def _segment_scope(snapshot: dict[str, Any], segment_id: str, original_text: str) -> tuple[int, int] | None:
    segment = next((item for item in snapshot.get("segments", []) if item["segmentId"] == segment_id), None)
    if segment is None:
        return None
    aligned = align_quote(original_text, segment["exactExcerpt"])
    if aligned.status not in {"EXACT", "REPAIRED"}:
        return None
    return int(aligned.char_start), int(aligned.char_end)


def _wrong_source_match(
    quote: str,
    claimed_source_id: str,
    originals: dict[str, str],
) -> str | None:
    matches = [
        source_id
        for source_id, text in originals.items()
        if source_id != claimed_source_id and align_quote(text, quote).status in {"EXACT", "REPAIRED"}
    ]
    return ",".join(matches) if matches else None


def build_evidence_units(
    proposals: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    originals: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_source = {item["source"]["sourceId"]: item for item in snapshots}
    accepted: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int, str]] = set()

    for proposal_index, proposal in enumerate(proposals, start=1):
        ref = f"eu_proposal_{proposal_index:02d}"
        source_id = proposal["sourceId"]
        snapshot = by_source.get(source_id)
        if snapshot is None or source_id not in originals:
            results.append(validation("HARD_FACTUAL_INVARIANT", "SOURCE_OUTSIDE_FROZEN_SET", "REJECTED", ref, source_id, affects_epistemic_state=False))
            continue

        original = originals[source_id]
        scope = _segment_scope(snapshot, proposal["segmentId"], original)
        alignment = align_quote(
            original,
            proposal["quoteText"],
            scope_start=scope[0] if scope else 0,
            scope_end=scope[1] if scope else None,
        )
        segment_repaired = False
        if alignment.status == "NOT_FOUND" and scope is not None:
            alignment = align_quote(original, proposal["quoteText"])
            segment_repaired = alignment.status in {"EXACT", "REPAIRED"}

        if alignment.status == "AMBIGUOUS":
            results.append(validation("HARD_FACTUAL_INVARIANT", "AMBIGUOUS_QUOTE", "REJECTED", ref, str(alignment.occurrence_count), affects_epistemic_state=False))
            continue
        if alignment.status == "NOT_FOUND":
            actual_source = _wrong_source_match(proposal["quoteText"], source_id, originals)
            if actual_source:
                results.append(validation("HARD_FACTUAL_INVARIANT", "WRONG_SOURCE_ATTRIBUTION", "REJECTED", ref, f"claimed={source_id};found={actual_source}", affects_epistemic_state=False))
            else:
                results.append(validation("HARD_FACTUAL_INVARIANT", "FABRICATED_EVIDENCE", "REJECTED", ref, source_id, affects_epistemic_state=False))
            continue

        start = int(alignment.char_start)
        end = int(alignment.char_end)
        key = (source_id, start, end, proposal["normalizedProposition"].casefold())
        if key in seen:
            results.append(validation("DETERMINISTIC_REPAIRABLE", "DUPLICATE_EVIDENCE_PROPOSAL", "REPAIRED", ref, source_id, affects_epistemic_state=False))
            continue
        seen.add(key)

        evidence_unit_id = f"eu_{len(accepted) + 1:02d}"
        authoritative_segment = _segment_for_offset(snapshot, start)
        if alignment.status == "REPAIRED":
            results.append(validation("DETERMINISTIC_REPAIRABLE", "TRACE_ALIGNMENT_REPAIRED", "REPAIRED", evidence_unit_id, alignment.repair or "controlled normalization", affects_epistemic_state=False))
        else:
            results.append(validation("DETERMINISTIC_REPAIRABLE", "TRACE_ALIGNMENT_EXACT", "PASS", evidence_unit_id, source_id, affects_epistemic_state=False))
        if scope is None or segment_repaired or (authoritative_segment and authoritative_segment["segmentId"] != proposal["segmentId"]):
            results.append(validation("DETERMINISTIC_REPAIRABLE", "SEGMENT_DERIVED", "REPAIRED", evidence_unit_id, authoritative_segment["segmentId"] if authoritative_segment else "none", affects_epistemic_state=False))

        context_radius = 96
        accepted.append(
            {
                "schemaVersion": B2_VERSIONS["evidenceUnitCatalog"],
                "evidenceUnitId": evidence_unit_id,
                "normalizedProposition": proposal["normalizedProposition"],
                "claimType": proposal["claimType"],
                "semanticQualifiers": proposal["semanticQualifiers"],
                "exactQuote": original[start:end],
                "contextBefore": original[max(0, start - context_radius):start],
                "contextAfter": original[end:min(len(original), end + context_radius)],
                "sectionLabel": authoritative_segment.get("sectionLabel") if authoritative_segment else None,
                "sourceTrace": {
                    "sourceId": source_id,
                    "credentialId": snapshot["source"]["credentialId"],
                    "sourceSha256": snapshot["source"]["sourceSha256"],
                    "segmentId": authoritative_segment["segmentId"] if authoritative_segment else None,
                    "pageNumber": _page_for_offset(snapshot, start),
                    "charStart": start,
                    "charEnd": end,
                    "exactExcerpt": original[start:end],
                },
                "sourceProvenance": snapshot["source"]["sourceProvenance"],
                "interpretationProvenance": "AI_INFERRED",
                "extractionQuality": snapshot["coverageStatus"],
                "lineageId": snapshot["source"].get("lineageId"),
                "technicallyVerified": snapshot["source"].get("technicallyVerified", False),
            }
        )
        results.append(validation("HARD_FACTUAL_INVARIANT", "SOURCE_SHA_IDENTITY_VALID", "PASS", evidence_unit_id, snapshot["source"]["sourceSha256"], affects_epistemic_state=False))
        results.append(validation("HARD_FACTUAL_INVARIANT", "AUTHORITATIVE_PROVENANCE_CONSTRUCTED", "PASS", evidence_unit_id, snapshot["source"]["sourceProvenance"], affects_epistemic_state=False))
    return accepted, results


def build_objective_analysis(
    proposal: dict[str, Any],
    objective: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    requirements: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    qualifier_counter = 0
    for index, item in enumerate(proposal["requirements"], start=1):
        requirement_id = f"req_{index:02d}"
        aligned = align_quote(objective, item["requirementQuote"])
        trace_valid = aligned.status in {"EXACT", "REPAIRED"}
        if not trace_valid:
            results.append(validation("HARD_FACTUAL_INVARIANT", "REQUIREMENT_QUOTE_INVALID", "FAIL", requirement_id, aligned.status, affects_epistemic_state=True))
            span = None
        else:
            span = {
                "charStart": aligned.char_start,
                "charEnd": aligned.char_end,
                "exactText": aligned.exact_text,
            }
            code = "REQUIREMENT_TRACE_REPAIRED" if aligned.status == "REPAIRED" else "REQUIREMENT_TRACE_EXACT"
            status = "REPAIRED" if aligned.status == "REPAIRED" else "PASS"
            results.append(validation("DETERMINISTIC_REPAIRABLE", code, status, requirement_id, aligned.repair or "exact", affects_epistemic_state=False))

        qualifiers: list[dict[str, Any]] = []
        for qualifier in item["materialQualifiers"]:
            qualifier_counter += 1
            qualifier_id = f"q_{qualifier_counter:02d}"
            if trace_valid:
                q_alignment = align_quote(
                    objective,
                    qualifier["sourcePhrase"],
                    scope_start=int(aligned.char_start),
                    scope_end=int(aligned.char_end),
                )
                if q_alignment.status == "NOT_FOUND":
                    q_alignment = align_quote(objective, qualifier["sourcePhrase"])
            else:
                q_alignment = align_quote(objective, qualifier["sourcePhrase"])
            q_valid = q_alignment.status in {"EXACT", "REPAIRED"}
            if q_valid:
                qualifier_span = {
                    "charStart": q_alignment.char_start,
                    "charEnd": q_alignment.char_end,
                    "exactText": q_alignment.exact_text,
                }
                code = "QUALIFIER_TRACE_REPAIRED" if q_alignment.status == "REPAIRED" else "QUALIFIER_TRACE_EXACT"
                status = "REPAIRED" if q_alignment.status == "REPAIRED" else "PASS"
                results.append(validation("DETERMINISTIC_REPAIRABLE", code, status, qualifier_id, q_alignment.repair or "exact", affects_epistemic_state=False))
            else:
                qualifier_span = None
                results.append(validation("HARD_FACTUAL_INVARIANT", "QUALIFIER_QUOTE_INVALID", "FAIL", qualifier_id, q_alignment.status, affects_epistemic_state=True))
            qualifiers.append(
                {
                    "qualifierId": qualifier_id,
                    "kind": qualifier["kind"],
                    "value": qualifier["value"],
                    "sourcePhrase": qualifier["sourcePhrase"],
                    "materiality": qualifier["materiality"],
                    "rationale": qualifier["rationale"],
                    "sourceSpan": qualifier_span,
                    "traceValid": q_valid,
                }
            )
        requirements.append(
            {
                "requirementId": requirement_id,
                "requirementQuote": item["requirementQuote"],
                "sourceSpan": span,
                "traceValid": trace_valid,
                "normalizedRequirement": item["normalizedRequirement"],
                "evaluationRole": item["evaluationRole"],
                "atomicity": item["atomicity"],
                "evaluability": item["evaluability"],
                "materialQualifiers": qualifiers,
            }
        )
    return {
        "schemaVersion": B2_VERSIONS["objectiveAnalysis"],
        "originalObjective": objective,
        "objectiveContext": proposal["objectiveContext"],
        "requirements": requirements,
    }, results


def exact_redundancy_and_lineage(evidence_units: list[dict[str, Any]]) -> list[list[str]]:
    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for item in evidence_units:
        trace = item["sourceTrace"]
        groups[("span", f"{trace['sourceSha256']}:{trace['charStart']}:{trace['charEnd']}")].append(item["evidenceUnitId"])
        if item.get("lineageId"):
            groups[("lineage", item["lineageId"])].append(item["evidenceUnitId"])
    return [list(group) for group in sorted({tuple(sorted(ids)) for ids in groups.values() if len(set(ids)) > 1})]
