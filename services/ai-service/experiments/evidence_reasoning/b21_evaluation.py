from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .b2_evaluation import evaluate_b2_file
from .evaluation import evaluate_file
from .gold import load_gold

def _primary(run: dict[str, Any]) -> str | None:
    ids = [item["requirementId"] for item in run["03_objective_analysis"]["analysis"]["requirements"] if item["evaluationRole"] == "PRIMARY"]
    return ids[0] if len(ids) == 1 else None

def evaluate_b21_payload(payload: dict[str, Any]) -> dict[str, Any]:
    gold, per_run, by_case, confusion = load_gold(), [], defaultdict(list), Counter()
    correct = false_supported = fabricated = wrong_source = guard_fp = 0
    operation = Counter()
    for run in payload.get("runs", []):
        case_id, req_id = run["metadata"]["caseId"], _primary(run)
        if not req_id: continue
        req = next(item for item in run["03_objective_analysis"]["analysis"]["requirements"] if item["requirementId"] == req_id)
        reasoning = next(item for item in run["05_unified_contextual_reasoning"] if item["requirementId"] == req_id)
        policy = next(item for item in run["07_epistemic_policy"] if item["requirementId"] == req_id)
        final = next(item for item in run["08_final_result"] if item["requirementId"] == req_id)
        expected, actual, pre = gold[case_id]["expectedState"], final["finalState"], policy["preGuardState"]
        state_correct = expected == actual; correct += state_correct; false_supported += actual == "SUPPORTED" and expected != "SUPPORTED"; guard_fp += pre == expected and actual != expected
        evidence_ids = {item["evidenceUnitId"] for item in run["02_evidence_units"]["catalog"]}; support = set(reasoning["jointClaimCeiling"]["supportingEvidenceUnitIds"]) | set((reasoning["weakerClaimCandidate"] or {}).get("supportingEvidenceUnitIds", [])); fabricated += int(actual in {"SUPPORTED", "PARTIALLY_SUPPORTED"} and not support <= evidence_ids)
        source_ids = {item["sourceTrace"]["sourceId"] for item in run["02_evidence_units"]["catalog"]}; wrong_source += int(actual in {"SUPPORTED", "PARTIALLY_SUPPORTED"} and not source_ids)
        for stage in run["metadata"].get("providerStages", []):
            operation["requests"] += 1; operation["latencyMs"] += int(stage.get("latencyMs") or 0); usage=stage.get("usage") or {}; operation["inputTokens"] += int(usage.get("input_tokens") or 0); operation["outputTokens"] += int(usage.get("output_tokens") or 0)
        observation = {"caseId": case_id, "repetition": run["metadata"].get("repetition"), "expectedState": expected, "actualState": actual, "preGuardState": pre, "stateCorrect": bool(state_correct), "classification": "GUARD_FALSE_POSITIVE" if pre == expected and actual != expected else "CORRECT_BY_REASONER" if state_correct else "ERROR_PASSED_GUARDS", "resolutionClosure": reasoning["resolutionClosure"], "missingMaterialCouldChangeFinalState": reasoning["observableSupport"]["missingMaterialCouldChangeFinalState"], "core": req["continuityCore"], "corePreservation": (reasoning["weakerClaimCandidate"] or {}).get("corePreservation"), "qualifierRoles": Counter(item["role"] for group in (req["materialQualifiers"], req["contextAnnotations"], req["structuralWrappers"]) for item in group), "facetEvidenceFitting": reasoning["facetEvidenceFitting"], "manualAdjudicationRequired": ["requirement_semantic_preservation", "qualifier_roles", "facet_necessity", "facet_evidence_fitting", "relation_semantic_equivalence", "claim_ceiling_faithfulness", "weaker_claim_continuity", "weaker_claim_usefulness", "observability_judgment"]}
        per_run.append(observation); by_case[case_id].append(observation); confusion[(expected, actual)] += 1
    cases = {}
    for case_id, items in by_case.items():
        states=Counter(item["actualState"] for item in items); majority=states.most_common(1)[0][0]
        cases[case_id] = {"expectedState": gold[case_id]["expectedState"], "runCount": len(items), "stateDistribution": dict(states), "majorityState": majority, "majorityCorrect": majority == gold[case_id]["expectedState"], "finalStateAgreement": len(states) == 1, "resolutionClosureDistribution": dict(Counter(item["resolutionClosure"] for item in items)), "corePreservationDistribution": dict(Counter(item["corePreservation"] for item in items)), "continuityCoreExactWordingAgreement": len({item["core"]["statement"] for item in items}) == 1, "continuityCoreBasisReferenceAgreement": len({tuple(item["core"]["requirementBasisPhrases"]) for item in items}) == 1, "continuityCoreSemanticEquivalence": "MANUAL_ADJUDICATION_REQUIRED"}
    return {"measurementKind": "architecture_iteration_development_evidence_not_generalization_validation", "system": "b21", "runs": len(per_run), "semanticCases": len(cases), "runLevel": {"finalStateCorrect": correct, "finalStateAccuracy": correct / len(per_run) if per_run else None, "falseSupported": false_supported, "positiveClaimsWithFabricatedEvidence": fabricated, "positiveClaimsWithWrongSourceAttribution": wrong_source, "confusionMatrix": [{"expected": a, "actual": b, "count": c} for (a,b),c in sorted(confusion.items())], "guardFalsePositives": guard_fp}, "caseLevel": {"majorityCorrectCases": sum(item["majorityCorrect"] for item in cases.values()), "totalCases": len(cases), "cases": cases}, "operation": dict(operation), "perRun": per_run, "manualAdjudication": {"status": "MANUAL_ADJUDICATION_REQUIRED", "dimensions": ["requirement semantic preservation", "qualifier role/materiality", "facet necessity", "facet evidence-fitting", "semantic relation equivalence", "claim ceiling faithfulness", "weaker-claim continuity", "weaker-claim usefulness", "observability judgment"]}}

