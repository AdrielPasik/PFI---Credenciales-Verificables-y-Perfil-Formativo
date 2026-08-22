from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .gold import load_gold


def _actual(run: dict[str, Any]) -> list[dict[str, Any]]:
    system = run["metadata"]["system"]
    if system == "B1A_SINGLE_SHOT":
        output = run["singleShotOutput"]
        requirements = {item["requirementId"]: item for item in output["objectiveAnalysis"]["requirements"]}
        eu_sources = {item["evidenceUnitId"]: item["sourceId"] for item in output["evidenceUnits"]}
        relation_by_requirement: dict[str, list[dict[str, str]]] = defaultdict(list)
        for item in output["relations"]["relations"]:
            relation_by_requirement[item["requirementId"]].append(
                {"sourceId": eu_sources.get(item["evidenceUnitId"], "INVALID"), "relation": item["relation"]}
            )
        ceilings = {item["requirementId"]: item for item in output["claimCeilings"]["requirements"]}
        return [
            {
                "requirementId": item["requirementId"],
                "finalState": item["finalState"],
                "relations": relation_by_requirement.get(item["requirementId"], []),
                "claimCeiling": ceilings.get(item["requirementId"], {}).get("claimCeiling", ""),
                "evidenceSet": ceilings.get(item["requirementId"], {}).get("supportingEvidenceUnitIds", []),
                "requirementQualifiers": [q["value"] for q in requirements.get(item["requirementId"], {}).get("qualifiers", [])],
                "supportedQualifiers": ceilings.get(item["requirementId"], {}).get("supportedQualifiers", []),
                "missingQualifiers": ceilings.get(item["requirementId"], {}).get("missingQualifiers", []),
            }
            for item in output["finalStates"]
        ]
    if system == "B1B_HYBRID":
        requirements = {item["requirementId"]: item for item in run["03_objective_analysis"]["requirements"]}
        eu_sources = {item["evidenceUnitId"]: item["sourceTrace"]["sourceId"] for item in run["02_evidence_units"]}
        relation_by_requirement: dict[str, list[dict[str, str]]] = defaultdict(list)
        for item in run["04_relations"]["relations"]:
            relation_by_requirement[item["requirementId"]].append(
                {"sourceId": eu_sources.get(item["evidenceUnitId"], "INVALID"), "relation": item["relation"]}
            )
        return [
            {
                "requirementId": item["requirementId"],
                "finalState": item["finalState"],
                "relations": relation_by_requirement.get(item["requirementId"], []),
                "claimCeiling": item["claimCeiling"]["claimCeiling"],
                "evidenceSet": item["claimCeiling"]["supportingEvidenceUnitIds"],
                "requirementQualifiers": [q["value"] for q in requirements.get(item["requirementId"], {}).get("qualifiers", [])],
                "supportedQualifiers": item["claimCeiling"]["supportedQualifiers"],
                "missingQualifiers": item["claimCeiling"]["missingQualifiers"],
            }
            for item in run["08_final_result"]
        ]
    return []


