from __future__ import annotations
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from .gold import load_gold

def _usage(stages: list[dict[str, Any]]) -> dict[str, int]:
    total = {"requests": len(stages), "retries": sum(int(x.get("retries") or 0) for x in stages), "latencyMs": sum(int(x.get("latencyMs") or 0) for x in stages), "inputTokens": 0, "outputTokens": 0}
    for x in stages:
        usage = x.get("usage") or {}; total["inputTokens"] += int(usage.get("input_tokens") or 0); total["outputTokens"] += int(usage.get("output_tokens") or 0)
    return total
def _majority(values: list[str]) -> str | None:
    count = Counter(values); top = count.most_common()
    return top[0][0] if top and (len(top) == 1 or top[0][1] > top[1][1]) else None
def evaluate_b23_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold = load_gold(); per: list[dict[str, Any]] = []; grouped: dict[str, list[dict[str, Any]]] = defaultdict(list); confusion: Counter[tuple[str,str]] = Counter(); ops: Counter[str] = Counter(); correct = false_supported = fabricated = wrong_source = hard_failures = 0
    for run in payload["runs"]:
        cid = run["metadata"]["caseId"]; ops.update(_usage(run["metadata"]["providerStages"]))
        if run["metadata"]["runStatus"] != "RESOLVED":
            per.append({"caseId": cid, "stateEvaluable": False, "decompositionStatus": run["metadata"]["runStatus"], "manualAdjudicationRequired": ["objective_decomposition"]}); continue
        requirement = run["03_objective_analysis"]["analysis"]["requirements"][0]; reasoning = run["05_unified_contextual_reasoning"][0]; policy = run["07_epistemic_policy"][0]; final = run["08_final_result"][0]; expected = gold[cid]["expectedState"]; actual = final["finalState"]; hard = [x for x in run["06_validation_repair"] if x["taxonomy"] == "HARD_FACTUAL_INVARIANT" and x["status"] in {"FAIL", "REJECTED"} and x["affectsEpistemicState"]]; hard_failures += len(hard); state_correct = actual == expected; correct += state_correct; false_supported += actual == "SUPPORTED" and expected != "SUPPORTED"; confusion[(expected, actual)] += 1
        fabricated += any(x["code"] == "FABRICATED_EVIDENCE" for x in run["06_validation_repair"]); wrong_source += any(x["code"] == "WRONG_SOURCE_ATTRIBUTION" for x in run["06_validation_repair"])
        weak = reasoning["weakerClaimCandidate"]; row = {"caseId": cid, "stateEvaluable": True, "expectedState": expected, "actualState": actual, "preGuardState": policy["preGuardState"], "stateCorrect": state_correct, "requirement": requirement["requirementQuote"], "observabilityStatus": reasoning["observabilityAssessment"]["observabilityStatus"], "continuityAssessment": weak["continuityAssessment"] if weak else None, "jointClaimCeiling": reasoning["jointClaimCeiling"], "hardFactualFailureCodes": [x["code"] for x in hard], "manualAdjudicationRequired": ["qualifier_roles", "facet_necessity", "facet_evidence_fitting", "relation_equivalence", "joint_claim_ceiling", "continuity", "material_usefulness", "observability"]}; per.append(row); grouped[cid].append(row)
    cases = {}; majority_correct = 0
    for cid, rows in sorted(grouped.items()):
        states = [x["actualState"] for x in rows]; majority = _majority(states); ok = majority == gold[cid]["expectedState"] if majority else False; majority_correct += ok; cases[cid] = {"expectedState": gold[cid]["expectedState"], "runCount": len(rows), "stateDistribution": dict(Counter(states)), "majorityState": majority, "majorityCorrect": ok, "stability": len(set(states)) == 1}
    return {"measurementKind": "cost_controlled_development_probe_not_benchmark_or_generalization_validation", "system": "b23", "runLevel": {"correct": correct, "correctOverRuns": f"{correct}/{len(per)}", "falseSupported": false_supported, "fabricatedEvidence": fabricated, "wrongSourceAttribution": wrong_source, "hardFactualFailures": hard_failures, "confusionMatrix": [{"expected": e, "actual": a, "count": c} for (e,a),c in sorted(confusion.items())]}, "caseLevel": {"majorityCorrectCases": f"{majority_correct}/{len(cases)}", "cases": cases}, "operation": dict(ops), "perRun": per}
def evaluate_b23_file(path: Path) -> dict[str, Any]: return evaluate_b23_payload(json.loads(path.read_text(encoding="utf-8")))
def manual_adjudication(payload: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for run in payload["runs"]:
        if run["metadata"]["runStatus"] != "RESOLVED": continue
        rows.append({"caseId": run["metadata"]["caseId"], "requirement": run["03_objective_analysis"]["analysis"]["requirements"][0], "reasoning": run["05_unified_contextual_reasoning"][0], "dimensions": {k: "MANUAL_ADJUDICATION_REQUIRED" for k in ("qualifier_roles", "facet_necessity", "facet_evidence_fitting", "relation_semantic_equivalence", "joint_claim_ceiling_faithfulness", "weaker_claim_continuity", "weaker_claim_usefulness", "observability_judgment")}})
    return {"artifact": "B23_MANUAL_ADJUDICATION", "providerCalls": 0, "rows": rows}