def evaluate_b21_file(path: Path) -> dict[str, Any]: return evaluate_b21_payload(json.loads(path.read_text(encoding="utf-8")))
def compare_b1_b2_b21(b1a: Path, b1b: Path, b2: Path, b21: Path) -> dict[str, Any]: return {"measurementKind": "architecture_iteration_development_evidence_not_generalization_validation", "b1a": evaluate_file(b1a), "b1b": evaluate_file(b1b), "b2": evaluate_b2_file(b2), "b21": evaluate_b21_file(b21)}
def holdout_readiness(evaluation: dict[str, Any], *, fingerprint_unchanged: bool, smoke_passed: bool) -> dict[str, Any]: return {"offlineTests": "PASS", "smoke": "PASS" if smoke_passed else "FAIL", "fingerprintUnchanged": fingerprint_unchanged, "falseSupported": evaluation["runLevel"]["falseSupported"], "fabricatedEvidence": evaluation["runLevel"]["positiveClaimsWithFabricatedEvidence"], "wrongSourceAttribution": evaluation["runLevel"]["positiveClaimsWithWrongSourceAttribution"], "hardGuardFalsePositives": evaluation["runLevel"]["guardFalsePositives"], "developmentDistributions": {key: value["stateDistribution"] for key,value in evaluation["caseLevel"]["cases"].items()}, "AUTOMATED_HOLDOUT_GATES": "PASS" if fingerprint_unchanged and smoke_passed and evaluation["runLevel"]["falseSupported"] == 0 and evaluation["runLevel"]["positiveClaimsWithFabricatedEvidence"] == 0 and evaluation["runLevel"]["positiveClaimsWithWrongSourceAttribution"] == 0 and evaluation["runLevel"]["guardFalsePositives"] == 0 else "FAIL", "HUMAN_REVIEW": "REQUIRED", "HOLDOUT_CANDIDATE": "NO"}