def evaluate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold = load_gold()
    per_run: list[dict[str, Any]] = []
    confusion: Counter[tuple[str, str]] = Counter()
    states_correct = 0
    states_total = 0
    false_supported = 0
    positive_claims = 0
    guard_failures = 0
    hallucinated_evidence = 0
    relations_correct = 0
    qualifier_accounted = 0
    qualifier_total = 0
    invented_qualifiers = 0
    source_alignment_pass = 0
    source_alignment_total = 0
    latency_ms = 0
    input_tokens = 0
    output_tokens = 0
    by_case_observations: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for run in payload.get("runs", []):
        case_id = run["metadata"]["caseId"]
        expected = gold[case_id]
        actual_items = _actual(run)
        actual = actual_items[0] if actual_items else None
        state = actual["finalState"] if actual else "MISSING"
        expected_state = expected["expectedState"]
        correct = state == expected_state
        states_correct += int(correct)
        states_total += 1
        confusion[(expected_state, state)] += 1
        false_supported += int(state == "SUPPORTED" and expected_state != "SUPPORTED")
        positive_claims += int(state in {"SUPPORTED", "PARTIALLY_SUPPORTED"})
        relation_expected = {(item["sourceId"], item["relation"]) for item in expected["expectedRelations"]}
        relation_actual = {(item["sourceId"], item["relation"]) for item in (actual or {}).get("relations", [])}
        relations_exact = relation_actual == relation_expected
        relations_correct += int(relations_exact)

        required_qualifiers = {item.casefold() for item in (actual or {}).get("requirementQualifiers", [])}
        supported_qualifiers = {item.casefold() for item in (actual or {}).get("supportedQualifiers", [])}
        missing_qualifiers = {item.casefold() for item in (actual or {}).get("missingQualifiers", [])}
        qualifier_total += len(required_qualifiers)
        qualifier_accounted += len(required_qualifiers & (supported_qualifiers | missing_qualifiers))
        invented_qualifiers += len(supported_qualifiers - required_qualifiers)

        by_case_observations[case_id].append(
            {
                "state": state,
                "evidenceSet": sorted((actual or {}).get("evidenceSet", [])),
                "relations": sorted(relation_actual),
                "claimCeiling": (actual or {}).get("claimCeiling", ""),
            }
        )

        guards = run.get("guardResults", run.get("07_guard_results", []))
        failed = [item for item in guards if item["status"] == "FAIL"]
        guard_failures += len(failed)
        hallucinated_evidence += sum(
            1 for item in failed if item["guard"] in {"eu_source_exists", "excerpt_offsets_align", "b1a_citations_source_aligned"}
        )
        alignment_guards = [
            item for item in guards
            if item["guard"] in {"eu_source_exists", "excerpt_offsets_align", "b1a_citations_source_aligned"}
        ]
        source_alignment_total += len(alignment_guards)
        source_alignment_pass += sum(item["status"] == "PASS" for item in alignment_guards)
        for stage in run["metadata"].get("providerStages", []):
            latency_ms += int(stage.get("latencyMs") or 0)
            usage = stage.get("usage") or {}
            input_tokens += int(usage.get("input_tokens") or usage.get("input_tokens_count") or 0)
            output_tokens += int(usage.get("output_tokens") or usage.get("output_tokens_count") or 0)
        per_run.append(
            {
                "caseId": case_id,
                "split": run["metadata"]["split"],
                "system": run["metadata"]["system"],
                "repetition": run["metadata"].get("repetition"),
                "expectedState": expected_state,
                "phenomenon": expected["phenomenon"],
                "actualState": state,
                "stateCorrect": correct,
                "relationsExact": relations_exact,
                "claimCeilingExact": (actual or {}).get("claimCeiling") == expected["expectedClaimCeiling"],
                "manualAdjudicationRequired": ["claim_ceiling_semantic_faithfulness", "weaker_claim_usefulness"],
                "failedGuards": failed,
            }
        )

    stability = {case_id: _stability(items) for case_id, items in by_case_observations.items()}
    composition_phenomena = {
        "valid_multi_evidence_composition",
        "invalid_composition",
        "redundancy",
        "missing_essential_facet_with_useful_partial",
    }
    composition_cases = [row for row in per_run if row["phenomenon"] in composition_phenomena]
    not_assessable_cases = [row for row in per_run if row["expectedState"] == "NOT_ASSESSABLE"]
    abstain_cases = [row for row in per_run if row["expectedState"] == "ABSTAIN"]
    return {
        "measurementKind": "engineering_pilot_not_validated_scientific_performance",
        "system": payload.get("system"),
        "runs": states_total,
        "finalStateCorrect": states_correct,
        "finalStateAccuracy": states_correct / states_total if states_total else None,
        "falseSupported": false_supported,
        "positiveClaims": positive_claims,
        "guardFailures": guard_failures,
        "hallucinatedEvidenceSignals": hallucinated_evidence,
        "sourceAlignmentRate": source_alignment_pass / source_alignment_total if source_alignment_total else None,
        "relationsExactRate": relations_correct / states_total if states_total else None,
        "qualifierAccountingRate": qualifier_accounted / qualifier_total if qualifier_total else None,
        "inventedQualifierCount": invented_qualifiers,
        "compositionCriticalStateCorrectRate": _correct_rate(composition_cases),
        "falseCompositionCount": sum(row["phenomenon"] == "invalid_composition" and row["actualState"] == "SUPPORTED" for row in per_run),
        "depthOrMultiplicityInflationCount": sum(
            row["phenomenon"] in {"limited_depth", "redundancy", "blockchain_orthogonality"}
            and row["actualState"] == "SUPPORTED"
            for row in per_run
        ),
        "notAssessableCorrectRate": _correct_rate(not_assessable_cases),
        "abstainCorrectRate": _correct_rate(abstain_cases),
        "operation": {"latencyMs": latency_ms, "inputTokens": input_tokens, "outputTokens": output_tokens},
        "confusionMatrix": [
            {"expected": expected, "actual": actual, "count": count}
            for (expected, actual), count in sorted(confusion.items())
        ],
        "stability": stability,
        "perRun": per_run,
    }


def evaluate_file(path: Path) -> dict[str, Any]:
    return evaluate_payload(json.loads(path.read_text(encoding="utf-8")))


def compare_files(b1a_path: Path, b1b_path: Path) -> dict[str, Any]:
    a = evaluate_file(b1a_path)
    b = evaluate_file(b1b_path)
    return {
        "comparisonSchemaVersion": "evidence_reasoning_comparison_v1",
        "measurementKind": "engineering_pilot_not_validated_scientific_performance",
        "b1a": a,
        "b1b": b,
        "delta": {
            "finalStateAccuracy": _delta(b["finalStateAccuracy"], a["finalStateAccuracy"]),
            "falseSupported": b["falseSupported"] - a["falseSupported"],
            "hallucinatedEvidenceSignals": b["hallucinatedEvidenceSignals"] - a["hallucinatedEvidenceSignals"],
        },
    }


def _delta(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    return left - right


def _correct_rate(rows: list[dict[str, Any]]) -> float | None:
    return sum(row["stateCorrect"] for row in rows) / len(rows) if rows else None


def _stability(items: list[dict[str, Any]]) -> dict[str, Any]:
    states = [item["state"] for item in items]
    evidence_sets = [set(item["evidenceSet"]) for item in items]
    relations = [tuple(item["relations"]) for item in items]
    ceilings = [item["claimCeiling"] for item in items]
    jaccards: list[float] = []
    for left, right in zip(evidence_sets, evidence_sets[1:]):
        union = left | right
        jaccards.append(len(left & right) / len(union) if union else 1.0)
    return {
        "states": states,
        "finalStateAgreement": len(set(states)) == 1,
        "evidenceSetMeanAdjacentJaccard": sum(jaccards) / len(jaccards) if jaccards else None,
        "relationAgreement": len(set(relations)) == 1,
        "claimCeilingAgreement": len(set(ceilings)) == 1,
    }
