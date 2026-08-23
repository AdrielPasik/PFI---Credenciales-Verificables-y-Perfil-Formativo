from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .gold import load_gold


def _usage(stages: list[dict[str, Any]]) -> dict[str, int]:
    values = {"requests": len(stages), "retries": sum(int(item.get("retries") or 0) for item in stages), "latencyMs": sum(int(item.get("latencyMs") or 0) for item in stages), "inputTokens": 0, "outputTokens": 0}
    for stage in stages:
        usage = stage.get("usage") or {}; values["inputTokens"] += int(usage.get("input_tokens") or 0); values["outputTokens"] += int(usage.get("output_tokens") or 0)
    return values


def _majority(values: list[str]) -> str | None:
    counts = Counter(values)
    if not counts: return None
    top = counts.most_common()
    return top[0][0] if len(top) == 1 or top[0][1] > top[1][1] else None


def identity_frame_variability(payload: dict[str, Any]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in payload["runs"]:
        if run["metadata"]["runStatus"] != "RESOLVED": continue
        for requirement in run["03_objective_analysis"]["analysis"]["requirements"]:
            grouped[run["metadata"]["caseId"]].append({"repetition": run["metadata"].get("repetition"), "requirementQuote": requirement["requirementQuote"], "identityElements": requirement["requirementIdentityFrame"]["identityElements"], "bindings": requirement["requirementIdentityFrame"]["bindings"], "materialQualifierIds": [item["qualifierId"] for item in requirement["materialQualifiers"]]})
    cases = []
    for case_id, rows in sorted(grouped.items()):
        signatures = [json.dumps({key: row[key] for key in ("requirementQuote", "identityElements", "bindings", "materialQualifierIds")}, ensure_ascii=False, sort_keys=True) for row in rows]
        exact = len(set(signatures)) == 1
        cues = ["EXACT_STRUCTURE_MATCH" if exact else "STRUCTURAL_VARIATION"]
        if len({row["requirementQuote"] for row in rows}) > 1: cues.append("LEXICAL_VARIATION")
        if len({json.dumps(row["bindings"], sort_keys=True) for row in rows}) > 1: cues.append("BINDINGS_CHANGED")
        if len({json.dumps([(item["role"], item["basisSpans"]) for item in row["identityElements"]], sort_keys=True) for row in rows}) > 1: cues.append("BASIS_SPANS_CHANGED")
        if len({json.dumps([item["role"] for item in row["identityElements"]]) for row in rows}) > 1: cues.append("ROLE_ASSIGNMENT_CHANGED")
        cases.append({"caseId": case_id, "automaticCues": cues, "semanticStatus": "MANUAL_ADJUDICATION_REQUIRED", "repetitions": rows})
    return {"artifact": "B22_IDENTITY_FRAME_VARIABILITY", "automaticEvaluationBoundary": "No automatic semantic-equivalence or semantic-validity decision.", "cases": cases}


def evaluate_b22_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold = load_gold(); per_run = []; by_case: dict[str, list[dict[str, Any]]] = defaultdict(list); confusion: Counter[tuple[str, str]] = Counter(); operation: Counter[str] = Counter(); correct = false_supported = fabricated = wrong_source = guard_fp = 0; mapped = 0; ambiguous = 0; hard_failures = repairs = 0
    for run in payload["runs"]:
        case_id = run["metadata"]["caseId"]; operation.update(_usage(run["metadata"]["providerStages"]))
        analysis = run["03_objective_analysis"]["analysis"]
        if run["metadata"]["runStatus"] == "DECOMPOSITION_AMBIGUOUS":
            ambiguous += 1; per_run.append({"caseId": case_id, "repetition": run["metadata"].get("repetition"), "decompositionStatus": "AMBIGUOUS", "stateEvaluable": False, "manualAdjudicationRequired": ["objective_decomposition"]}); continue
        requirements = analysis["requirements"]
        if len(requirements) != 1:
            per_run.append({"caseId": case_id, "repetition": run["metadata"].get("repetition"), "decompositionStatus": "RESOLVED", "stateEvaluable": False, "manualAdjudicationRequired": ["requirement_to_gold_mapping"]}); continue
        requirement = requirements[0]; req_id = requirement["requirementId"]; reasoning = next(item for item in run["05_unified_contextual_reasoning"] if item["requirementId"] == req_id); policy = next(item for item in run["07_epistemic_policy"] if item["requirementId"] == req_id); final = next(item for item in run["08_final_result"] if item["requirementId"] == req_id)
        expected = gold[case_id]["expectedState"]; actual = final["finalState"]; state_correct = actual == expected; mapped += 1; correct += state_correct; false_supported += actual == "SUPPORTED" and expected != "SUPPORTED"; confusion[(expected, actual)] += 1
        validations = run["06_validation_repair"]; hard = [item for item in validations if item["taxonomy"] == "HARD_FACTUAL_INVARIANT" and item["status"] in {"FAIL", "REJECTED"} and item["affectsEpistemicState"]]; hard_failures += len(hard); repairs += sum(item["status"] == "REPAIRED" for item in validations)
        fabricated += any(item["code"] == "FABRICATED_EVIDENCE" for item in validations); wrong_source += any(item["code"] == "WRONG_SOURCE_ATTRIBUTION" for item in validations); guard_fp += policy["preGuardState"] == expected and actual != expected
        row = {"caseId": case_id, "repetition": run["metadata"].get("repetition"), "decompositionStatus": "RESOLVED", "stateEvaluable": True, "expectedState": expected, "actualState": actual, "preGuardState": policy["preGuardState"], "stateCorrect": state_correct, "observabilityStatus": reasoning["observabilityAssessment"]["observabilityStatus"], "independentObservableSupport": reasoning["observabilityAssessment"]["independentObservableSupport"], "hardFactualFailureCodes": [item["code"] for item in hard], "facetEvidenceFitting": "MANUAL_ADJUDICATION_REQUIRED", "manualAdjudicationRequired": ["objective_context_vs_requirement", "identity_frame_fidelity", "qualifier_roles", "facet_necessity", "facet_evidence_fitting", "relation_equivalence", "joint_claim_ceiling", "weaker_claim_derivation", "continuity", "material_usefulness", "observability"]}
        per_run.append(row); by_case[case_id].append(row)
    case_level = {}; majority_correct = 0
    for case_id, rows in sorted(by_case.items()):
        states = [row["actualState"] for row in rows]; majority = _majority(states); ok = majority == gold[case_id]["expectedState"] if majority else False; majority_correct += ok
        case_level[case_id] = {"expectedState": gold[case_id]["expectedState"], "runCount": len(rows), "stateDistribution": dict(Counter(states)), "majorityState": majority, "majorityCorrect": ok, "stability": len(set(states)) == 1, "decompositionStatusDistribution": {"RESOLVED": len(rows)}}
    return {"measurementKind": "architecture_iteration_development_evidence_not_generalization_validation", "system": "b22", "runs": len(payload["runs"]), "mappedRuns": mapped, "decompositionAmbiguousRuns": ambiguous, "runLevel": {"finalStateCorrect": correct, "correctOverMapped": f"{correct}/{mapped}", "falseSupported": false_supported, "fabricatedEvidence": fabricated, "wrongSourceAttribution": wrong_source, "hardFactualFailures": hard_failures, "deterministicRepairs": repairs, "guardFalsePositives": guard_fp, "confusionMatrix": [{"expected": e, "actual": a, "count": c} for (e, a), c in sorted(confusion.items())]}, "caseLevel": {"majorityCorrectCases": f"{majority_correct}/{len(case_level)}", "cases": case_level}, "operation": dict(operation), "perRun": per_run, "identityFrameVariability": identity_frame_variability(payload)}


def evaluate_b22_file(path: Path) -> dict[str, Any]:
    return evaluate_b22_payload(json.loads(path.read_text(encoding="utf-8")))


def manual_adjudication(payload: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for run in payload["runs"]:
        for requirement in run["03_objective_analysis"]["analysis"]["requirements"]:
            reasoning = next((item for item in run["05_unified_contextual_reasoning"] if item["requirementId"] == requirement["requirementId"]), None)
            rows.append({"caseId": run["metadata"]["caseId"], "repetition": run["metadata"].get("repetition"), "requirement": requirement, "reasoning": reasoning, "dimensions": {key: "MANUAL_ADJUDICATION_REQUIRED" for key in ("requirement_semantic_preservation", "objective_context_vs_requirement", "qualifier_roles", "identity_frame_fidelity", "identity_bindings", "facet_necessity", "facet_evidence_fitting", "relation_semantic_equivalence", "joint_claim_ceiling_faithfulness", "weaker_claim_derived_from_ceiling", "continuity", "material_usefulness", "observability_judgment")}})
    return {"artifact": "B22_MANUAL_ADJUDICATION", "providerCalls": 0, "rows": rows}


def holdout_readiness(evaluation: dict[str, Any], *, offline: str, smoke: str, fingerprint_unchanged: bool) -> dict[str, Any]:
    run = evaluation["runLevel"]
    automated = offline == "PASS" and smoke == "PASS" and fingerprint_unchanged and evaluation["mappedRuns"] == 55 and run["falseSupported"] == 0 and run["fabricatedEvidence"] == 0 and run["wrongSourceAttribution"] == 0 and run["hardFactualFailures"] == 0 and evaluation["decompositionAmbiguousRuns"] == 0
    return {"AUTOMATED_GATES": {"offlineTests": offline, "smokeTechnical": smoke, "fingerprintUnchanged": fingerprint_unchanged, "runCompletion": evaluation["mappedRuns"], "falseSupported": run["falseSupported"], "fabricatedEvidence": run["fabricatedEvidence"], "wrongSourceAttribution": run["wrongSourceAttribution"], "hardFactualFailures": run["hardFactualFailures"], "guardFalsePositives": run["guardFalsePositives"], "objectiveDecompositionAmbiguous": evaluation["decompositionAmbiguousRuns"], "developmentDistributions": evaluation["caseLevel"]["cases"]}, "AUTOMATED_HOLDOUT_GATES": "PASS" if automated else "FAIL", "HUMAN_REVIEW_GATES": {key: "REQUIRED" for key in ("Requirement semantic preservation", "IdentityFrame fidelity", "qualifier materiality", "facet necessity", "evidence-fitting", "relation equivalence", "claim ceiling", "continuity", "usefulness", "observability")}, "HUMAN_REVIEW": "REQUIRED", "HOLDOUT_CANDIDATE": "NO"}
